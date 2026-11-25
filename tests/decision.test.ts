import { beforeAll, describe, expect, it } from "vitest";
import { snapshot, sourceForSeason, type Snapshot } from "../lib/metrics";
import {
  coldFollowUpPolicy,
  compareScenarios,
  compareSnapshots,
  historicalBaselineDate,
  historicalIndustryRates,
  matchProspectCompany,
  rankBottlenecks,
  routeProspect,
  scenarioForecast,
  scoreProspect,
  seedProspects,
  stageDeadlines,
  workspaceProspects,
} from "../lib/decision";
import { growthCommand, growthDraft } from "../lib/growth-actions";
import { state, type Input } from "../lib/workspace";
import { type Entry } from "../lib/storage";

const i: Input = { season: "2025", asOf: "2025-03-20", owner: "T01" };
let current: Snapshot, prior: Snapshot;
beforeAll(() => {
  current = snapshot(i);
  prior = snapshot({ ...i, asOf: "2025-03-15" });
});

describe("Decision desk", () => {
  it("reproduces the central forecast with no scenario inputs", () => {
    const result = scenarioForecast(current);
    for (const field of ["committed", "base", "stretch"] as const)
      expect(result[field]).toBe(current.forecast[field]);
    expect(result.delta).toEqual({ committed: 0, base: 0, stretch: 0 });
  });
  it("keeps receipts intact and compares at most three models", () => {
    const result = scenarioForecast(current, {
      partners: 4,
      recover: 0.5,
      dealSizeChange: 0.2,
      shiftCold: 0.4,
      discount: 0.03,
      uptake: 0.5,
      paymentLag: 4,
    });
    expect(result.stretch).toBeGreaterThanOrEqual(result.base);
    expect(result.base).toBeGreaterThanOrEqual(result.committed);
    expect(result.committed).toBeGreaterThanOrEqual(current.cash.collected);
    expect(result.assumptions.addedIntros).toBe(8);
    expect(result.base).toBeGreaterThan(current.forecast.base);
    expect(
      compareScenarios(current, [
        { name: "Referrals", inputs: { partners: 4 } },
      ])[0].forecast,
    ).toEqual(scenarioForecast(current, { partners: 4 }));
    expect(() =>
      compareScenarios(
        current,
        Array.from({ length: 4 }, () => ({ name: "A", inputs: {} })),
      ),
    ).toThrow();
  });
  it("connects every rupee of a forecast change to the comparison", () => {
    const change = compareSnapshots(prior, current);
    expect(change.newConfirmations.map((d) => d.id).sort()).toEqual([
      "O018",
      "O019",
      "O026",
    ]);
    expect(current.counts.confirmed - prior.counts.confirmed).toBe(2);
    expect(change.stageMoves.length).toBeGreaterThan(0);
    expect(Object.values(change.causes).reduce((s, v) => s + v, 0)).toBe(
      change.forecastChange.base,
    );
    expect(compareSnapshots(current, current).newLeaks).toEqual([]);
    expect(() => compareSnapshots(current, prior)).toThrow();
  });
  it("looks up matched days to festival and uses only known won history", () => {
    expect(
      historicalBaselineDate({
        asOf: "2026-11-25",
        festivalDate: "2026-12-18",
      }),
    ).toBe("2025-03-20");
    const history = sourceForSeason("2025").opportunity_history;
    const cutoff = history.filter(
      (h) => h.effective_at.slice(0, 10) <= current.asOf,
    );
    expect(stageDeadlines(current, history)).toEqual(
      stageDeadlines(current, cutoff),
    );
    expect(
      stageDeadlines(current, history).some(
        (x) => x.sampleSize > 0 && x.lastSafeDate,
      ),
    ).toBe(true);
    const bottlenecks = rankBottlenecks(
      snapshot({ ...i, filters: { channel: "cold" } }),
      snapshot({ ...i, filters: { channel: "warm" } }),
    );
    expect(bottlenecks.length).toBeGreaterThan(0);
    expect(bottlenecks.length).toBeLessThanOrEqual(3);
    expect(bottlenecks[0].benchmarkRate).toBeGreaterThan(
      bottlenecks[0].actualRate,
    );
  });
});

