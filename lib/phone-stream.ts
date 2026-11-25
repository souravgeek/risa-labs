// Low-latency engine for the in-app phone call.
// Pipeline (after the realtime-phone-agents course): the sponsor's speech is transcribed in the browser and
// sent when they pause → Gemini streams the agent's reply → each finished sentence is spoken while the
// next one is still being generated. A slow or overloaded model is hedged with a fallback, so one
// latency spike doesn't stall the call.
import { Modality, type GenerateContentResponse } from '@google/genai';
import { callInstruction, client, geminiConfigured, isCooling, markCooling, markGood, markSlow, rankModels, transientError, safeData, type GeminiLogEntry, type GeminiLogger } from './gemini-core';
import { DISCLOSURE, type CallBrief, type Transcript } from './voice-types';

export const PHONE_ACTIONS = ['none', 'schedule_follow_up', 'log_payment_promise', 'end_call'] as const;
export type PhoneAction = typeof PHONE_ACTIONS[number];
export interface PhoneAgentAction { action: PhoneAction; date?: string; amount?: number; reason?: string }
export interface TurnMetrics { model: string; firstTokenMs: number; firstSentenceMs: number; totalMs: number; hedged: boolean }

/** Candidate models for a call turn, fastest first. Each carries the thinking setting it accepts. */
export function callModels(): { model: string; config: Record<string, unknown> }[] {
  const primary = process.env.GEMINI_CALL_MODEL || 'gemini-3.5-flash';
  const list = [
    { model: primary, config: { thinkingConfig: { thinkingLevel: 'minimal' } } },
    { model: 'gemini-3.6-flash', config: { thinkingConfig: { thinkingLevel: 'minimal' } } },
    { model: 'gemini-3.1-flash-lite', config: { thinkingConfig: { thinkingBudget: 0 } } },
    { model: 'gemini-3.5-flash-lite', config: {} },
  ];
  // Each model has its own quota, so spreading across them keeps a call going when one is rate-limited.
  const unique = list.filter((c, i) => list.findIndex(x => x.model === c.model) === i);
  const ready = unique.filter(c => !isCooling(c.model)), pool = ready.length ? ready : unique;
  // Adaptive order: the model that answered most recently goes first; a model that just stalled goes last.
  return rankModels(pool, c => c.model);
}
// A healthy model sends its first token in about a second, so a 2 s silence means a stall. Later hedges fire
// faster. Only real stalls start extra requests, because on the free tier every request counts against a quota.
export const HEDGE_MS = Number(process.env.GEMINI_CALL_HEDGE_MS || 2000);


/** Opening line: fixed disclosure plus a templated reason for the call, so pickup has no model wait. */
export function openingLine(brief: CallBrief) {
  const f = brief.facts ?? {};
  const words = (n: unknown) => Number(n || 0).toLocaleString('en-IN');
  if (brief.purpose === 'payment reminder') return DISCLOSURE + ' I am calling about the Unmaad invoice of ₹' + words(f.outstanding ?? f.value) + '. Is now a good time to confirm when the payment will go out?';
  if (brief.purpose === 'inbound lead') return DISCLOSURE + ' Thank you for your interest in partnering with Unmaad. Is now a good time to hear what you hope to achieve at the festival?';
  return DISCLOSURE + ' I am following up on our Unmaad partnership proposal for ' + brief.brand + '. Is now a good time to talk about where it stands?';
}

export function phoneSystem(brief: CallBrief, closing: boolean) {
  const today = brief.callDate || brief.asOf || new Date().toISOString().slice(0, 10);
  return [
    callInstruction(brief),
    'This is a live phone call. You are the caller from the Unmaad partnerships team. The person you are speaking to works at ' + brief.brand + ', the sponsor. Never speak as the sponsor. The opening disclosure has already been spoken.',
    'Your words are read aloud by a text-to-speech voice. Speak the way people talk on the phone: one to three short sentences, under 40 words. Plain words only: no lists, markdown, symbols or emojis.',
    'All money is Indian rupees. Say amounts in words, for example "ninety thousand rupees" or "one point one lakh rupees". Never say dollars. Say dates in words, for example "Friday the twenty-first of March".',
    'Pitch the value of the partnership using the facts, address objections directly, and steer toward a concrete, dated next step. Never repeat a question the sponsor has already answered.',
    'Today is ' + today + ', a ' + new Date(today + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) + '. Resolve relative dates such as "Friday" or "a couple of weeks" by reading them from the CALENDAR above, and never propose a date before today. When you say a date, include the year if it is not this year.',
    'After your spoken words, write one final line in exactly this form: ##ACTION {"action":"none"}',
    'Use action "schedule_follow_up" with "date" (YYYY-MM-DD) and "reason" when the sponsor agrees to a dated next step; "log_payment_promise" with "date" and "amount" (a number) when they commit to paying; "end_call" only in the turn where you say goodbye. Otherwise "none".',
    closing ? 'Time is nearly up. Wrap up now: thank them, restate the agreed next step if any, say goodbye, and use action end_call.' : '',
  ].filter(Boolean).join('\n');
}

