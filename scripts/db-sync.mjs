// Mirrors the event store between local SQLite (.local/growth.sqlite) and Supabase, per season.
// When one side's events are the start of the other's, the missing tail is copied in order (Supabase writes use
// append_growth_event, so a copy can't duplicate or reorder). If the two have diverged, nothing is written unless
// `--from=supabase` is given, which rewrites the local mirror to match Supabase exactly.
//   npm run db:sync            copy missing events both ways
//   npm run db:sync -- --check report only
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
if (existsSync('.env')) process.loadEnvFile('.env');
const args = process.argv.slice(2), check = args.includes('--check'), fromSupabase = args.includes('--from=supabase');
const base = process.env.SUPABASE_URL?.replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) { console.error('✗ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json' };
const dir = process.env.CAMPUSFEST_DATA_DIR || path.join(process.cwd(), '.local'); mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'growth.sqlite');
if (!check && existsSync(file) && !args.includes('--no-backup')) { const backup = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-'); copyFileSync(file, backup); console.log('• Local backup: ' + backup); }
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,season TEXT NOT NULL, payload TEXT NOT NULL);');

async function remote(season) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const r = await fetch(`${base}/rest/v1/growth_events?season=eq.${season}&select=payload&order=seq.asc&limit=500&offset=${offset}`, { headers });
    if (!r.ok) throw Error('Supabase read failed: ' + r.status + ' ' + await r.text());
    const rows = await r.json(); out.push(...rows.map(v => v.payload)); if (rows.length < 500) return out;
  }
}
const local = season => db.prepare('SELECT payload FROM events WHERE season=? ORDER BY seq').all(season).map(v => JSON.parse(v.payload));
// Postgres jsonb stores object keys sorted, so compare with keys sorted on both sides.
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const isPrefix = (short, long) => short.every((e, i) => long[i]?.id === e.id);

let failed = false;
for (const season of ['2025', '2026']) {
  const L = local(season), S = await remote(season);
  const tag = `${season}: local ${L.length}, Supabase ${S.length}`;
  if (L.length === S.length && isPrefix(L, S)) {
    const differ = L.filter((e, i) => !same(e, S[i])).length;
    if (!differ) { console.log(`✓ ${tag} · identical`); continue; }
    if (check || !fromSupabase) { console.log(`! ${tag} · same events, ${differ} with different contents (e.g. an erasure). Run with --from=supabase to copy Supabase's version.`); failed = true; continue; }
  }
  if (S.length < L.length && isPrefix(S, L)) {
    const tail = L.slice(S.length);
    if (check) { console.log(`• ${tag} · ${tail.length} to copy to Supabase`); continue; }
    for (let i = 0; i < tail.length; i++) {
      const r = await fetch(`${base}/rest/v1/rpc/append_growth_event`, { method: 'POST', headers, body: JSON.stringify({ new_event: tail[i], expected_count: S.length + i }) });
      if (!r.ok || !(await r.json())) throw Error(`Stopped at ${tail[i].id}: Supabase changed during the copy (${r.status}). Rerun db:sync.`);
    }
    console.log(`✓ ${tag} · copied ${tail.length} to Supabase`); continue;
  }
  if (L.length < S.length && isPrefix(L, S) && !fromSupabase) {
    const tail = S.slice(L.length);
    if (check) { console.log(`• ${tag} · ${tail.length} to copy to local`); continue; }
    const ins = db.prepare('INSERT INTO events(id,season,payload) VALUES(?,?,?)');
    db.exec('BEGIN IMMEDIATE'); try { for (const e of tail) ins.run(e.id, season, JSON.stringify(e)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`✓ ${tag} · copied ${tail.length} to local`); continue;
  }
  if (!fromSupabase || check) { console.log(`✗ ${tag} · the two histories have diverged. Nothing written. Run with --from=supabase to make local match Supabase.`); failed = true; continue; }
  db.exec('BEGIN IMMEDIATE');
  try { db.prepare('DELETE FROM events WHERE season=?').run(season); const ins = db.prepare('INSERT INTO events(id,season,payload) VALUES(?,?,?)'); for (const e of S) ins.run(e.id, season, JSON.stringify(e)); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`✓ ${tag} · local rewritten to match Supabase`);
}
// Final proof: both sides hold the same events, byte for byte, in the same order.
if (!check) for (const season of ['2025', '2026']) {
  const L = local(season), S = await remote(season);
  const ok = L.length === S.length && L.every((e, i) => same(e, S[i]));
  console.log(`${ok ? '✓' : '✗'} verify ${season}: ${ok ? 'identical' : 'still different'} (${L.length} events)`); if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