describe("Prospect routing", () => {
  it("seeds identifiable simulated profiles, scores real paths, and enforces consent, competition and daily caps", () => {
    const prospects = seedProspects(),
      warm = prospects[0],
      cold = prospects[3];
    expect(prospects.length).toBe(150);
    expect(new Set(prospects.map((p) => p.id)).size).toBe(150);
    expect(prospects).toEqual(seedProspects());
    // Real companies, shown by role; only a verified fest sponsorship counts as public research.
    expect(prospects.every((p) => ["Simulated", "Public research"].includes(p.source))).toBe(true);
    expect(prospects.filter((p) => p.source === "Public research").every((p) => /https:\/\//.test(p.timingSignal ?? ""))).toBe(true);
    expect(prospects.every((p) => p.name.endsWith(", " + p.company))).toBe(true);
    expect(workspaceProspects("2026", "2026-09-21", [])).toEqual([]);
    expect(
      workspaceProspects("2026", "2026-11-25", [
        { id: warm.id, status: "added" },
      ])[0].status,
    ).toBe("added");
    const result = scoreProspect(warm, {
      industryWinRates: historicalIndustryRates(current),
    });
    expect(result.score).toBe(
      Math.round(0.4 * result.fit + 0.4 * result.warmth + 0.2 * result.timing),
    );
    expect(routeProspect(warm).kind).toBe("intro");
    expect(routeProspect(cold).kind).toBe("cold");
    expect(routeProspect(cold, { coldUsed: 10 }).kind).toBe("deferred");
    expect(routeProspect({ ...warm, optedOut: true }).kind).toBe("excluded");
    expect(
      routeProspect(warm, {
        exclusiveSponsors: [
          { company: "Other company", industry: warm.industry },
        ],
      }).kind,
    ).toBe("excluded");
    expect(
      routeProspect(warm, {
        exclusiveSponsors: [
          { company: warm.company + " Pvt Ltd", industry: warm.industry },
        ],
      }).kind,
    ).toBe("intro");
    expect(
      coldFollowUpPolicy({ channel: "cold", previousTouches: 2 }).warning,
    ).toContain("Third");
    expect(
      coldFollowUpPolicy({ channel: "warm", previousTouches: 2 }).warning,
    ).toBeNull();
  });
  it("holds ambiguous company matches for review", () => {
    const brands = [
      { id: "A", name: "Mango Atelier Pvt Ltd" },
      { id: "B", name: "Mango Atelier Ltd" },
    ];
    expect(
      matchProspectCompany({ company: "Mango Atelier" }, brands).kind,
    ).toBe("review");
    expect(
      matchProspectCompany({ company: "Mango Atelier" }, brands.slice(0, 1))
        .kind,
    ).toBe("existing");
  });
  it("routes a warm introduction and creates a contact exactly once", () => {
    let events: Entry[] = [];
    const run = (action: Record<string, unknown>) => {
      const cmd = growthCommand(state(events, i), i, action);
      if (cmd)
        events.push({
          id: String(events.length),
          season: i.season,
          at: i.asOf + "T12:00:00+05:30",
          actor: "Team",
          entity: cmd.entity ?? "",
          ...cmd,
        });
      return cmd;
    };
    // A warm prospect whose company is not yet a brand in this workspace, so adding it creates one.
    const existing = new Set(state([], i).snap.brands.map((b) => b.name));
    const p = seedProspects("2025").find((x) => x.connections?.length && !existing.has(x.company))!;
    expect(
      run({ kind: "prospectRoute", id: p.id })?.changes.some(
        (c) => c.table === "tasks",
      ),
    ).toBe(true);
    run({ kind: "prospectAdd", id: p.id });
    expect(() => run({ kind: "prospectAdd", id: p.id })).toThrow("already");
    const s = state(events, i);
    expect(s.snap.brands.find((b) => b.name === p.company)?.qualification).toBe(
      "unreviewed",
    );
    expect(s.snap.contacts.filter((c) => c.name === p.name)).toHaveLength(1);
    expect(
      growthCommand(s, i, {
        kind: "scenario",
        name: "Plan",
        inputs: { partners: 2 },
        outputs: { base: -444 },
      })?.changes[0].row.outputs.base,
    ).toBe(scenarioForecast(s.snap, { partners: 2 }).base);
  });
  it("drafts from available inventory and records an upsell after approval", async () => {
    const s = state([], i),
      sponsor = s.snap.deals.find(
        (d) =>
          d.stage === "partner_confirmed" &&
          !s.snap.brands.find((b) => b.id === d.brandId)?.doNotContact,
      )!;
    const request = {
      purpose: "upsell",
      brandId: sponsor.brandId,
      packageId: "PK1",
    };
    if (!process.env.GEMINI_API_KEY) {
      const draft = await growthDraft(s, i, request);
      expect(draft.mode).toBe("Template");
      expect(draft.text).toContain("₹25,000");
    }
    const cmd = growthCommand(s, i, { kind: "upsellDeal", ...request });
    expect(cmd?.changes.map((c) => c.table)).toEqual([
      "opportunities",
      "opportunity_history",
    ]);
  });
});
