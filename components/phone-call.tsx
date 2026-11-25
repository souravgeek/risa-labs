'use client';
// In-app phone call: Gemini pitches, you answer as the sponsor by voice or by typing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, Mic, PhoneOff, Send, Zap } from 'lucide-react';
import { Button } from './common';
import { useDesk, type R } from './context';
import { initials, niceDate, title } from '@/lib/shared';
import { Listener, PcmPlayer, Speaker, TypingCue, audioContext, canListen, canSpeak, isEcho } from '@/lib/phone-audio';
import { MAX_CALL_MS } from '@/lib/voice-types';

type Line = { speaker: 'agent' | 'sponsor'; text: string; latency?: number; metrics?: R };
type Voice = 'browser' | 'gemini' | 'off';
type Status = 'agent' | 'listening' | 'thinking' | 'ready' | 'ending';
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const statusText: Record<Status, string> = { agent: 'Agent speaking', listening: 'Listening… pause when you finish', thinking: 'Agent is thinking', ready: 'Your turn', ending: 'Wrapping up the call' };

export function PhoneCall({ call, brand, contact, purpose, callDate, opening, gemini, onHangUp }: {
  call: { callId: string; sessionKey: string }; brand: string; contact: string; purpose: string; callDate?: string; opening: string; gemini: boolean; onHangUp: () => Promise<void> | void;
}) {
  const { season, asOf, owner } = useDesk();
  const [lines, setLines] = useState<Line[]>([{ speaker: 'agent', text: opening }]);
  const [status, setStatusState] = useState<Status>('agent');
  const [interim, setInterim] = useState(''), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [voice, setVoice] = useState<Voice>(() => (canSpeak() ? 'browser' : 'off'));
  const [handsFree, setHandsFree] = useState(() => canListen());
  const [elapsed, setElapsed] = useState(0);
  const kit = useRef<{ player: PcmPlayer; speaker: Speaker; cue: TypingCue; listener: Listener; startedAt: number; ending: boolean; busy: boolean; abort?: AbortController } | null>(null);
  if (!kit.current) kit.current = { player: new PcmPlayer(), speaker: new Speaker(), cue: new TypingCue(), listener: new Listener(800), startedAt: Date.now(), ending: false, busy: false };
  const k = kit.current;
  const lastAgentRef = useRef(opening);
  useEffect(() => { const a = [...lines].reverse().find(l => l.speaker === 'agent' && l.text); if (a) lastAgentRef.current = a.text; }, [lines]);
  const statusRef = useRef<Status>('agent'), voiceRef = useRef(voice), handsRef = useRef(handsFree), logRef = useRef<HTMLDivElement>(null);
  voiceRef.current = voice; handsRef.current = handsFree;
  const setStatus = (s: Status) => { statusRef.current = s; setStatusState(s); };

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [lines, interim]);

  const stopAudio = useCallback(() => { k.player.stop(); k.speaker.stop(); k.cue.stop(); }, [k]);
  const spoken = useCallback(() => Promise.all([k.player.idle(), k.speaker.idle()]), [k]);

  const hangUp = useCallback(async () => {
    if (k.ending) return; k.ending = true; setStatus('ending');
    k.listener.stop(); k.abort?.abort(); stopAudio();
    await onHangUp();
  }, [k, onHangUp, stopAudio]);

  /** Reads one streamed turn: sentence captions, audio chunks, then a done event. */
  const stream = useCallback(async (body: R, on: (e: R) => void) => {
    const controller = new AbortController(); k.abort = controller;
    const res = await fetch('/api/calls/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...body, ...call, season, asOf, owner }) });
    if (!res.ok || !res.body) { const v = await res.json().catch(() => ({})); throw new Error(v.error || 'The call agent could not reply.'); }
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) on(JSON.parse(line)); }
    }
  }, [asOf, call, k, owner, season]);

  const listen = useCallback(() => {
    if (k.ending) return;
    if (!canListen()) { setStatus('ready'); return; }
    setInterim(''); setStatus('listening');
    k.listener.start({
      interim: t => setInterim(t),
      final: (t, endpointMs) => { if (isEcho(t, lastAgentRef.current)) { listen(); return; } void send(t, endpointMs); },
      error: m => { setError(m); setStatus('ready'); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  const afterAgent = useCallback(async () => { await spoken(); if (k.ending) return; if (handsRef.current) listen(); else setStatus('ready'); }, [k, listen, spoken]);

  async function send(text: string, endpointMs = 0) {
    text = text.trim(); if (!text || k.busy || k.ending) return;
    k.busy = true; k.listener.stop(); stopAudio(); setError(''); setInterim(''); setDraft('');
    // Response time is measured from the moment the sponsor stopped talking to the first sound of the agent.
    const stoppedAt = performance.now() - endpointMs;
    let firstSound = 0, fallbackSeen = false, finished: R | null = null;
    const heard = () => { if (!firstSound) { firstSound = performance.now(); k.cue.stop(); setStatus('agent'); } };
    k.player.onStart = heard; k.speaker.onStart = heard;
    setLines(l => [...l, { speaker: 'sponsor', text }, { speaker: 'agent', text: '' }]);
    setStatus('thinking'); k.cue.start(150);
    const mode = voiceRef.current;
    try {
      await stream({ text, voice: mode === 'gemini' ? 'gemini' : 'browser', endpointMs }, e => {
        if (e.type === 'error') throw new Error(e.error);
        if (e.type === 'sentence') {
          setLines(l => { const c = l.slice(), last = c[c.length - 1]; c[c.length - 1] = { ...last, text: (last.text ? last.text + ' ' : '') + e.text }; return c; });
          if (mode === 'browser') k.speaker.say(e.text);
          if (mode === 'off') heard();
        }
        if (e.type === 'audio' && mode === 'gemini' && !fallbackSeen) k.player.enqueue(e.pcm, e.rate);
        if (e.type === 'speak-fallback' && mode === 'gemini') { fallbackSeen = true; void k.player.idle().then(() => k.speaker.say(e.text)); }
        if (e.type === 'done') finished = e;
      });
      if (!firstSound) heard();
      const latency = firstSound - stoppedAt, metrics = (finished as R | null)?.metrics;
      setLines(l => { const c = l.slice(); c[c.length - 1] = { ...c[c.length - 1], latency, metrics }; return c; });
      k.busy = false;
      if ((finished as R | null)?.end) { await spoken(); await hangUp(); return; }
      await afterAgent();
    } catch (err) {
      k.busy = false; k.cue.stop();
      if ((err as Error).name === 'AbortError') return;
      const message = (err as Error).message || 'The call agent could not reply.';
      setLines(l => (l[l.length - 1]?.speaker === 'agent' && !l[l.length - 1].text ? l.slice(0, -1) : l));
      setError(message); setDraft(text); setStatus('ready');
      if (/session has ended|call is closed|does not own/i.test(message)) await hangUp();
    }
  }

  // Pick up: speak the opening line, then hand the turn to the sponsor.
  useEffect(() => {
    audioContext();
    let cancelled = false;
    (async () => {
      k.speaker.onStart = undefined;
      if (voiceRef.current === 'gemini') {
        try { await stream({ opening: true }, e => { if (e.type === 'audio') k.player.enqueue(e.pcm, e.rate); if (e.type === 'speak-fallback') k.speaker.say(e.text); }); }
        catch { k.speaker.say(opening); }
      } else if (voiceRef.current === 'browser') k.speaker.say(opening);
      await spoken();
      if (cancelled || k.ending) return;
      if (handsRef.current) listen(); else setStatus('ready');
    })();
    const tick = setInterval(() => { const ms = Date.now() - k.startedAt; setElapsed(ms); if (ms >= MAX_CALL_MS) void hangUp(); }, 500);
    return () => { cancelled = true; clearInterval(tick); k.listener.stop(); k.abort?.abort(); k.player.stop(); k.speaker.stop(); k.cue.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interrupt = () => { stopAudio(); listen(); };
  const toggleMic = () => { if (status === 'listening') { k.listener.stop(); setStatus('ready'); } else { stopAudio(); setError(''); listen(); } };
  const timed = lines.filter(l => l.latency != null && l.latency > 0), average = timed.length ? timed.reduce((n, l) => n + l.latency!, 0) / timed.length : 0;
  const busy = status === 'thinking' || status === 'ending';

  return <div className="phone">
    <div className="phone-top">
      <div className="phone-avatar">{initials(brand)}</div>
      <div className="phone-who"><b>{contact}</b><span>{brand} · {title(purpose)}{callDate ? ' · ' + new Date(callDate + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) + ' ' + niceDate(callDate, true) : ''}</span></div>
      <div className="phone-timer"><i />{clock(elapsed)}<small> / {clock(MAX_CALL_MS)}</small></div>
    </div>
    <div className="phone-state" data-status={status}><span className="pulse" />{statusText[status]}{average > 0 && <span className="phone-avg" title="Average time from the moment you stop talking to the agent's first word"><Zap size={12} />avg {(average / 1000).toFixed(1)}s</span>}</div>
    <div className="phone-log" ref={logRef} aria-live="polite">
      {lines.map((l, j) => <div className={'bubble ' + l.speaker} key={j}>
        <span className="who">{l.speaker === 'agent' ? 'Unmaad AI' : 'You, as ' + brand}</span>
        <p>{l.text || <span className="dots"><i /><i /><i /></span>}</p>
        {l.latency != null && l.latency > 0 && <span className="lat" title={l.metrics ? `Pause detection ${(l.metrics.endpointMs / 1000).toFixed(1)}s · first sentence ${(l.metrics.firstSentenceMs / 1000).toFixed(1)}s on the server${l.metrics.firstAudioMs ? ` · Gemini voice ${(l.metrics.firstAudioMs / 1000).toFixed(1)}s` : ''} · ${l.metrics.model}${l.metrics.hedged ? ' (fallback)' : ''}` : undefined}><Zap size={11} />{(l.latency / 1000).toFixed(1)}s</span>}
      </div>)}
      {status === 'listening' && <div className="bubble sponsor interim"><span className="who">You, as {brand}</span><p>{interim || 'Listening…'}</p></div>}
    </div>
    <form className="phone-reply" onSubmit={e => { e.preventDefault(); void send(draft); }}>
      <button type="button" className={'phone-mic' + (status === 'listening' ? ' on' : '')} onClick={toggleMic} disabled={!canListen() || busy} aria-label={status === 'listening' ? 'Stop listening' : 'Speak your reply'} title={canListen() ? 'Speak your reply' : 'Speech recognition is not available in this browser'}><Mic size={18} /></button>
      <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={canListen() ? 'Speak, or type your reply as the sponsor…' : 'Type your reply as the sponsor…'} disabled={busy} aria-label="Your reply" />
      <button type="submit" className="btn primary" disabled={!draft.trim() || busy} aria-label="Send reply"><Send size={16} /></button>
    </form>
    <div className="phone-controls">
      <label>Agent voice<select value={voice} onChange={e => { stopAudio(); setVoice(e.target.value as Voice); }}>
        <option value="browser" disabled={!canSpeak()}>Browser voice (instant)</option>
        <option value="gemini" disabled={!gemini}>Gemini voice{gemini ? ' (uses quota)' : ' (needs key)'}</option>
        <option value="off">Captions only</option>
      </select></label>
      <label className="phone-check"><input type="checkbox" checked={handsFree} disabled={!canListen()} onChange={e => setHandsFree(e.target.checked)} />Hands-free</label>
      <span className="phone-spacer" />
      {status === 'agent' && <Button className="btn" variant="outline" onClick={interrupt}><Hand size={15} />Interrupt</Button>}
      <Button className="btn phone-hangup" onClick={() => void hangUp()} disabled={status === 'ending'}><PhoneOff size={15} />{status === 'ending' ? 'Analysing…' : 'Hang up'}</Button>
    </div>
    {error && <p className="call-error" role="alert">{error}</p>}
  </div>;
}
