import { beforeAll, describe, expect, it, vi } from 'vitest';

// A fake Gemini: each model either stalls, answers after a delay, or fails with a quota error.
type Behaviour = { kind: 'stall' } | { kind: 'reply'; afterMs: number; text: string } | { kind: 'quota' };
const behaviour = new Map<string, Behaviour>();
const calls: string[] = [];
vi.mock('../lib/gemini-core', async (original) => {
  const real = await original<typeof import('../lib/gemini-core')>();
  return {
    ...real,
    geminiConfigured: () => true,
    client: () => ({ models: { generateContentStream: async ({ model, config }: { model: string; config: { abortSignal: AbortSignal } }) => {
      calls.push(model);
      const b = behaviour.get(model) ?? { kind: 'stall' };
      if (b.kind === 'quota') throw new Error('{"error":{"code":429,"message":"RESOURCE_EXHAUSTED. Please retry in 300s."}}');
      return (async function* () {
        if (b.kind === 'stall') await new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))));
        else { await new Promise(r => setTimeout(r, b.afterMs)); for (const piece of b.text.split(/(?<= )/)) yield { text: piece }; }
      })();
    } } }),
  };
});

let stream: typeof import('../lib/phone-stream');
beforeAll(async () => { vi.stubEnv('GEMINI_CALL_HEDGE_MS', '120'); vi.stubEnv('GEMINI_CALL_MODEL', 'primary'); stream = await import('../lib/phone-stream'); });
const brief = { brand: 'Evergreen Living', purpose: 'stalled deal' as const, asOf: '2025-03-20' };
const turn = () => stream.streamAgentTurn(brief, [{ speaker: 'sponsor', text: 'Hello?' }], {}, { onSentence: () => undefined });

describe('hedged call turns', () => {
  it('starts a fallback when the primary model stalls, and the fast one wins', async () => {
    behaviour.set('primary', { kind: 'stall' });
    behaviour.set('gemini-3.6-flash', { kind: 'reply', afterMs: 20, text: 'Thanks for picking up. Is now a good time? \n##ACTION {"action":"none"}' });
    calls.length = 0;
    const t = Date.now(), r = await turn();
    expect(r.metrics).toMatchObject({ model: 'gemini-3.6-flash', hedged: true });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(r.say).toBe('Thanks for picking up. Is now a good time?');
    expect(calls).toEqual(['primary', 'gemini-3.6-flash']);
  });
  it('puts last turn\'s winner first and the stalled model last', () => {
    const order = stream.callModels().map(c => c.model);
    expect(order[0]).toBe('gemini-3.6-flash');
    expect(order.at(-1)).toBe('primary');
  });
  it('moves on immediately after a quota error and skips that model afterwards', async () => {
    behaviour.set('gemini-3.6-flash', { kind: 'quota' });
    behaviour.set('gemini-3.1-flash-lite', { kind: 'reply', afterMs: 10, text: 'Understood, goodbye. \n##ACTION {"action":"end_call"}' });
    calls.length = 0;
    const t = Date.now(), r = await turn();
    expect(r.metrics.model).toBe('gemini-3.1-flash-lite');
    expect(r.action.action).toBe('end_call');
    expect(Date.now() - t).toBeLessThan(500); // no 2 s wait: the 429 triggers the fallback at once
    expect(stream.callModels().map(c => c.model)).not.toContain('gemini-3.6-flash');
  });
});