/** Splits streamed text into speakable sentences as soon as each one is complete. */
export class SentenceSplitter {
  private buffer = '';
  private done = false;
  push(delta: string): string[] {
    if (this.done) return [];
    this.buffer += delta;
    const marker = this.buffer.indexOf('##');
    let speakable = marker >= 0 ? this.buffer.slice(0, marker) : this.buffer;
    if (marker >= 0) this.done = true;
    const out: string[] = [];
    // A sentence ends at . ? or ! followed by whitespace; ignore decimals like 1.1 and very short fragments.
    const re = /[.?!]+["')\]]?(?=\s)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(speakable))) {
      const end = m.index + m[0].length, piece = speakable.slice(last, end).trim();
      if (piece.length >= 12) { out.push(piece); last = end; }
    }
    speakable = speakable.slice(last);
    if (this.done) { const rest = speakable.trim(); if (rest) out.push(rest); this.buffer = this.buffer.slice(marker); }
    else this.buffer = speakable;
    return out.map(clean).filter(Boolean);
  }
  /** Flushes any trailing words once the stream ends. */
  end(): string[] { if (this.done) return []; this.done = true; const rest = clean(this.buffer); this.buffer = ''; return rest ? [rest] : []; }
}
const clean = (s: string) => s.replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim();
export function parseAction(full: string): PhoneAgentAction {
  const m = /##\s*ACTION\s*(\{[\s\S]*?\})/i.exec(full);
  if (!m) return { action: 'none' };
  try {
    const raw = JSON.parse(m[1]);
    const action = (PHONE_ACTIONS as readonly string[]).includes(raw.action) ? raw.action as PhoneAction : 'none';
    return { action, date: typeof raw.date === 'string' ? raw.date : undefined, amount: Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : undefined, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : undefined };
  } catch { return { action: 'none' }; }
}

type Stream = AsyncGenerator<GenerateContentResponse>;
/**
 * Starts the primary model; if it errors or hasn't produced a token within HEDGE_MS, starts the next
 * candidate too. Whichever streams first wins and the others are aborted.
 */
async function hedgedStream(system: string, contents: string, log?: GeminiLogger): Promise<{ stream: Stream; first: GenerateContentResponse; model: string; started: number; hedged: boolean; finish: (error?: string) => Promise<void> }> {
  const candidates = callModels();
  const started = Date.now();
  type Attempt = { model: string; controller: AbortController; t0: number; promise: Promise<{ attempt: Attempt; stream: Stream; first: GenerateContentResponse }> };
  const attempts: Attempt[] = [];
  const launch = (i: number) => {
    const c = candidates[i], controller = new AbortController();
    const attempt = { model: c.model, controller, t0: Date.now() } as Attempt;
    attempt.promise = (async () => {
      const stream = await client().models.generateContentStream({ model: c.model, contents, config: { ...c.config, systemInstruction: system, maxOutputTokens: 400, abortSignal: controller.signal } });
      for (;;) {
        const next = await stream.next();
        if (next.done) throw new Error('Empty response from ' + c.model);
        if (next.value.text) return { attempt, stream, first: next.value };
      }
    })();
    attempts.push(attempt);
    return attempt;
  };
  const logFail = (a: Attempt, error: unknown) => log?.({ purpose: 'phone_call_turn', model: a.model, promptVersion: 'phone-v2', latencyMs: Date.now() - a.t0, tokensIn: 0, tokensOut: 0, toolCalls: [], error: error instanceof Error ? error.message.slice(0, 80) : 'aborted' });
  let next = 0, hedged = false;
  const pending = new Set<Attempt>();
  const add = () => { if (next < candidates.length) { const a = launch(next++); pending.add(a); return true; } return false; };
  add();
  for (;;) {
    if (!pending.size) throw new Error('Every call model failed. Check the Gemini key and quota.');
    const timer = new Promise<'hedge'>(r => setTimeout(() => r('hedge'), hedged ? Math.min(HEDGE_MS, 1500) : HEDGE_MS));
    const winner = await Promise.race([
      ...[...pending].map(a => a.promise.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, a, e }))),
      next < candidates.length ? timer : new Promise<never>(() => {}),
    ]);
    // First hedge adds one fallback; if that stalls too, every remaining model is started at once.
    if (winner === 'hedge') { if (hedged) while (add()); else hedged = add(); continue; }
    if (!winner.ok) { pending.delete(winner.a); if (transientError(winner.e)) markCooling(winner.a.model, winner.e); await logFail(winner.a, winner.e); if (pending.size === 0) { hedged = true; if (!add()) throw winner.e; } continue; }
    const { attempt, stream, first } = winner.v;
    markGood(attempt.model);
    for (const other of pending) if (other !== attempt) { other.controller.abort(); other.promise.catch(() => undefined); if (other.t0 < attempt.t0) markSlow(other.model); void logFail(other, new Error('lost the hedge race')); }
    const finish = async (error?: string) => { await log?.({ purpose: 'phone_call_turn', model: attempt.model, promptVersion: 'phone-v2', latencyMs: Date.now() - attempt.t0, tokensIn: 0, tokensOut: 0, toolCalls: [], ...(error ? { error } : {}) }); };
    return { stream, first, model: attempt.model, started, hedged, finish };
  }
}

