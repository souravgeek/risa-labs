import { beforeAll, afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { input, read, command, commit } from "../lib/workspace";

const dir = mkdtempSync(join(tmpdir(), "campusfest-rules-"));
beforeAll(() => { process.env.CAMPUSFEST_DATA_DIR = dir; });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const i = input({ asOf: "2025-03-20" });
const save = (action: Record<string, unknown>) => commit(i, (s) => command(s, i, action));

it("runs a custom rule only for matching saves, and stops when paused or deleted", async () => {
  await save({ kind: "rule", trigger: "deal_confirmed", group: "warm", minValue: 50000, title: "Thank {brand}", dueDays: 1, notify: true });
  const start = await read(i);
  const rule = start.extras.rules[0];
  expect(rule).toMatchObject({ trigger: "deal_confirmed", group: "warm", enabled: true });

  const open = start.deals.filter((d) => ["prospecting", "contacted", "proposal_sent", "negotiating"].includes(d.stage));
  const [warmA, warmB] = open.filter((d) => d.group === "warm");
  const cold = open.find((d) => d.group === "cold")!;

  await save({ kind: "stage", dealId: warmA.id, stage: "partner_confirmed", value: 60000 });
  await save({ kind: "stage", dealId: cold.id, stage: "partner_confirmed", value: 60000 });
  let now = await read(i);
  const thanks = () => now.extras.tasks.filter((t) => t.title.startsWith("Thank "));
  expect(thanks().map((t) => t.title)).toEqual(["Thank " + warmA.brand]);
  expect(thanks()[0]).toMatchObject({ owner: warmA.ownerId, due: "2025-03-21", source: "automation" });
  expect(now.extras.notifications.some((n) => n.message.includes("Thank " + warmA.brand))).toBe(true);

  await save({ kind: "rule", id: rule.id, enabled: false });
  await save({ kind: "stage", dealId: warmB.id, stage: "partner_confirmed", value: 60000 });
  now = await read(i);
  expect(thanks()).toHaveLength(1);

  await save({ kind: "rule", id: rule.id, delete: true });
  expect((await read(i)).extras.rules).toHaveLength(0);
});

it("rejects incomplete rules", async () => {
  await expect(save({ kind: "rule", trigger: "nope", title: "x" })).rejects.toThrow("trigger");
  await expect(save({ kind: "rule", trigger: "deal_lost", title: "" })).rejects.toThrow();
});

it("warns on a third cold touch to the same brand and notifies the owner", async () => {
  const s = await read(i);
  const activeCold = s.campaigns.filter((c) => c.group === "cold" && c.status === "active").map((c) => c.id);
  const touches = new Map<string, number>();
  for (const x of s.interactions)
    if (x.event_type === "outreach_sent" && activeCold.includes(String(x.sponsor_campaign_id)))
      touches.set(x.brand_id + "|" + x.sponsor_campaign_id, (touches.get(x.brand_id + "|" + x.sponsor_campaign_id) || 0) + 1);
  const [repeatKey] = [...touches].find(([, n]) => n >= 2)!;
  const [freshKey] = [...touches].find(([, n]) => n === 1) ?? [];
  const [brandId, campaignId] = repeatKey.split("|");

  const warned = await save({ kind: "touch", brandId, campaignId, eventType: "outreach_sent", summary: "Another follow-up" });
  expect(warned?.warning).toMatch(/Third or later cold touch/);
  expect((await read(i)).extras.notifications.some((n) => n.brandId === brandId && /Cold touch/.test(n.message))).toBe(true);

  if (freshKey) {
    const [b, c] = freshKey.split("|");
    const quiet = await save({ kind: "touch", brandId: b, campaignId: c, eventType: "outreach_sent", summary: "Second touch" });
    expect(quiet?.warning).toBeUndefined();
  }
});
