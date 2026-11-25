import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SentenceSplitter, parseAction, openingLine } from '../lib/phone-stream';
import { resolveSpokenDate } from '../lib/gemini-calls';
import { phoneSystem } from '../lib/phone-stream';
import { isEcho } from '../lib/phone-audio';
import { calendarLines } from '../lib/gemini-core';
import { reviewPromise } from '../lib/voice-service';
import { hasDisclosure, DISCLOSURE } from '../lib/voice-types';
import { POST as callApi } from '../app/api/calls/route';
import { POST as turnApi } from '../app/api/calls/turn/route';
import { read } from '../lib/workspace';

const i = { season: '2025' as const, asOf: '2025-03-20' };
const temp = mkdtempSync(join(tmpdir(), 'campusfest-phone-test-'));
beforeAll(() => { vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('VERCEL', ''); vi.stubEnv('CAMPUSFEST_DATA_DIR', temp); });
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { vi.unstubAllEnvs(); rmSync(temp, { force: true, recursive: true }); });
const workingHours = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-25T06:30:00Z')); };
const api = async (body: Record<string, unknown>) => {
  const r = await callApi(new Request('http://localhost/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...i, ...body }) }));
  return { status: r.status, ...await r.json() };
};
/** Reads the NDJSON turn stream exactly as the browser does. */
const turn = async (body: Record<string, unknown>) => {
  const r = await turnApi(new Request('http://localhost/api/calls/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...i, ...body }) }));
  expect(r.headers.get('content-type')).toContain('ndjson');
  return (await r.text()).trim().split('\n').map(l => JSON.parse(l));
};

describe('streaming helpers', () => {
  it('emits each sentence as soon as it is complete and stops at the action line', () => {
    const s = new SentenceSplitter();
    expect(s.push('That makes sense. ')).toEqual(['That makes sense.']);
    expect(s.push('Could we do one point')).toEqual([]);
    expect(s.push(' one lakh rupees? Great')).toEqual(['Could we do one point one lakh rupees?']);
    expect(s.push('.\n##ACTION {"action":"none"}')).toEqual(['Great.']);
    expect(s.end()).toEqual([]);
  });
  it('keeps decimals and short fragments together', () => {
    const s = new SentenceSplitter();
    expect([...s.push('Okay. The 1.1 lakh package fits. '), ...s.end()]).toEqual(['Okay. The 1.1 lakh package fits.']);
  });
  it('parses the action line and tolerates a missing or broken one', () => {
    expect(parseAction('Bye.\n##ACTION {"action":"schedule_follow_up","date":"2025-03-21","reason":"send one-pager"}')).toEqual({ action: 'schedule_follow_up', date: '2025-03-21', amount: undefined, reason: 'send one-pager' });
    expect(parseAction('No action here.')).toEqual({ action: 'none' });
    expect(parseAction('##ACTION {broken')).toEqual({ action: 'none' });
    expect(parseAction('##ACTION {"action":"transfer_money"}').action).toBe('none');
  });
  it('opens every call with the fixed AI disclosure and no model wait', () => {
    for (const purpose of ['stalled deal', 'payment reminder', 'inbound lead'] as const) {
      const line = openingLine({ brand: 'Evergreen Living', purpose, facts: { outstanding: 45000 } });
      expect(line.startsWith(DISCLOSURE)).toBe(true);
      expect(hasDisclosure([{ speaker: 'agent', text: line }])).toBe(true);
    }
  });
});

describe('call calendar and mic echo', () => {
  it('treats the real call date as today and the workspace date as the record date', () => {
    const system = phoneSystem({ brand: 'Aster Living', purpose: 'payment reminder', asOf: '2025-03-20', callDate: '2026-11-25' }, false);
    expect(system).toContain('Today is 2026-11-25, a Wednesday');
    expect(system).toContain('records as of 2025-03-20');
    expect(system).toContain('never propose a date before today');
  });
  it('hands the agent a ready-made calendar with correct weekdays', () => {
    const cal = calendarLines('2026-11-25');
    expect(cal).toContain('Today: Wednesday, 25 November 2026 = 2026-11-25');
    expect(cal).toContain('In two weeks / a couple of weeks / a fortnight: Wednesday, 9 December 2026 = 2026-12-09');
    expect(cal).toContain('Thu 10 Dec = 2026-12-10');
    expect(cal).toContain('End of this month: Monday, 30 November 2026');
  });
  it('approves the promise the agent recorded when the analysis found none in the sponsor\'s words', () => {
    const fields = { paymentDate: { value: null }, paymentAmount: { value: null } };
    expect(reviewPromise({ insights: { fields }, toolProposals: [{ name: 'log_payment_promise', date: '2026-12-09', amount: 62500 }] })).toEqual({ date: '2026-12-09', amount: 62500, source: 'agent' });
    expect(reviewPromise({ insights: { fields: { paymentDate: { value: '2026-12-01' }, paymentAmount: { value: 1000 } } }, toolProposals: [{ name: 'log_payment_promise', date: '2026-12-09', amount: 62500 }] })?.source).toBe('quote');
    expect(reviewPromise({ insights: { fields }, toolProposals: [] })).toBeNull();
  });
  it('ignores the agent\'s own voice picked up by the mic, but not a real reply', () => {
    const agent = "Hi, I'm an AI assistant calling from the Unmaad partnerships team.";
    expect(isEcho('assistant calling from the', agent)).toBe(true);
    expect(isEcho('couple of weeks', agent)).toBe(false);
    expect(isEcho('yes', agent)).toBe(false);
  });
});

describe('spoken next-step dates', () => {
  it('resolves relative dates against the call date (20 Mar 2025, a Thursday)', () => {
    const on = (t: string) => resolveSpokenDate(t, '2025-03-20');
    expect(on('Send the one-pager by Friday.')).toBe('2025-03-21');
    expect(on('Call me on Monday')).toBe('2025-03-24');
    expect(on('Thursday works')).toBe('2025-03-27');
    expect(on('Let us talk tomorrow')).toBe('2025-03-21');
    expect(on('Ping me next week')).toBe('2025-03-27');
    expect(on('By the 24th of March please')).toBe('2025-03-24');
    expect(on('March 2nd')).toBe('2026-03-02');
    expect(on('2025-04-02 is fine')).toBe('2025-04-02');
    expect(on('It will be done in a couple of weeks')).toBe('2025-04-03');
    expect(on('give us a fortnight')).toBe('2025-04-03');
    expect(on('in a week')).toBe('2025-03-27');
    expect(on('Sometime soon')).toBeNull();
  });
});

describe('in-app phone call', () => {
  it('runs a full call: opening, streamed turns, goodbye, analysis and saved latency metrics', async () => {
    workingHours();
    const contactId = (await api({ kind: 'addContact', name: 'Priya', brandId: 'A052', purpose: 'stalled deal', consent: true })).id;
    const preview = await api({ kind: 'preview', brandId: 'A052', purpose: 'stalled deal', contactId });
    expect(preview.brief).toMatchObject({ asOf: '2025-03-20', callDate: '2026-11-25' });
    const start = await api({ kind: 'start', brandId: 'A052', purpose: 'stalled deal', contactId, mode: 'phone', confirm: true });
    expect(start.status).toBe(200);
    expect(start.turn.text.startsWith(DISCLOSURE)).toBe(true);
    const auth = { callId: start.id, sessionKey: start.sessionKey };

    let ended = false, turns = 0;
    for (const text of ['Yes, I have a minute.', 'Budget is locked until April and the CMO must sign off.', 'I make the final decision.', 'Please send the one-page proposal on 2025-03-24.', 'Thanks, bye.']) {
      const events = await turn({ ...auth, text, endpointMs: 800 });
      expect(events.some(e => e.type === 'sentence')).toBe(true);
      expect(events.some(e => e.type === 'audio')).toBe(false); // browser voice: no server audio
      const done = events.at(-1);
      expect(done.type).toBe('done');
      expect(done.metrics).toMatchObject({ engine: 'scripted', endpointMs: 800 });
      turns++;
      if (done.end) { ended = true; break; }
    }
    expect(ended).toBe(true);
    expect(turns).toBeLessThanOrEqual(5);

    const finished = await api({ kind: 'finish', ...auth });
    expect(finished.status).toBe(200);
    expect(finished.insights.disclosurePresent).toBe(true);
    const call = (await read(i)).extras.calls.find(c => c.id === start.id)!;
    expect(call).toMatchObject({ mode: 'phone', status: 'completed', review: 'pending' });
    expect(call.transcript.filter((t: { speaker: string }) => t.speaker === 'sponsor')).toHaveLength(turns);
    expect(call.metrics).toHaveLength(turns);
    expect(finished.insights.fields.nextStepDate.value).toBe('2025-03-24');
  });

  it('ends the call and deactivates consent the moment the sponsor opts out', async () => {
    workingHours();
    const contactId = (await api({ kind: 'addContact', name: 'Kiran', brandId: 'A052', purpose: 'stalled deal', consent: true })).id;
    const start = await api({ kind: 'start', brandId: 'A052', purpose: 'stalled deal', contactId, mode: 'phone', confirm: true });
    const events = await turn({ callId: start.id, sessionKey: start.sessionKey, text: 'Please stop calling me.' });
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', end: true, optedOut: true });
    expect((await read(i)).extras.allowlist.find(c => c.id === contactId)?.active).toBe(false);
  });

  it('refuses a turn from a browser that does not own the call', async () => {
    workingHours();
    const contactId = (await api({ kind: 'addContact', name: 'Asha', brandId: 'A052', purpose: 'stalled deal', consent: true })).id;
    const start = await api({ kind: 'start', brandId: 'A052', purpose: 'stalled deal', contactId, mode: 'phone', confirm: true });
    const events = await turn({ callId: start.id, sessionKey: 'x'.repeat(48), text: 'Hello?' });
    expect(events).toEqual([expect.objectContaining({ type: 'error' })]);
  });
});
