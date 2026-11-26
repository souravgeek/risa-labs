# Unmaad Sponsorship Growth Center

A sponsorship command center for **Unmaad, IIM Bangalore's cultural fest, in Bengaluru**, built for **Challenge B: sponsorship growth**. The North Star is **cash collected before the festival**, tracked as confirmed → invoiced → collected. In kind value is shown separately and never counted as cash.

Every number in the app comes from one metrics engine ([lib/metrics.ts](lib/metrics.ts)). The dashboard, the copilot, the call agent's brief, the tests and the eval runner all call it, so the copilot cannot disagree with the dashboard. Every view has an as of date, and nothing dated after it leaks in.

**The plan:** Unmaad 2027 (26 to 28 Feb 2027): **₹24.8L cash collected before the fest in the base case, ₹51.6L in the stretch**, against ₹16.8L in 2025. The five ranked strategies are in the [Prioritization framework](#prioritization-framework) and the arithmetic in [2027 plan arithmetic](#2027-plan-arithmetic); it reruns with `node scripts/plan-model.mjs`.

**Latest results:** metric, workflow, automation, phone call and filter tests 53/53 · copilot eval 30/30 (local engine) · call extraction 60/60 fields on 20 seeded calls (scripted). See [Test results](#test-results) for what each number does and does not cover.

**Where to find each part of this README:**

| Topic | Section |
| --- | --- |
| Research | [Real brands on the dataset](#real-brands-on-the-dataset), [Research and data findings](#research-and-data-findings-2025-as-of-festival-eve-11-apr-2025) |
| Assumptions | [Assumptions](#assumptions) |
| Detailed calculations | [Calculations](#calculations), [2027 plan arithmetic](#2027-plan-arithmetic) |
| Data sources | [Data sources](#data-sources) |
| Prioritization framework | [Prioritization framework](#prioritization-framework) |
| Setup instructions | [Quick start](#quick-start), [Deploying](#deploying) |
| Tools used | [Tools used](#tools-used) |
| Known limitations | [Known limitations](#known-limitations) |

---

## Quick start

**Prerequisites:** Node.js 22.13 or newer (storage and tests use the built in `node:sqlite`; Node 20 fails with "No such built in module: node:sqlite"), npm, and Python 3 only if you reimport the workbook.

```bash
npm install
npm run dev          # http://localhost:3000, with local SQLite storage and no keys needed
npm test             # metric checkpoints, append-only history, call safety rails
npm run eval         # copilot eval set; writes data/eval-report.json
```

With no keys set, the app runs fully offline. The copilot uses a deterministic local engine over the same tools, and the call agent runs scripted calls. Add a Gemini key to switch on the Gemini copilot, generated calls and browser voice.

### Environment variables

| Variable | Needed for | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Gemini copilot, generated calls, browser voice | unset → local engine |
| `GEMINI_TEXT_MODEL` | Copilot and call briefs | `gemini-3.8-flash` |
| `GEMINI_LIGHT_MODEL` | Call analysis, sponsor persona, classification | `gemini-3.5-flash-lite` |
| `GEMINI_LIVE_MODEL` | Browser voice (Gemini Live API) | `gemini-3.8-live` |
| `GEMINI_CALL_MODEL` | First choice for phone call turns | `gemini-3.5-flash` (minimal thinking) |
| `GEMINI_FALLBACK_MODELS` | Models tried when one is overloaded or out of quota | `gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite` |
| `GEMINI_CALL_HEDGE_MS` | Silence before a phone turn starts a fallback model | `2000` |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | Optional Gemini voice for the phone call | `gemini-3.8-flash-lite-tts`, `Kore` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Hosted persistence (required on Vercel) | unset → `.local/growth.sqlite` |
| `CRON_SECRET` | Hourly automations and the morning brief ([vercel.json](vercel.json)) | unset → cron disabled |
| `CAMPUSFEST_DATA_DIR` | Point local storage elsewhere (tests and evals use a temp dir) | `.local/` |

Model IDs live in [lib/gemini-core.ts](lib/gemini-core.ts) and are read from these env vars. Check them against the Gemini models page before a demo.

### Data import and seed

```bash
npm run import -- "/path/to/Sponsor Dataset.xlsx"   # rebuilds data/source.json
```

The importer joins on stable IDs only and drops exact duplicate rows (3 interactions, 1 qualification row and 2 opportunity history rows in the 2025 file). If the same ID appears with a different payload, the import stops before writing anything. Timestamps are stored in Asia/Kolkata. Simulated tables (invoices, payments, budgets and the 2026 season) are generated deterministically from [lib/metrics-seed.ts](lib/metrics-seed.ts) and tagged `simulated` or `assumption`. Details: [data/README.md](data/README.md).

For hosted persistence, set `SUPABASE_DB_URL` and run `npm run db:init`, which installs [supabase/schema.sql](supabase/schema.sql) and [supabase/call-privacy.sql](supabase/call-privacy.sql) and checks that only the server key can read or write. You can also paste both files into the Supabase SQL editor and run `npm run db:init` to verify. The server key can be a new `sb_secret_` key or a legacy `service_role` JWT. When Supabase is configured on a local machine, every save and erasure is also mirrored into `.local/growth.sqlite` (off on Vercel, or set `SUPABASE_MIRROR_LOCAL=0`). `npm run db:sync` copies any missing events in either direction and then checks that both stores are identical (`-- --check` reports only; `-- --from=supabase` rewrites the local copy if the two ever diverge). It backs up the local file first. Writes go to an append only `growth_events` table through `append_growth_event`, which only the service role can execute.

To reset a local workspace, stop the server and delete `.local/`.

### Deploying

The app is a standard Next.js build (`npm run build`) and runs on Netlify or Vercel.

1. Create a Supabase project and run `npm run db:init` once, as above. Hosted functions have no lasting disk, so Supabase is the store of record.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and, for the AI features, `GEMINI_API_KEY` (plus any model overrides) in the host's environment settings.
3. **Netlify:** connect the repo; the Next.js runtime is detected automatically. [netlify.toml](netlify.toml) tells Netlify's secret scanner to skip the three Gemini model name variables, because model names also appear as defaults in the code and this README. Secret scanning stays on for the API and Supabase keys.
4. **Vercel:** connect the repo and set `CRON_SECRET` to enable the hourly automations and the morning brief in [vercel.json](vercel.json).

---

## Real brands on the dataset

**Where the 2025 data comes from.** The "2025 history" workspace is the RISA assignment workbook (*Sponsor Dataset.xlsx*), imported unchanged by `npm run import` into `data/source.json`. The workbook's own event row is "CampusFest 2025" (12 to 13 Apr 2025), marked fictional. It is **not** real Unmaad 2025 data: the real Unmaad 2025 was held in late February. Brand names are swapped for real ones at load time (below). Invoices, payments, campaign budgets and the ₹25L cash target are simulated or assumed and labelled that way in the app.

The provided 2025 dataset describes its brands as fictional. To make the plan concrete, each of its 180 brands now carries a **real brand name**, chosen by a reproducible method (`npm run map-brands`):

1. **Register.** 210 real brands that suit a Bengaluru youth fest ([data/real-brands.json](data/real-brands.json)). 24 have fest sponsor evidence verified on a page we opened:
   - past Unmaad sponsors: Realme, Skullcandy, LG, Sparx, Kajaria, JSW, Pepsi, Nestlé, Swiggy, Hero MotoCorp, SBI, Amazon Pay ([Unmaad on KnowAFest](https://www.knowafest.com/explore/events/2022/01/2405-unmaad-22-iim-bangalore-cultural-festival-bengaluru));
   - Coca-Cola, Unmaad 2023 ([InsideIIM](https://insideiim.com/unmaad-2023-iim-bangalores-cultural-festival));
   - peer fest sponsors: OnePlus, Nivea, Oreo, LinkedIn, Colgate, Parle, Canara Bank, PVR, Levi's ([Mood Indigo](https://en.wikipedia.org/wiki/Mood_Indigo_(festival))), TECNO ([Rendezvous 2023](https://www.fonearena.com/blog/?p=387615)) and Eze Perfumes ([Mood Indigo 2023](https://fashionvaluechain.com/eze-perfumes-elevates-senses-as-title-sponsor-of-vogue-scented-by-partner-of-mood-indigo-iit-bombays-asias-largest-college-festival)).
2. **Relevance score (0 to 100)** = fest evidence (Unmaad 50, peer fest 35, none 0) + youth fit (10 to 30) + Bengaluru presence (5 to 20). Youth fit and Bengaluru presence are judgement calls, labelled as assumptions.
3. **Position:** each dataset brand is ranked by where it ended 2025: confirmed › open late › open early › lost › qualified with no deal › replied › no reply.
4. **Match:** within each industry, the nth best position gets the nth most relevant real brand ([data/brand-map.json](data/brand-map.json)). Verified fest sponsors hold 14 of the 24 confirmed slots.

**What stays honest:**
- **Only names change.** Every ID, stage, value and date is as provided, and every checkpoint test still passes.
- **Original names still work.** Each brand keeps its dataset name as a searchable alias, so "Evergreen Living" (now Nivea) still resolves in search and in the copilot.
- **No real people.** Contacts are shown by role.
- **Outcomes are the dataset's.** Every 2025 outcome is the provided fictional record, not something the real company did; the app and the copilot say so.
- **The live season and the Prospect Finder use real companies too.** The live season (Unmaad 2027) seeds its pipeline with the 72 most relevant brands. The Prospect Finder holds 150 real companies, shown by role, and only verified signals are labelled real.
- **Exclusions:** alcohol, tobacco and betting brands, and brands that no longer operate.

## Research and data findings (2025, as of festival eve, 11 Apr 2025)

| Finding | Number | Feature it drives |
| --- | --- | --- |
| Warm channels produced every confirmed deal | Warm: 48 attempts → 24 deals, ₹22.4L. Cold: 321 attempts → 0 deals | Campaign scorecard, scale/fix/stop verdicts, warm intro engine |
| Cold deals froze instead of being lost | 26 open deals, ₹14.4L, no stage change for 12 to 80 days (median about 42) | Stalled deal alerts, call agent check in calls |
| Qualified brands never became deals | 18 qualified brands with no deal | Leakage detector, money list |
| Deals opened for unfit brands | 15 of 33 cold deals were on brands that were not qualified | Leakage detector (rule 4) |
| Cold follow ups did nothing | About 165 second and third touches, 0 positive replies | Third cold touch warning |
| Deals slowed after the target rose | About 4 a week before 15 March, about 2 a week after, against about 2.8 needed | Pacing chart |
| Upselling was barely tried | 1 second deal (Beardo) out of 24 confirmed sponsors | Upsell suggestions, inventory |
| No cash data at all | No invoices, payments or spend in the dataset | Collections tracker (simulated ledger) |
| Owner load was lopsided | Kabir Shah held 126 of 180 brands | Owner workload |

**Demo date: 20 Mar 2025**, 23 days before the festival. At that date 19 of 28 deals are confirmed (₹16,60,000) and 31 deals are open (₹20,20,000). Of those, 19 have been stalled for more than 7 days (₹9,10,000). 17 qualified brands have no deal, 12 of them from warm channels. 2.7 deals a week are needed.

---

## Prioritization framework

One rule runs through every level: **rank work by the cash it is expected to bring in before the festival, discounted by how strong the evidence is and how long the cash takes to arrive.** The same rule ranks the season's strategies, decides what to build first and orders each owner's day in the app.

### 1. Strategies for Unmaad 2027

Each strategy is scored on four questions:

| Criterion | Question | How it's measured |
| --- | --- | --- |
| Cash impact | How much cash does it add before the fest? | Base and stretch cash from the [plan model](#2027-plan-arithmetic) |
| Evidence | Is the conversion rate observed in 2025, or assumed? | `source` rates rank above `assumption` rates |
| Time to cash | How soon can the money land? | Existing relationships beat new ones; anything that needs a long sales cycle ranks lower |
| Cost and risk | What does it cost in team time, and what goes wrong if it fails? | Strategies that depend on one big deal or on unproven channels rank lower |

| Rank | Strategy | Base cash | Stretch cash | Evidence | Why it sits here |
| ---: | --- | ---: | ---: | --- | --- |
| 1 | Renew and upsell 2025 sponsors | ₹9.0L | ₹15.0L | 24 sponsors and the ₹1L average cash deal are source; renewal rates (45% / 65%) are assumed | Known buyers who already paid once. Fastest cash and the cheapest pitch, so it starts first |
| 2 | Warm intro engine | ₹12.5L | ₹16.7L | 50% warm win rate is source (48 attempts → 24 deals); 30 / 40 intros a season is assumed | Largest base cash and the strongest observed rate, but the intros have to be generated before deals can start, so it ranks behind renewals on time to cash |
| 3 | Leak recovery and stalled revival | ₹6.0L | ₹11.7L | Pools are source (12 warm and 6 cold qualified brands with no deal, 26 stalled cold deals); recovery haircuts are assumed | Cheap, because the brands already qualified, but cold pools barely converted in 2025, so the expected value is smaller |
| 4 | Collections push | +₹1.6L | +₹4.4L | 2025 collection rate (84%) is simulated; 90% / 92% targets are assumed | Adds no deals. It turns signed cash into collected cash, which is the North Star, at almost no cost |
| 5 | Anchor (title) sponsor | ₹0 | ₹12.0L | No ₹12L deal in 2025; value is assumed | High value but a single deal with no precedent, so it is stretch only and never in the base case |
| | Cold outreach | ₹0 | ₹0.8L | Source: 321 cold attempts → 0 deals | Not funded as a strategy. Capped at 100 test attempts so it can't take time from the work above |

### 2. What to build first

Features were ordered by how directly they move cash collected and by what the brief weights most:

- **P0** is the dashboard and copilot (40% of the grade): without one trusted metrics engine, nothing else can be measured.
- **P1** acts on the largest 2025 findings in the [research table](#research-and-data-findings-2025-as-of-festival-eve-11-apr-2025): warm channels won every deal (scale/fix/stop verdicts), deals stalled (alerts and the call agent) and qualified brands leaked (leakage detector, money list).
- **P2** grows next season's pipeline (Prospect Finder, warm intro engine, inventory). It is valuable but pays out later.
- Features that conflict with consent or honesty (cold AI calls, LinkedIn scraping, an agent that passes as human) are excluded however much they could add. See [Deliberately not built](#deliberately-not-built).

### 3. What to work on today (in the app)

The app applies the same rule to individual records. All weights and thresholds can be edited in **Settings**.

| Where | What it ranks | Ordering |
| --- | --- | --- |
| Money list (Decision desk) | Open deals and qualified brands with no deal | Expected cash, highest first. A deal's expected cash is its forecast E_i (see [Forecast](#forecast)). A brand's is its channel group's win rate × the average deal size. Ties go to the larger value |
| Weekly action plan (copilot "Do it") | The actions a person confirms in one batch | 1) open deals for every warm qualified brand with no deal, 2) follow up the 5 largest stalled deals by value, 3) pause active campaigns with a *Stop* verdict |
| Stalled deal alerts | Deals past their stall threshold | Value, then days in stage |
| Bottleneck finder | Funnel steps converting below the benchmark season | Cash lost = (benchmark rate minus actual rate) × brands entering the step × average cash deal × downstream win rate |
| Campaign verdicts | Channels | Scale / fix / stop rules in [Other rules](#other-rules) |
| Prospect Finder | New companies | Score = 0.4 fit + 0.4 warmth + 0.2 timing. Fit = 0.45 industry win rate (Laplace smoothed) + 0.35 role seniority and relevance + 0.2 youth focus. Opted out or do not contact prospects and category exclusivity conflicts are excluded first. A prospect with a warm connection becomes an intro request; the rest join a cold queue capped at 10 a day (editable) |

---

## Calculations

### As of rules
1. The cutoff is the selected date at 23:59:59 IST.
2. Brands, contacts, campaigns and deals count only if `created_at` ≤ cutoff. Interactions count only if `occurred_at` ≤ cutoff.
3. For histories (qualification, deal stage, targets), the engine takes each entity's latest version with `effective_at` ≤ cutoff. Versions are never added together.
4. Planned campaign dates are treated as plans, not evidence.
5. Added tables (invoices, payments, tasks and calls) follow the same rule on their own timestamps.

### Funnel and metric definitions

| Metric | Definition |
| --- | --- |
| Contacted | Distinct brands with a first touch (`outreach_sent`, `introduction_received` or `web_inbound`) |
| Responded / positive | Distinct brands with a `replied` event / a `replied` event marked positive |
| Meeting held | Distinct brands with `meeting_held` |
| Qualified | Brands whose latest qualification is `qualified` |
| Deals | Opportunities created by the cutoff |
| Reached proposal | Deals whose history includes `proposal_sent`, `negotiating` or `partner_confirmed` |
| Confirmed | Latest stage `partner_confirmed`, valued at `confirmed_value_inr` |
| Open pipeline | Latest stage prospecting, contacted, proposal sent or negotiating, valued at `proposed_value_inr` |
| Invoiced | Invoices issued by the cutoff and not voided |
| **Cash collected (North Star)** | Payments received by the cutoff and before the festival starts |
| Overdue | Unpaid invoice amount with `due_at` before the cutoff |
| Win rate | Confirmed ÷ (confirmed + lost + withdrawn, plus still open at the festival) |
| Days in stage | Cutoff minus the latest version's `effective_at` |

### Forecast

```
P_win(s, g) = (W_sg + 1) / (N_sg + 2)          Laplace-smoothed win chance by stage s and channel group g
E_i         = V_i × c_i × P_win × P_time × P_pay
```
- V is the proposed value. c is 1 for cash and 0 for in kind.
- P_time is the share of past wins from that stage that confirmed within the days left, minus the payment lag.
- P_pay is the on time payment rate from settings.

The forecast has three levels:

- **Committed:** cash collected + unpaid invoices due before the festival × P_pay.
- **Base:** committed + ΣE across open deals.
- **Stretch:** base + the expected value of leaked qualified brands, valued at their group's win rate × average deal size.

As of 20 Mar 2025 the levels are: committed ₹6,38,000, base ₹10,08,076, stretch ₹18,62,212.

### Other rules
- **Pacing:** deals needed per week = (target minus confirmed) ÷ weeks left. Target versions follow the history: 40/20 at launch, then 55/28 from 15 March.
- **Stalled:** days in stage > max(7, 2 × the median days won deals spent in that stage).
- **Small samples:** any segment under 10 records is labelled *directional*, and the copilot says so.
- **Scale/fix/stop verdicts:** *Stop* means at least 40 attempts, 0 confirmed and under 10% positive replies. *Fix* means 0 confirmed but at least 10% positive replies. *Scale* means a win rate of 50% or more with at least 5 closed deals. As of 11 Apr 2025: Stop for Brand Discovery Email; Fix for Brand Leader LinkedIn and Past Conversation Revival; Scale for the three warm channels.
- **Deadline cutoff per stage:** festival date minus the median days won deals took from that stage to confirmed minus the payment lag.

### Checkpoints (unit tested in [tests/metrics.test.ts](tests/metrics.test.ts))

| As of | Qualified (target) | Confirmed (target) | Confirmed value | Open pipeline |
| --- | --- | --- | ---: | ---: |
| 15 Feb 2025 | 24 (40) | 2 (20) | ₹1,70,000 | 17 deals, ₹11,55,000 |
| 15 Mar 2025 | 55 (55) | 17 (28) | ₹15,05,000 | 30 deals, ₹18,90,000 |
| 20 Mar 2025 | 58 (55) | 19 (28) | ₹16,60,000 | 31 deals, ₹20,20,000 |
| 11 Apr 2025 | 60 (55) | 24 (28) | ₹22,40,000 (₹20,00,000 cash + ₹2,40,000 in kind) | 26 deals, ₹14,40,000 |

Also checked as of 11 Apr 2025, with the rule windows set to 0: 18 qualified brands with no deal, 15 deals on unqualified brands and 26 stalled deals.

### 2027 plan arithmetic

From [scripts/plan-model.mjs](scripts/plan-model.mjs) (`node scripts/plan-model.mjs` reprints it). Rates taken from 2025 (`source`):

- Average cash deal: ₹20,00,000 ÷ 20 cash deals = **₹1,00,000**.
- Cash share of deals: 20 of 24 confirmed = **83%**.
- Warm win rate per attempt: 24 ÷ 48 = **50%**. Warm win rate per qualified brand: 24 ÷ 36 = **67%**. Cold: 0 ÷ 321 = **0%**.
- 2025 collection rate: ₹16,82,500 collected ÷ ₹20,00,000 confirmed cash = **84%** (simulated payments).

Formulas, per strategy (cash signed = deals × 83% × ₹1L, except the title deal):

| Strategy | Deals formula | Base deals → cash | Stretch deals → cash |
| --- | --- | ---: | ---: |
| Renew and upsell | 24 sponsors × renewal rate (45% / 65%); cash × upsell (1.00 / 1.15) | 10.8 → ₹9.0L | 15.6 → ₹15.0L |
| Warm intro engine | intros (30 / 40) × 50% | 15.0 → ₹12.5L | 20.0 → ₹16.7L |
| Leak recovery | 12 warm × 67% × haircut (0.5 / 0.75) + 32 cold × (10% / 25%) | 7.2 → ₹6.0L | 14.0 → ₹11.7L |
| Anchor (title) sponsor | 0 / 1 deal at ₹12L | 0 → ₹0 | 1.0 → ₹12.0L |
| Capped cold test | 100 attempts × (0% / 1%) | 0 → ₹0 | 1.0 → ₹0.8L |
| **Total signed** | | **33.0 → ₹27.5L** | **51.6 → ₹56.1L** |
| Collected at the 2025 rate (84%) | | ₹23.1L | ₹47.2L |
| **Collected with the collections push** (90% / 92%) | | **₹24.8L** | **₹51.6L** |

Against 2025's ₹16.8L collected, the base case is +48% and covers the assumed ₹25L target almost exactly. The live season targets in the app (33 deals, 50 qualified, ₹25L) come from this base case.

---

## Assumptions

Each assumption is tagged in the app with the same label used here.

| Assumption | Default | Tag |
| --- | --- | --- |
| 2025 brands, contacts, campaigns, interactions, deals and targets | Workbook rows, unchanged | source |
| Invoice milestones | 50% on confirmation, due in 15 days; 50% due 7 days before the festival | simulated |
| Payment behaviour | 80% on time, 15% up to 10 days late, 5% unpaid at the festival | simulated |
| Cash target | ₹25,00,000 (the workbook has no rupee target) | assumption |
| Campaign budgets | One figure per campaign, from ₹12,000 to ₹40,000; ROI is labelled assumed | assumption |
| Owner capacity (hours a week) | Per owner, in `team_members` | simulated |
| Live season | Unmaad 2027, 26 to 28 Feb 2027; 72 real brands, simulated outcomes; targets from the base plan (33 deals, 50 qualified, ₹25L) | simulated |
| Real brand relevance scores | Youth fit 10 to 30, Bengaluru presence 5 to 20 | assumption |
| 2027 plan rates | Renewal 45% / 65%, leak recovery, 30 / 40 warm intros, one ₹12L title deal (stretch) | assumption |
| Call agent discount ceiling | 10% | assumption |
| Sponsor persona traits for simulated calls | Seeded per call | simulated |
| Intros per referral partner | Scenario planner input | assumption |
| Prospect Finder weights | 0.4 fit + 0.4 warmth + 0.2 timing | assumption |
| Package prices | ₹25K, ₹40K, ₹55K, ₹90K and ₹1.1L tiers, from 2025 price clusters | assumption |

Every threshold, window, rate and weight can be edited under **Settings**. Changes recalculate everywhere without a deploy.

---

## What's built

### P0 (dashboard and copilot, 40% of the grade)
- **Command center:** cash waterfall; in kind tile kept outside the cash total; days to the festival; clickable brand funnel; targets vs actual on the target version in force at the as of date; pacing chart; committed/base/stretch forecast with "how this was calculated"; provenance tags on every tile.
- **Diagnosis:** campaign scorecard (RAG status, directional flags, ROI on assumed budgets); stalled deal alerts with bulk task creation; leakage detector with six rules and "create tasks".
- **Execution hub:** drag and drop pipeline board, where a lost deal asks for a reason and a confirmed deal asks for a value; brand pages; campaign manager, where pausing a campaign blocks new outreach against it; tasks (My day, Overdue, By owner, By source); collections tracker; three core automations; activity log; notifications.
- **Copilot:** a side panel on every page that receives the page's as of date and filters. Read tools run the metrics engine, and answers end in a fixed schema with evidence, assumptions, sample size and missing data. Writes go through a preview card and need **Confirm** before anything changes. A number check flags any figure that isn't in the turn's tool outputs. Each thread remembers its date and filters, so "now only LinkedIn" and "and a month earlier?" work without repeating context.

### P1
- **Diagnosis extras:** what changed between two dates, with the forecast change split by cause; bottleneck finder; owner workload.
- **Decision desk:** scale/fix/stop verdicts with their evidence; money list; scenario planner (save and compare up to 3); deadline cutoffs.
- **More automations:** positive reply → "book meeting"; confirmed → "ask for 2 intros" and "upsell". A third cold touch to the same brand logs the touch but warns the user and notifies the owner. A **rule builder** in Settings lets anyone add their own rules: pick a trigger (deal confirmed, stage change, deal lost, positive reply or payment recorded), optionally narrow it by channel group or minimum value, and it creates a task for the record's owner, with an optional notification. Rules can be paused or deleted.
- **AI call agent:**
  - Covers warm contacts only: payment reminders, stalled deals and inbound leads.
  - Every call opens with a fixed AI disclosure line, and a call whose transcript lacks it is flagged.
  - A hard allowlist plus consent gates every call. Numbers are never sent to Gemini.
  - Limits: 3 calls per contact per day, a 5 minute cap and a kill switch.
  - Every extracted field must carry a quote found in the transcript, or it is set to unknown.
  - An opt out applies instantly. Stage and payment promise changes wait for a person to confirm.
  - Modes: **phone call** (the default, inside the app: Gemini pitches and you answer as the sponsor by voice or text; see below), simulated text (scripted offline, or Gemini playing both sides), and browser voice over the Gemini Live API with an ephemeral token per call.

### P2
- **Prospect Finder:** CSV, manual and simulated inputs, with no LinkedIn scraping. Prospects are deduplicated against existing brands and scored on fit, warmth and timing. Warm prospects become intro requests, and the rest join a capped cold queue.
- **Warm intro engine:** intro tasks and a referrer leaderboard.
- **Inventory and sales tools:** packages and inventory with an exclusivity check, upsell suggestions, AI proposal drafts and the morning brief.

### Deliberately not built
- LinkedIn scraping or automation.
- Cold AI calls to strangers.
- An agent that passes as human.
- Real email or LinkedIn sending.
- ML lead scoring: 58 deals is too few to train on.
- Multitouch attribution.
- Vector search.
- Full login and roles: a "view as owner" switch stands in.

The reasons for each are in the build spec.

---

## Test results

| Suite | Command | Latest |
| --- | --- | --- |
| Metric checkpoints, no leakage, dedupe, append only, changed data, decision desk, prospect routing, custom rules, cold touch warning, copilot question parsing, phone call streaming, hedging, spoken date resolution and linked filters | `npm test` | 53 / 53 passing |
| Copilot eval: 10 lookup, 6 calculation, 5 diagnosis, 4 follow up, 5 can't answer | `npm run eval` | **30 / 30 (100%)** on the local engine |
| Call extraction on 20 seeded calls (interest, decision maker, objection) | part of `npm test` | **60 / 60 fields**, disclosure present in all 20 |
| Call safety: allowlist, consent, daily limit, opt out, deletion | part of `npm test` | passing |

How to read these:
- **Expected values are computed, not typed.** Eval cases compute their expected values from the metrics engine when they run, so the set stays valid after a reviewer changes the data. Results are written to [data/eval-report.json](data/eval-report.json).
- **The eval run above used the local engine.** With `GEMINI_API_KEY` set, the same runner exercises the Gemini tool loop. That run has not been recorded yet, so record it before quoting a Gemini pass rate.
- **The 60/60 extraction score comes from scripted transcripts**, scored by the local extractor. It is a regression test for the quote and verify pipeline, not a measure of Gemini's accuracy on free conversation. To measure that, run the 20 seeded persona calls in Gemini mode.

---

## Demo scripts

**Workflow A: from copilot insight to action (as of 20 Mar 2025)**
1. Ask "Why are we behind on partnerships?" The copilot answers that 19 of 28 deals are confirmed with 23 days left, 2.7 deals a week are needed, 19 stalled deals are worth ₹9,10,000, and 17 qualified brands have no deal, 12 of them warm.
2. Ask "What should we do this week?" It recommends opening deals for the warm brands, following up on the largest stalled deals and pausing Stop campaigns.
3. Say "Do it." A preview card lists 18 actions. Confirm them, and the deals appear on the board, the tasks appear on owners' lists, and the leakage count drops.
4. Ask "How much cash does that add before the festival?"
5. Ask "Which of these sponsors will renew next year?" The copilot declines and names the data that would answer it.
6. Change a deal's stage on the board, then ask step 1 again. The numbers move with the dashboard.

**Workflow B: call agent**
1. Go to Call agent → Add contact. Add yourself, playing **Nivea** (the dataset's "Evergreen Living" record).
2. Click Start a call, choose Nivea, then review the brief: negotiating, ₹90,000, 42 days in stage, and the AI disclosure line.
3. Keep the mode on **Phone call** and confirm. The agent opens with the AI disclosure line and its reason for calling.
4. Answer as the sponsor. Speak (the mic sends your line when you pause) or type, and raise an objection, for example "Budget's locked until April, and I need my CMO's sign off." Each agent reply shows how long it took to start talking.
5. Agree a next step ("send me a two instalment proposal and a one pager for the CMO by Friday") and say bye, or press Hang up.
6. The insight card shows each field with its quote, including the next step date resolved from "by Friday". Mark it reviewed, and the task, notification and timeline entry appear.

### Phone call inside the app

The phone call takes the place of the Twilio bonus: the whole call runs inside the app, so there are no phone numbers or telephony on demo day. The pipeline and latency techniques follow the [realtime phone agents course](https://github.com/neural-maze/realtime-phone-agents-course) (FastRTC, STT → LLM → TTS), adapted to the browser and Gemini:

| Course technique | How it's done here |
| --- | --- |
| Stream every stage, speak as soon as possible | `/api/calls/turn` streams Gemini's reply as NDJSON. Each finished sentence is spoken while the next one is still being generated |
| `ReplyOnPause` (voice activity detection) | Browser speech recognition with live captions sends your line after 0.8 s of silence |
| Fixed first message | The opening line (disclosure + reason for the call) is templated, so pickup has no model wait |
| Fast model, short spoken replies | `gemini-3.5-flash` with minimal thinking. Replies are one to three sentences with amounts said in rupees, as words |
| Keyboard sound while the agent works | A soft synthesised typing cue plays until the agent's first word |
| Streaming TTS | Optional Gemini voice: PCM streams per sentence and plays without gaps; the browser voice is the instant default |
| Tracing per stage (Opik) | Each turn records pause detection, time to first sentence, Gemini voice time and the model used. Every agent bubble shows its response time |

**Calendar.** The call happens today, in real time: the agent treats the real date (IST) as "today", and the deal facts are records as of the workspace date (for example, "the invoice was due on 16 March 2025"). The server gives the agent a ready made calendar (tomorrow, one and two weeks out, the end of the month, and the next 21 days with weekdays), so it never calculates a date itself. Promised and follow up dates can't be in the past, and the review card offers a promise the agent recorded even when the sponsor's words didn't state it outright.

Two additions for reliability:
- **Hedged requests.** If a model hasn't sent a token within 2 s, a fallback model starts. If that stalls as well, all remaining models start at once, and the first to stream wins. A quota error moves on immediately, with no hidden SDK retries.
- **Adaptive ordering.** The model that answered most recently is tried first, and a model that just stalled waits two minutes before it is tried again. The copilot and call analysis share the same model health.

The call keeps the same safety rails as every other mode: consent allowlist, 3 calls per contact per day, a 5 minute cap, an instant opt out on "stop calling", sponsor words saved before the agent replies, and proposals that a person must approve.

Measured on 25 Nov 2026 against the live Gemini API (free tier key):

| | Before | After |
| --- | --- | --- |
| Pickup | ~4.3 s (opening written by the model) | instant (templated) |
| Agent reply, healthy model | 3 to 9 s (whole turn, then speak) | **0.8 to 1.9 s** to the first sentence |
| Reply when a model stalls | 21 s (SDK retries) | 8.7 s, now bounded by escalating hedges |
| Gemini voice, first audio | 4 to 5.6 s (whole file) | ~0.7 s after the first sentence (streamed) |

---

## Architecture

- **Frontend:** Next.js App Router with TypeScript and Recharts.
- **API:** route handlers under [app/api](app/api) for the workspace, metrics, copilot, calls, drafts and cron.
- **Storage:** an append only event log. Locally that's SQLite through `node:sqlite`; when hosted, it's Supabase Postgres. Snapshots are rebuilt from the source data plus events for any as of date, so every write adds a full state version and earlier snapshots never change.
- **Gemini:** called only on the server through `@google/genai`; the API key never reaches the browser. Browser voice connects straight to the Gemini Live API with a single use ephemeral token minted for each call.

| Path | What it holds |
| --- | --- |
| [lib/metrics.ts](lib/metrics.ts) | The metrics engine: snapshot, funnel, cash, pacing, forecast, stalled, leakage, verdicts |
| [lib/decision.ts](lib/decision.ts) | What changed, bottlenecks, scenarios, deadlines, Prospect Finder scoring |
| [lib/workspace.ts](lib/workspace.ts), [lib/growth-actions.ts](lib/growth-actions.ts) | Commands that write events, plus automations |
| [lib/assistant.ts](lib/assistant.ts), [lib/gemini-copilot.ts](lib/gemini-copilot.ts) | Copilot tools, question context, the local engine and the Gemini tool loop |
| [lib/voice-service.ts](lib/voice-service.ts), [lib/gemini-calls.ts](lib/gemini-calls.ts), [lib/voice-client.ts](lib/voice-client.ts) | Call briefs, safety rails, transcript analysis and the Live client |
| [components/](components) | UI pages |

---

## Tools used

| Area | Tools |
| --- | --- |
| App framework | Next.js 16 (App Router), React 19, TypeScript 5.9 |
| AI | Google Gemini through `@google/genai`: text models for the copilot and call agent, Live API for browser voice, TTS for the phone call voice |
| Storage | Supabase Postgres (hosted), SQLite through `node:sqlite` (local) |
| UI | Tailwind CSS 4, Base UI and Radix Slot, Recharts, TanStack Table, dnd-kit, Lucide icons, sonner, DM Sans and Manrope |
| Data | Python 3 (workbook importer), papaparse (CSV in the Prospect Finder) |
| Testing | Vitest, tsx (eval runner), Playwright (headless Chrome checks of the demo workflows) |
| Hosting | Netlify or Vercel, with Vercel Cron for scheduled automations |

### Reuse and credits

- **UI:** Button, Badge and Card come from [Tastemaker](https://github.com/codeswithroh/tastemaker) at commit `792a28a`, restyled with this project's tokens ([.tastemaker/style-lock.md](.tastemaker/style-lock.md), licence in [licenses/tastemaker.txt](licenses/tastemaker.txt)). The app shell layout follows Tastemaker's guidance.
- **Libraries:** Recharts, TanStack Table, dnd-kit, Lucide icons, sonner, papaparse and DM Sans.
- **Hero image:** a festival photograph by Nicolás Flor on Unsplash ([credits](public/images/CREDITS.md)).
- **Verification:** every checkpoint number in this README is asserted by a test or computed by the eval runner. Both workflows above were run in headless Chrome against a production build.

---

## Known limitations

- **Cash is simulated.** There are no bank receipts; invoices and payments come from the documented assumptions.
- **ROI uses assumed budgets**, because the dataset has no spend.
- **Activations are association, not cause.** The dataset has no sponsor budgets, no lost reasons (until call insights exist) and no renewal history. The copilot declines questions that need these.
- **The local copilot engine is pattern based.** It covers the metric families and follow ups in the eval set. Freeform questions outside them need a Gemini key.
- **Browser voice needs a Gemini key and microphone permission.** Live sessions are audio only and capped at 15 minutes by the API; the app caps calls at 5 minutes. Model IDs and Live limits can change.
- **The free Gemini tier is too small for a demo day.** This key allows 20 requests per day per Flash model and 10 per day for TTS. Each phone call turn uses one request, plus up to two with Gemini voice, and hedging adds requests only when a model stalls. Enable billing on the key before the interview, or the call falls back to slower lite models.
- **Phone call voice input needs Chrome, Edge or Safari** (Web Speech API) and microphone permission. Typing always works.
- **There is no real telephony.** The phone call runs in the browser. A real Twilio call would need a paid number with India calling and an always on WebSocket bridge, which a Vercel function cannot hold.
- **Supabase is required when hosted**, because local SQLite does not persist on serverless. On Vercel the app refuses to write without Supabase. That check only knows about Vercel, so on Netlify a missing Supabase config is not caught: writes land in temporary storage and are lost.
- **Scheduled automations run only on Vercel Cron.** Netlify has no schedule configured, so there the hourly automations and morning brief run only if something calls `/api/cron` with `Authorization: Bearer $CRON_SECRET`.
- **Automations act only on the live season** (Unmaad 2027, stored as season `2026`), never on a past as of view.
- **The 2027 plan rests on assumed rates.** Renewal, intro volume, recovery haircuts and the title deal are assumptions (see the plan tables). Only the 2025 conversion rates are observed.

---

## Data sources

| Source | Used for | Tag in app |
| --- | --- | --- |
| `Sponsor_Dataset.xlsx` and the RISA Growth APM assignment brief (provided) | All 2025 brands, contacts, campaigns, interactions, deals and targets (row counts in [data/README.md](data/README.md)) | source |
| [lib/metrics-seed.ts](lib/metrics-seed.ts) (deterministic generator) | Invoices, payments, campaign budgets and the Unmaad 2027 season | simulated / assumption |
| [data/real-brands.json](data/real-brands.json) | 210 real brands with relevance scores and fest sponsor evidence | source (evidence) / assumption (scores) |
| [KnowAFest: Unmaad 2022](https://www.knowafest.com/explore/events/2022/01/2405-unmaad-22-iim-bangalore-cultural-festival-bengaluru), [InsideIIM: Unmaad 2023](https://insideiim.com/unmaad-2023-iim-bangalores-cultural-festival) | Past Unmaad sponsors | source |
| [Mood Indigo (Wikipedia)](https://en.wikipedia.org/wiki/Mood_Indigo_(festival)), [Rendezvous 2023 (FoneArena)](https://www.fonearena.com/blog/?p=387615), [Eze Perfumes at Mood Indigo 2023](https://fashionvaluechain.com/eze-perfumes-elevates-senses-as-title-sponsor-of-vogue-scented-by-partner-of-mood-indigo-iit-bombays-asias-largest-college-festival) | Peer fest sponsors | source |
| [Unsplash](public/images/CREDITS.md) | Hero image | |

Technical references:

- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini Live API capabilities guide](https://ai.google.dev/gemini-api/docs/live-guide)
- [Gemini Live API over WebSockets, ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Realtime phone agents course (The Neural Maze)](https://github.com/neural-maze/realtime-phone-agents-course): pipeline and latency techniques for the in app phone call
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- LinkedIn v. Proxycurl coverage (ZoomInfo) and TRAI's amended rules on automated calls (Upstox), as cited in the build spec
