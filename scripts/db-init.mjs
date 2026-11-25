// Installs the Supabase schema (supabase/schema.sql, then supabase/call-privacy.sql) and checks the result.
// Needs in .env: SUPABASE_DB_URL (to install) and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (to verify).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { SUPABASE_DB_URL: db, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: key, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub } = process.env;
const base = SUPABASE_URL?.replace(/\/$/, '');
const fail = m => { console.error('✗ ' + m); process.exit(1); };

if (db) {
  const psql = ['psql', '/opt/homebrew/opt/postgresql@16/bin/psql', '/opt/homebrew/bin/psql'].find(p => spawnSync(p, ['--version']).status === 0);
  if (!psql) fail('psql not found. Install PostgreSQL client tools, or paste both SQL files into the Supabase SQL editor.');
  const r = spawnSync(psql, [db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', 'supabase/schema.sql', '-f', 'supabase/call-privacy.sql'], { stdio: 'inherit' });
  if (r.status !== 0) fail('Schema install failed (see the psql error above).');
  console.log('✓ Installed growth_events, append_growth_event and erase_call_contact');
  // PostgREST caches the schema; ask it to reload so the REST check below sees the new table.
  spawnSync(psql, [db, '-q', '-c', "notify pgrst, 'reload schema'"], { stdio: 'inherit' });
} else console.log('• SUPABASE_DB_URL not set: skipping install, checking only');

if (!base || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to verify.');
const headers = k => (k.startsWith('eyJ') ? { apikey: k, Authorization: 'Bearer ' + k } : { apikey: k });
let ok = false;
for (let i = 0; i < 10 && !ok; i++) {
  const r = await fetch(base + '/rest/v1/growth_events?select=seq&limit=1', { headers: headers(key) });
  if (r.ok) ok = true; else if (r.status === 401 || r.status === 403) fail('Server key rejected (' + r.status + '). Use the secret or service_role key, not the publishable one.');
  else await new Promise(res => setTimeout(res, 1000));
}
if (!ok) fail('growth_events is not visible over REST. Run the install, or in the dashboard reload the API schema.');
const counts = {};
for (const season of ['2025', '2026']) {
  const r = await fetch(base + '/rest/v1/growth_events?season=eq.' + season + '&select=seq', { headers: { ...headers(key), Prefer: 'count=exact', Range: '0-0' } });
  counts[season] = r.headers.get('content-range')?.split('/')[1] ?? '?';
}
console.log('✓ Server key can read growth_events (events: 2025=' + counts['2025'] + ', 2026=' + counts['2026'] + ')');
if (pub) {
  const r = await fetch(base + '/rest/v1/growth_events?select=seq&limit=1', { headers: { apikey: pub } });
  const rows = r.ok ? await r.json() : [];
  if (r.ok && rows.length) fail('The publishable key can read events. Row level security is not protecting the table.');
  console.log('✓ Publishable key cannot read events (row level security on)');
  const w = await fetch(base + '/rest/v1/rpc/append_growth_event', { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ new_event: { id: 'probe', season: '2025' }, expected_count: 0 }) });
  if (w.ok) fail('The publishable key can call append_growth_event.');
  console.log('✓ Publishable key cannot write (append_growth_event is service-only)');
}
