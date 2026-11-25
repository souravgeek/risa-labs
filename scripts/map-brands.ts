// Maps each brand in the provided 2025 dataset to a real brand (npm run map-brands → data/brand-map.json).
//
// 1. Position: where the dataset brand ended the 2025 season (festival eve, 11 Apr 2025), best first:
//    confirmed (repeat buyers first) › open, late stage › open, early stage › lost or withdrawn ›
//    qualified with no deal › replied, not qualified › contacted, no reply. Ties: warm channel first,
//    then higher deal value, then brand ID.
// 2. Relevance: each real brand scores evidence (Unmaad past sponsor 50, peer-fest sponsor 35, none 0)
//    + youth fit (10/20/30) + Bengaluru presence (5/10/20). See lib/brand-register.ts.
// 3. Within each industry, the n-th best position gets the n-th most relevant real brand.
// Beardo is already a real brand in the dataset and keeps its name.
import { writeFileSync } from "node:fs";
import { snapshot } from "../lib/metrics";
import { REGISTER, byRelevance, relevance, type MappedBrand } from "../lib/brand-register";
import raw from "../data/source.json";

const m = snapshot({ season: "2025", asOf: "2025-04-11" });
const original = new Map((raw as { brands: { brand_id: string; brand_name: string }[] }).brands.map(b => [b.brand_id, b.brand_name]));
const POSITIONS = ["Confirmed, repeat sponsor", "Confirmed", "Open, late stage", "Open, early stage", "Lost or withdrawn", "Qualified, no deal", "Replied, not qualified", "Contacted, no reply"];
function position(id: string) {
  const deals = m.deals.filter(d => d.brandId === id), stages = deals.map(d => d.stage), brand = m.brands.find(b => b.id === id)!;
  const won = deals.filter(d => d.stage === "partner_confirmed");
  const value = Math.max(0, ...deals.map(d => d.confirmedValue || d.proposedValue || 0));
  let p = 7;
  if (won.length > 1) p = 0; else if (won.length) p = 1;
  else if (stages.some(s => s === "negotiating" || s === "proposal_sent")) p = 2;
  else if (stages.some(s => s === "prospecting" || s === "contacted")) p = 3;
  else if (stages.some(s => s === "lost" || s === "withdrawn")) p = 4;
  else if (brand.qualification === "qualified") p = 5;
  else if (m.interactions.some(x => x.brandId === id && x.type === "replied")) p = 6;
  return { p, warm: brand.group === "warm" ? 0 : 1, value };
}
const out: Record<string, MappedBrand> = {};
const industries = [...new Set(m.brands.map(b => b.industry))];
for (const industry of industries) {
  const slots = m.brands.filter(b => b.industry === industry).map(b => ({ id: b.id, ...position(b.id) }))
    .sort((a, b) => a.p - b.p || a.warm - b.warm || b.value - a.value || a.id.localeCompare(b.id));
  const pool = REGISTER.filter(r => r.industry === industry && !r.liveOnly).sort(byRelevance);
  if (pool.length < slots.length) throw new Error(`${industry}: ${slots.length} dataset brands but only ${pool.length} real brands`);
  slots.forEach((s, i) => {
    const name0 = original.get(s.id)!;
    // A brand that is already real in the dataset keeps its name.
    const keep = REGISTER.find(r => r.name === name0);
    const r = keep ?? pool.filter(x => !Object.values(out).some(o => o.name === x.name) && !slots.some(t => original.get(t.id) === x.name)).at(0)!;
    out[s.id] = { name: r.name, original: name0, industry, category: r.category, evidence: r.evidence, evidenceNote: r.evidenceNote, source: r.source, score: relevance(r), position: POSITIONS.at(s.p)!, rank: i + 1 };
  });
}
writeFileSync(new URL("../data/brand-map.json", import.meta.url), JSON.stringify(out, null, 1));
const rows = Object.values(out);
console.log(rows.length, "brands mapped;", rows.filter(r => r.evidence !== "none").length, "with verified fest evidence");
for (const p of POSITIONS) { const g = rows.filter(r => r.position === p); if (g.length) console.log(p.padEnd(28), g.length, "·", g.slice(0, 8).map(r => r.name).join(", ")); }
