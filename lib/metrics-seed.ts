import raw from "../data/source.json";
import type { SourceData, Season } from "./data-types";
import { BRAND_MAP, RANKED } from "./brand-register";

/**
 * The provided 2025 dataset with real brand names mapped on (lib/brand-register.ts). Only names change:
 * every ID, stage, value and date is as provided. The original name stays on the brand as
 * `dataset_brand_name`, so questions that use the dataset's names still resolve. Contacts are shown by
 * role, so no fictional person appears to work at a real company.
 */
function withRealNames(data: typeof raw) {
  const out: Record<string, unknown> = { ...data };
  for (const [sheet, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    out[sheet] = rows.map((r: Record<string, unknown>) => {
      const m = typeof r.brand_id === "string" ? BRAND_MAP[r.brand_id] : undefined;
      const row: Record<string, unknown> = { ...r };
      if (m && m.name !== m.original)
        for (const [k, v] of Object.entries(row)) if (typeof v === "string" && v.includes(m.original)) row[k] = v.split(m.original).join(m.name);
      if (sheet === "brands" && m) row.dataset_brand_name = m.original;
      if (typeof row.contact_name === "string" && row.contact_id) { row.dataset_contact_name = row.contact_name; row.contact_name = CONTACT_ROLE.get(String(row.contact_id)) ?? "Brand contact"; }
      return row;
    });
  }
  return out as unknown as SourceData;
}
const CONTACT_ROLE = new Map((raw.sponsor_contacts as { contact_id: string; job_title: string }[]).map(c => [c.contact_id, c.job_title]));
export const ARCHIVE = { ...withRealNames(raw), invoices: [], payments: [] } as SourceData;
export const OWNER_NAMES: Record<string, string> = {
  T01: "Riya Kapoor",
  T02: "Kabir Shah",
  T03: "Meera Iyer",
  T05: "Nisha Rao",
};
export const START_DATES = { "2025": "2025-01-15", "2026": "2026-09-22" };
// The live season plans Unmaad 2027, IIM Bangalore's cultural fest (Fri 26 – Sun 28 Feb 2027); the workspace key stays "2026".
export const FESTIVAL_DATES = { "2025": "2025-04-12", "2026": "2027-02-26" };
export const DAY = 86400000;

export function dateShift(date: string, days: number) {
  return new Date(Date.parse(date.slice(0, 10) + "T00:00:00Z") + days * DAY)
    .toISOString()
    .slice(0, 10);
}
const stamp = (date: string, days = 0, time = "09:00:00") =>
  dateShift(date, days) + "T" + time + "+05:30";

const DEMO = Object.values(BRAND_MAP).find(b => b.original === "Evergreen Living");
const DEMO_BRAND = DEMO?.name ?? "Evergreen Living", DEMO_INDUSTRY = DEMO?.industry ?? "Consumer products";
const LIVE_BRANDS = RANKED.filter(b => b.name !== DEMO_BRAND).slice(0, 72);
function makeLive(): SourceData {
  const origin = {
    provenance: "simulated",
    origin: "simulation_2026",
  } as const;
  const festival = FESTIVAL_DATES["2026"],
    start = START_DATES["2026"];
  const data: SourceData = {
    event: [
      {
        event_name: "Unmaad 2027 · IIM Bangalore",
        history_start: start,
        history_end: dateShift(festival, 7),
        event_starts_at: stamp(festival, 0, "10:00:00"),
        event_ends_at: stamp(festival, 2, "22:00:00"),
        ...origin,
      },
    ],
    targets: [
      {
        effective_at: stamp(start),
        // Base plan from scripts/plan-model.mjs: 33 deals, ₹24.8L collected (≈ ₹25L); 33 ÷ 67% warm-qualified win rate ≈ 50 qualified.
        target_version: "Unmaad 2027 plan",
        qualified_brands_goal: 50,
        confirmed_partnerships_goal: 33,
        cash_goal_inr: 2500000,
        ...origin,
      },
    ],
    brands: [],
    sponsor_contacts: [],
    sponsor_campaigns: [],
    sponsor_interactions: [],
    brand_qualification_history: [],
    opportunities: [],
    opportunity_history: [],
    sponsor_activations: [],
    invoices: [],
    payments: [],
  };
  data.sponsor_campaigns = ARCHIVE.sponsor_campaigns.map((c) => ({
    ...c,
    ...origin,
    created_at: stamp(start),
    planned_start_at: stamp(start),
    planned_end_at: stamp(festival, -2),
  }));
  const sizes = [25000, 40000, 55000, 90000, 110000, 145000, 200000];
  for (let i = 0; i < 72; i++) {
    const ix = String(i + 1).padStart(3, "0"),
      brand_id = "BLR" + ix,
      contact_id = "CT" + ix,
      opportunity_id = "DL" + ix;
    const campaign = data.sponsor_campaigns[[1, 3, 4, 0, 2, 5][i % 6]],
      sponsor_campaign_id = campaign.sponsor_campaign_id;
    const owner_id = ["T01", "T05", "T03", "T02"][i % 4],
      owner_name = OWNER_NAMES[owner_id];
    // The 72 most relevant real brands (lib/brand-register.ts). Brand 1 is the demo brand: the same real
    // name the 2025 data gives its negotiating ₹90,000 deal, so both workspaces tell one story.
    const real = i === 1 ? undefined : LIVE_BRANDS.at(i)!;
    const brand_name = i === 1 ? DEMO_BRAND : real!.name;
    const started = (i * 11) % 50;
    const created_at = stamp(start, started, "08:00:00");
    data.brands.push({
      brand_id,
      brand_name,
      industry: i === 1 ? DEMO_INDUSTRY : real!.industry,
      owner_id,
      owner_name,
      created_at,
      ...origin,
    });
    data.sponsor_contacts.push({
      contact_id,
      brand_id,
      contact_name: i % 2 ? "Brand Marketing Lead" : "Partnerships Manager",
      job_title: i % 2 ? "Brand Marketing Lead" : "Partnerships Manager",
      created_at,
      ...origin,
    });
    const addTouch = (event_type: string, outcome: string, day: number) =>
      data.sponsor_interactions.push({
        interaction_id: ix + "-" + event_type,
        brand_id,
        contact_id,
        sponsor_campaign_id,
        owner_id,
        attempt_id: "AT" + ix,
        occurred_at: stamp(start, started + day),
        channel: campaign.channel,
        event_type,
        outcome,
        summary: event_type.replaceAll("_", " "),
        ...origin,
      });
    const warm = ["introduction", "web_inbound"].includes(campaign.channel);
    addTouch(
      campaign.channel === "introduction"
        ? "introduction_received"
        : campaign.channel === "web_inbound"
          ? "web_inbound"
          : "outreach_sent",
      warm ? "introduced" : "sent",
      0,
    );
    const qualified = warm || i % 4 === 0;
    if (warm || i % 3 !== 1)
      addTouch("replied", qualified ? "positive" : "neutral", 1);
    if (qualified) {
      addTouch("meeting_booked", "scheduled", 2);
      addTouch("meeting_held", "attended", 3);
    }
    data.brand_qualification_history.push({
      history_id: "Q" + ix,
      brand_id,
      sponsor_campaign_id,
      effective_at: created_at,
      qualification_status: "unreviewed",
      ...origin,
    });
    if (qualified)
      data.brand_qualification_history.push({
        history_id: "QF" + ix,
        brand_id,
        sponsor_campaign_id,
        effective_at: stamp(start, started + 3),
        qualification_status: "qualified",
        ...origin,
      });
    if (i % 7 === 0 || (!warm && i % 4 !== 0)) continue;
    const opportunity_name = brand_name + " festival partnership",
      support_type = i % 11 === 0 ? "in_kind" : "cash";
    data.opportunities.push({
      opportunity_id,
      opportunity_name,
      brand_id,
      sponsor_campaign_id,
      primary_contact_id: contact_id,
      support_type,
      created_at: stamp(start, started + 3),
      ...origin,
    });
    const won = warm && i % 5 < 3 && i !== 1;
    const stages = [
      "prospecting",
      "contacted",
      "proposal_sent",
      "negotiating",
      "partner_confirmed",
    ];
    const finalIndex = won ? 4 : i === 1 ? 3 : 1 + (i % 3);
    stages
      .slice(0, finalIndex + 1)
      .forEach((stage, j) =>
        data.opportunity_history.push({
          history_id: ix + "-" + j,
          opportunity_id,
          brand_id,
          stage,
          owner_id,
          owner_name,
          proposed_value_inr: i === 1 ? 90000 : sizes[i % 7],
          confirmed_value_inr: stage === "partner_confirmed" ? sizes[i % 7] : 0,
          effective_at: stamp(start, started + 3 + j * 2, "12:00:00"),
          ...origin,
        }),
      );
  }
  return data;
}
const LIVE = makeLive();
export const sourceForSeason = (season: Season) =>
  season === "2026" ? LIVE : ARCHIVE;
