import { describe, expect, it } from "vitest";
import { facetCount, filterRecords, filterDims, type Dim } from "../lib/filter-facets";
import { state, input } from "../lib/workspace";

const view = (filters: Record<string, string> = {}) => state([], input({ asOf: "2025-03-20", filters })).snap;
const all = view();
const recs = filterRecords(all);
const values: Record<Dim, string[]> = {
  campaign: all.campaigns.map(c => c.id),
  channel: ["warm", "cold"],
  owner: all.owners.map(o => o.id),
  industry: all.industries,
};

describe("linked filters", () => {
  it("narrows the other lists once one value is chosen", () => {
    const campaigns = (f: Record<string, string>) => values.campaign.filter(id => facetCount(recs, f, "campaign", id) > 0);
    expect(campaigns({}).length).toBe(all.campaigns.length);
    // Choosing the warm channel leaves only warm campaigns.
    const warm = campaigns({ channel: "warm" });
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.every(id => all.campaigns.find(c => c.id === id)!.group === "warm")).toBe(true);
    // Choosing a campaign leaves exactly its own channel group.
    const email = all.campaigns.find(c => c.name === "Brand Discovery Email")!;
    expect(values.channel.filter(v => facetCount(recs, { campaign: email.id }, "channel", v) > 0)).toEqual(["cold"]);
  });

  it("offers a value only when applying it would show records on the dashboard, for every pair of filters", () => {
    for (const [a] of filterDims) for (const va of values[a]) for (const [b] of filterDims) {
      if (a === b) continue;
      for (const vb of values[b]) {
        const offered = facetCount(recs, { [a]: va }, b, vb) > 0;
        const snap = view({ [a]: va, [b]: vb });
        const shown = snap.brands.length + snap.deals.length > 0;
        expect([a, va, b, vb, offered]).toEqual([a, va, b, vb, shown]);
      }
    }
  });

  it("counts an owner through the deals they own, not only their brands", () => {
    const meera = all.owners.find(o => o.name === "Meera Iyer")!;
    expect(all.brands.filter(b => b.ownerId === meera.id)).toHaveLength(0);
    expect(facetCount(recs, {}, "owner", meera.id)).toBeGreaterThan(0);
  });
});
