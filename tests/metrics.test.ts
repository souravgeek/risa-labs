import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { snapshot, sourceForSeason } from "../lib/metrics";
import { BRAND_MAP } from "../lib/brand-register";
import type { SourceData } from "../lib/data-types";

describe("2025 source workbook checkpoints", () => {
  it.each([
    ["2025-02-15", 24, 40, 2, 20, 170000, 17, 1155000],
    ["2025-03-15", 55, 55, 17, 28, 1505000, 30, 1890000],
    ["2025-03-20", 58, 55, 19, 28, 1660000, 31, 2020000],
    ["2025-04-11", 60, 55, 24, 28, 2240000, 26, 1440000],
  ] as const)(
    "rebuilds the %s snapshot from records",
    (
      asOf,
      qualified,
      qualifiedGoal,
      confirmed,
      confirmedGoal,
      value,
      open,
      openValue,
    ) => {
      const s = snapshot({ asOf });
      expect([
        s.counts.qualified,
        s.targets.qualified,
        s.counts.confirmed,
        s.targets.confirmed,
        s.counts.confirmedValue,
        s.counts.open,
        s.counts.openValue,
      ]).toEqual([
        qualified,
        qualifiedGoal,
        confirmed,
        confirmedGoal,
        value,
        open,
        openValue,
      ]);
    },
  );
  it("preserves source findings and distinguishes an alert window from the full eligible pool", () => {
    const demo = snapshot({ asOf: "2025-03-20" }),
      end = snapshot({ asOf: "2025-04-11", settings: { qualifiedDays: 0 } });
    expect([
      demo.daysLeft,
      demo.stalled.length,
      demo.stalled.reduce((a, d) => a + d.value, 0),
    ]).toEqual([23, 19, 910000]);
    expect(demo.pacing.neededPerWeek).toBeCloseTo(2.739);
    expect(demo.qualifiedWithoutDeal).toHaveLength(17);
    expect(
      demo.qualifiedWithoutDeal.filter((b) => b.group === "warm"),
    ).toHaveLength(12);
    expect([
      end.leakage[0].count,
      end.leakage[3].count,
      end.stalled.length,
    ]).toEqual([18, 15, 26]);
    expect(end.campaigns.map((c) => c.verdict)).toEqual([
      "Stop",
      "Scale",
      "Fix",
      "Scale",
      "Scale",
      "Fix",
    ]);
    expect(end.campaigns[0].attempts).toBe(223);
    expect(
      end.campaigns.reduce(
        (n, c) => n + (c.group === "cold" ? c.attempts : 0),
        0,
      ),
    ).toBe(321);
    expect([end.cash.confirmed, end.cash.inKind, end.invoices.length]).toEqual([
      2000000, 240000, 40,
    ]);
    expect(end.invoices.every((i) => i.provenance === "simulated")).toBe(true);
  });
});

