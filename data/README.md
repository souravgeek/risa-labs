# Unmaad sponsorship records and metric definitions

Brand names: the 2025 records carry real brand names mapped onto the provided fictional data (see the main README, "Real brands on the dataset"). The original names are kept as aliases.

The 2025 workspace is built from the ten data sheets in the local **Sponsor Dataset.xlsx**. Its readme describes the event, people, brands and outreach as fictional. “Source” in the UI means a workbook row. The two documentation sheets are excluded. Contacts contain names and roles. There are no phone numbers or bank receipts.

Run `npm run import -- "/path/to/Sponsor Dataset.xlsx"` to rebuild `data/source.json`. The importer uses Python's zipfile and XML libraries, preserves source IDs, ignores blank formatting rows and converts Excel dates into India Standard Time. Exact duplicate IDs collapse. A conflicting payload for the same ID fails before any output is written.

| Table | Unique rows | Repeated rows removed |
| --- | ---: | ---: |
| Event | 1 | 0 |
| Targets | 2 | 0 |
| Brands | 180 | 0 |
| Sponsor contacts | 270 | 0 |
| Sponsor campaigns | 6 | 0 |
| Sponsor interactions | 950 | 3 |
| Brand qualification history | 433 | 1 |
| Opportunities | 58 | 0 |
| Opportunity history | 228 | 2 |
| Sponsor activations | 3 | 0 |

## Snapshot engine

`lib/metrics.ts` exports `snapshot({ season, asOf, filters, additions, settings })`. A date includes events through 23:59:59.999 IST. Each deal, brand and target takes its most recent eligible history row. History updates at the same time retain append order. Filter by campaign ID or name, channel name or warm/cold group, industry, and owner ID or name. Deals are credited to their originating campaign. Percentages are fractions and monetary amounts are integer rupees. The frontend and copilot use the server's snapshot engine.

| Snapshot | Qualified / goal | Confirmed / goal | Confirmed value | Open value (deals) |
| --- | --- | --- | ---: | ---: |
| 15 Feb 2025 | 24 / 40 | 2 / 20 | ₹1,70,000 | ₹11,55,000 (17) |
| 15 Mar 2025 | 55 / 55 | 17 / 28 | ₹15,05,000 | ₹18,90,000 (30) |
| 20 Mar 2025 | 58 / 55 | 19 / 28 | ₹16,60,000 | ₹20,20,000 (31) |
| 11 Apr 2025 | 60 / 55 | 24 / 28 | ₹22,40,000 | ₹14,40,000 (26) |

On 20 March the 19 stalled deals account for ₹9,10,000. All 17 qualified brands without a deal are available to the action planner, including 12 warm brands. The 3-day alert window contains 16 of them. On 11 April every confirmed deal came through a warm channel. ₹20 lakh is cash commitment and ₹2.4 lakh is in-kind commitment.

## Simulation and assumptions

- A separate deterministic live workspace in `lib/metrics-seed.ts` plans Unmaad 2027 (26–28 Feb 2027) with the 72 most relevant real brands and simulated outcomes. The local demo date is 25 November 2026, 93 days before the fest.
- There is no workbook rupee target. The default cash target is an assumed ₹25 lakh. Counts targets come from the effective targets row.
- Simulated milestone invoices are calibrated to the 20 festival-eve confirmed cash deals in the archive. Cobalt Learning's withdrawn deal remains in the source stage ledger. The first milestone is 50% at confirmation, due in 15 days. The balance is due seven days before the festival, and issued up to 15 days before it is due. Confirmation is the earliest issue or due date for either milestone.
- A reproducible 20-milestone cycle allocates 80% of payments on time, 15% late by up to ten days and 5% unpaid. For the 11 April snapshot this produces ₹16,82,500 collected. Only receipts before the festival starts count toward the North Star. If staff record an early payment against a simulated invoice, simulated settlement applies to the balance.
- Campaign budgets default to assumptions ranging from ₹12,000 to ₹40,000. ROI is (confirmed partnership value − budget) / budget. Reply and positive rates use distinct attempts. Before festival eve the win denominator counts terminal deals; by festival eve it also counts unresolved deals. Samples below ten terminal/evaluated deals carry a directional label.
- For an open cash deal, forecast contribution equals proposed value × (wins + 1)/(closed + 2) for its stage and channel × observed share of wins fast enough to collect with the remaining time × assumed on-time payment rate. Timing uses pooled stage evidence if its channel has no wins. Committed forecast adds expected pre-festival unpaid invoices to collected cash. Base adds open-deal contributions. Stretch adds the estimated value of qualified brands without deals. The stalled threshold is the greater of the configured floor and twice the median time won deals spent in their current stage.
- In-kind deals have no invoice, collected cash or cash forecast contribution. Expected cash, opportunity at risk and campaign association are estimates, not bank receipts or causal attribution.

Use `npm test -- tests/metrics.test.ts` for source checkpoints, filter consistency, import de-duplication, calendar boundaries, stage and target revisions, payment cutoffs, and season isolation.
