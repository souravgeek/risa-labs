'use client';
// Browser audio for the in-app phone call: play the agent, listen to the sponsor, and mask thinking time.

type AnyRecognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; onspeechstart?: (() => void) | null;
};
const Recognition = () => (typeof window === 'undefined' ? undefined : (window as unknown as { SpeechRecognition?: new () => AnyRecognition; webkitSpeechRecognition?: new () => AnyRecognition }).SpeechRecognition
  || (window as unknown as { webkitSpeechRecognition?: new () => AnyRecognition }).webkitSpeechRecognition);
export const canListen = () => Boolean(Recognition());
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let shared: AudioContext | undefined;
/** One AudioContext for the call, resumed inside the click that starts it so autoplay rules allow playback. */
export function audioContext() {
  if (!shared || shared.state === 'closed') shared = new AudioContext();
  if (shared.state === 'suspended') void shared.resume();
  return shared;
}

/** Plays streamed 16-bit PCM chunks back to back with no gaps between them. */
export class PcmPlayer {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private idleWaiters: (() => void)[] = [];
  onStart?: () => void;
  enqueue(base64: string, rate: number) {
    const ctx = audioContext(), bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, rate), data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.next);
    if (!this.sources.size && this.onStart) { const cb = this.onStart; setTimeout(cb, Math.max(0, (at - ctx.currentTime) * 1000)); this.onStart = undefined; }
    source.start(at); this.next = at + buffer.duration; this.sources.add(source);
    source.onended = () => { this.sources.delete(source); if (!this.sources.size) { const w = this.idleWaiters; this.idleWaiters = []; w.forEach(f => f()); } };
  }
  get playing() { return this.sources.size > 0; }
  idle() { return this.sources.size ? new Promise<void>(r => this.idleWaiters.push(r)) : Promise.resolve(); }
  stop() { for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } } this.sources.clear(); this.next = 0; const w = this.idleWaiters; this.idleWaiters = []; w.forEach(f => f()); }
}

/** Browser text-to-speech with a reliable "finished" signal (Chrome sometimes drops onend). */
export class Speaker {
  private pending = 0;
  private waiters: (() => void)[] = [];
  private voice?: SpeechSynthesisVoice;
  onStart?: () => void;
  constructor() {
    if (!canSpeak()) return;
    const pick = () => { const v = speechSynthesis.getVoices(); this.voice = v.find(x => /en-IN/i.test(x.lang) && /female|google|veena|isha|neerja/i.test(x.name)) || v.find(x => /en-IN/i.test(x.lang)) || v.find(x => /Google UK English Female|Samantha|en-GB/i.test(x.name + x.lang)) || v.find(x => /^en/i.test(x.lang)); };
    pick(); speechSynthesis.onvoiceschanged = pick;
  }
  say(text: string) {
    if (!canSpeak() || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-IN';
    u.rate = 1.05;
    this.pending++;
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(guard); this.pending = Math.max(0, this.pending - 1); if (!this.pending) { const w = this.waiters; this.waiters = []; w.forEach(f => f()); } };
    const guard = setTimeout(done, 2500 + text.split(/\s+/).length * 450);
    u.onstart = () => { if (this.onStart) { const cb = this.onStart; this.onStart = undefined; cb(); } };
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  }
  get speaking() { return this.pending > 0; }
  idle() { return this.pending ? new Promise<void>(r => this.waiters.push(r)) : Promise.resolve(); }
  stop() { if (canSpeak()) speechSynthesis.cancel(); this.pending = 0; const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
}

/** Soft keyboard clicks while the agent thinks, the course's trick for making a wait feel natural. */
export class TypingCue {
  private timer?: ReturnType<typeof setTimeout>;
  start(delayMs = 250) {
    this.stop();
    const tick = () => {
      const ctx = audioContext(), len = Math.floor(ctx.sampleRate * 0.018), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      filter.type = 'bandpass'; filter.frequency.value = 2200 + Math.random() * 1800; gain.gain.value = 0.05 + Math.random() * 0.04;
      src.buffer = buf; src.connect(filter).connect(gain).connect(ctx.destination); src.start();
      this.timer = setTimeout(tick, 70 + Math.random() * 140 + (Math.random() < 0.12 ? 260 : 0));
    };
    this.timer = setTimeout(tick, delayMs);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}

/**
 * Listens for one sponsor turn. Interim words show as a live caption; the turn is sent once the speaker
 * has paused for `silenceMs` (the browser equivalent of FastRTC's ReplyOnPause).
 */
export class Listener {
  private rec?: AnyRecognition;
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  /** `silenceMs` applies after a finished phrase; mid-phrase pauses get `midPhraseMs` so a short breath doesn't cut you off. */
  constructor(private silenceMs = 800, private lang = 'en-IN', private midPhraseMs = 1600) {}
  get listening() { return this.active; }
  start(on: { interim: (text: string) => void; final: (text: string, endpointMs: number) => void; error: (message: string) => void }) {
    const R = Recognition(); if (!R) { on.error('Speech recognition is not available in this browser. Type your reply instead.'); return; }
    this.stop();
    const rec = new R(); this.rec = rec; this.active = true;
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalText = '', interim = '', delivered = false, wait = this.silenceMs;
    const deliver = () => { if (delivered) return; const text = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim(); if (!text) return; delivered = true; this.stop(); on.final(text, wait); };
    rec.onresult = e => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += ' ' + r[0].transcript; else interim += r[0].transcript; }
      on.interim((finalText + ' ' + interim).replace(/\s+/g, ' ').trim());
      if (this.timer) clearTimeout(this.timer);
      wait = interim.trim() ? this.midPhraseMs : this.silenceMs;
      this.timer = setTimeout(deliver, wait);
    };
    rec.onerror = e => { if (e.error === 'no-speech' || e.error === 'aborted') return; this.active = false; on.error(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access was blocked. Allow it in the browser, or type your reply.' : 'Speech recognition stopped (' + e.error + '). Tap the mic to try again or type.'); };
    // Chrome ends recognition after long silences; restart quietly while we are still waiting for the sponsor.
    rec.onend = () => { if (!this.active || delivered) return; if ((finalText + interim).trim()) deliver(); else { try { rec.start(); } catch { this.active = false; } } };
    try { rec.start(); } catch { on.error('Could not start the microphone.'); this.active = false; }
  }
  stop() { this.active = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; const r = this.rec; this.rec = undefined; if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* already stopped */ } } }
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
/** True when the mic picked up the agent's own voice: almost every word heard is in the agent's last line. */
export function isEcho(heard: string, agentLine: string) {
  const h = words(heard), a = new Set(words(agentLine));
  return h.length >= 2 && h.filter(w => a.has(w)).length / h.length >= 0.8 && words(agentLine).join(' ').includes(h.slice(0, 3).join(' '));
}