describe("date-effective metrics and edits", () => {
  it("keeps future stage, payment and target revisions out of the earlier snapshot", () => {
    const asOf = "2025-03-20",
      original = snapshot({ asOf });
    const deal = original.stalled.find((d) => d.supportType === "cash")!,
      inv = original.invoices.find(
        (i) =>
          i.balance > 0 &&
          snapshot({ asOf: "2025-03-21" }).invoices.find((j) => j.id === i.id)!
            .balance > 0,
      )!;
    const at = "2025-03-21T00:00:00+05:30";
    const additions: Partial<SourceData> = {
      opportunity_history: [
        {
          ...deal.history.at(-1)!,
          stage: "partner_confirmed",
          history_id: "test-history",
          confirmed_value_inr: deal.value,
          effective_at: at,
        },
      ],
      targets: [
        {
          qualified_brands_goal: 56,
          confirmed_partnerships_goal: 31,
          effective_at: at,
        },
      ],
      payments: [
        {
          payment_id: "test-payment",
          invoice_id: inv.id,
          amount_inr: 1000,
          received_at: at,
          provenance: "user",
        },
      ],
    };
    const old = snapshot({ asOf, additions });
    expect(old).toEqual(original);
    const control = snapshot({ asOf: "2025-03-21" }),
      next = snapshot({ asOf: "2025-03-21", additions });
    expect(next.counts.confirmed).toBe(control.counts.confirmed + 1);
    expect(next.cash.confirmed).toBe(control.cash.confirmed + deal.value);
    expect(next.cash.collected).toBe(control.cash.collected + 1000);
    expect(next.targets.confirmed).toBe(31);
    expect(next.deals.find((d) => d.id === deal.id)!.history).toHaveLength(
      deal.history.length + 1,
    );
  });
  it("uses the IST day boundary even for UTC-formatted user entries", () => {
    const asOf = "2025-03-20",
      newTarget = {
        qualified_brands_goal: 60,
        confirmed_partnerships_goal: 40,
      };
    expect(
      snapshot({
        asOf,
        additions: {
          targets: [{ ...newTarget, effective_at: "2025-03-20T18:29:59Z" }],
        },
      }).targets.confirmed,
    ).toBe(40);
    expect(
      snapshot({
        asOf,
        additions: {
          targets: [{ ...newTarget, effective_at: "2025-03-20T18:30:00Z" }],
        },
      }).targets.confirmed,
    ).toBe(28);
  });
  it("keeps post-festival receipts separate from the pre-festival cash North Star", () => {
    const s = snapshot({ asOf: "2025-04-11" });
    const invoice = s.invoices.find((i) => i.balance > 0)!;
    const p = {
      payment_id: "late-payment",
      invoice_id: invoice.id,
      received_at: "2025-04-12T10:00:00+05:30",
      amount_inr: 10,
    };
    const next = snapshot({ asOf: "2025-04-13", additions: { payments: [p] } });
    expect(next.payments.some((row) => row.id === p.payment_id)).toBe(true);
    expect(next.cash.collected).toBe(
      snapshot({ asOf: "2025-04-13" }).cash.collected,
    );
  });
  it("derives filtered cash and counts from the same joined records", () => {
    const all = snapshot({ asOf: "2025-04-11" }),
      warm = snapshot({ asOf: "2025-04-11", filters: { channel: "warm" } });
    const cold = snapshot({ asOf: "2025-04-11", filters: { channel: "cold" } });
    expect(warm.counts.confirmed).toBe(24);
    expect(cold.counts.confirmed).toBe(0);
    expect(warm.cash.collected + cold.cash.collected).toBe(all.cash.collected);
    expect(warm.deals.every((d) => d.group === "warm")).toBe(true);
    expect(snapshot({ asOf: "2025-01-01" }).counts.deals).toBe(0);
  });
  it("uses a separate simulated Bengaluru season for Unmaad 2027", () => {
    const live = snapshot({ season: "2026", asOf: "2026-11-25" });
    expect(live.festivalDate).toBe("2027-02-26");
    expect(live.daysLeft).toBe(93);
    expect(live.brands.every((b) => b.provenance === "simulated")).toBe(true);
    // The demo brand carries the same real name as the 2025 record it stands for.
    const demo = Object.values(BRAND_MAP).find((b) => b.original === "Evergreen Living")!.name;
    expect(live.brands.find((b) => b.name === demo)?.id).toMatch(
      /^BLR/,
    );
    expect(
      sourceForSeason("2025").brands.every((b) => b.provenance === "source"),
    ).toBe(true);
  });
});

describe("source import", () => {
  it("ignores identical duplicates and fails on conflicting IDs", () => {
    const cmd = spawnSync(
      "python3",
      [
        "-c",
        [
          "from scripts.import_source import dedupe",
          "row={'id': 'a', 'name': 'x'}",
          "assert dedupe([row,row],'id') == [row]",
          "try: dedupe([row,{'id':'a','name':'y'}], 'id')",
          "except ValueError: pass",
          "else: raise AssertionError('conflicting duplicate accepted')",
        ].join("\n"),
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    expect(cmd.status, cmd.stderr.toString()).toBe(0);
    const data = sourceForSeason("2025");
    expect([
      data.sponsor_interactions.length,
      data.brand_qualification_history.length,
      data.opportunity_history.length,
    ]).toEqual([950, 433, 228]);
  });
});