export interface TurnEvents { onSentence: (text: string, index: number) => void | Promise<void> }
/** Streams one agent turn. Sentences are emitted as they complete; the full text and action are returned. */
export async function streamAgentTurn(brief: CallBrief, transcript: Transcript, opts: { closing?: boolean }, events: TurnEvents, log?: GeminiLogger): Promise<{ say: string; action: PhoneAgentAction; metrics: TurnMetrics }> {
  const lines = transcript.map(t => (t.speaker === 'agent' ? 'Unmaad AI: ' : 'Sponsor: ') + t.text).join('\n');
  const contents = 'Call so far:\n' + JSON.stringify(safeData(lines)) + '\n\nWrite your next turn.';
  const { stream, first, model, started, hedged, finish } = await hedgedStream(phoneSystem(brief, !!opts.closing), contents, log);
  const firstTokenMs = Date.now() - started;
  const splitter = new SentenceSplitter(), said: string[] = [];
  let full = '', firstSentenceMs = 0;
  const emit = async (pieces: string[]) => { for (const p of pieces) { if (!firstSentenceMs) firstSentenceMs = Date.now() - started; said.push(p); await events.onSentence(p, said.length - 1); } };
  try {
    full += first.text || ''; await emit(splitter.push(first.text || ''));
    for await (const chunk of stream) { const t = chunk.text || ''; full += t; await emit(splitter.push(t)); }
    await emit(splitter.end());
    await finish();
  } catch (error) { await finish(error instanceof Error ? error.message.slice(0, 80) : 'stream error'); if (!said.length) throw error; }
  const say = said.join(' ');
  if (!say) throw new Error('Gemini returned an empty call turn.');
  const action = parseAction(full);
  return { say, action: opts.closing ? { ...action, action: 'end_call' } : action, metrics: { model, firstTokenMs, firstSentenceMs, totalMs: Date.now() - started, hedged } };
}

/** Streams Gemini TTS audio for one sentence as raw 16-bit PCM chunks (base64). */
export async function streamSpeech(text: string, onChunk: (pcmBase64: string, rate: number) => void | Promise<void>, log?: GeminiLogger, signal?: AbortSignal) {
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts', t0 = Date.now();
  if (!geminiConfigured() || isCooling(model)) return false;
  const entry: GeminiLogEntry = { purpose: 'phone_call_voice', model, promptVersion: 'phone-v2', latencyMs: 0, tokensIn: 0, tokensOut: 0, toolCalls: [] };
  let sent = false;
  try {
    const stream = await client().models.generateContentStream({ model, contents: 'Say this in a warm, natural, friendly phone voice with an Indian English accent: ' + text, config: {
      responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Kore' } } }, abortSignal: signal ?? AbortSignal.timeout(20_000),
    } });
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        const d = part.inlineData; if (!d?.data) continue;
        let pcm = Buffer.from(d.data, 'base64');
        // Some responses wrap PCM in a WAV header; strip it so every chunk is raw samples.
        if (pcm.subarray(0, 4).toString() === 'RIFF') { const at = pcm.indexOf('data'); pcm = at > 0 ? pcm.subarray(at + 8) : pcm.subarray(44); }
        const rate = Number(/rate=(\d+)/.exec(d.mimeType || '')?.[1] || 24000);
        if (pcm.length) { sent = true; await onChunk(pcm.toString('base64'), rate); }
      }
    }
    return sent;
  } catch (error) {
    entry.error = error instanceof Error ? error.message.slice(0, 80) : 'tts error';
    if (transientError(error)) markCooling(model, error);
    return sent;
  } finally {
    entry.latencyMs = Date.now() - t0;
    await log?.(entry);
  }
}
