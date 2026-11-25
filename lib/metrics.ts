import { DAY, dateShift, OWNER_NAMES, sourceForSeason } from "./metrics-seed";
import { BRAND_MAP, registerEntry } from "./brand-register";
import type {
  ChannelGroup,
  Filters,
  InvoiceRow,
  MetricInput,
  MetricSettings,
  PaymentRow,
  SourceData,
} from "./data-types";
export type {
  Filters,
  MetricInput,
  MetricSettings,
  ScenarioInput,
  Season,
  SourceData,
} from "./data-types";
export { sourceForSeason, dateShift };

export const DEFAULT_SETTINGS: MetricSettings = {
  cashTarget: 2500000,
  stalledDays: 7,
  qualifiedDays: 3,
  replyDays: 2,
  meetingDays: 3,
  invoiceDays: 1,
  paymentLag: 15,
  payRate: 0.8,
  lateRate: 0.15,
  firstMilestoneShare: 0.5,
  finalMilestoneDays: 7,
  stopAttempts: 40,
  positiveThreshold: 0.1,
  scaleWinRate: 0.5,
  scaleClosed: 5,
};
export const OPEN_STAGES = [
  "prospecting",
  "contacted",
  "proposal_sent",
  "negotiating",
];
const firstTouch = new Set([
  "outreach_sent",
  "introduction_received",
  "web_inbound",
]);
const isOpen = (stage: string) => OPEN_STAGES.includes(stage);
const isClosed = (stage: string) =>
  ["lost", "withdrawn", "partner_confirmed"].includes(stage);
const distinct = <T>(items: T[]) => [...new Set(items)];
const sum = <T>(items: T[], pick: (row: T) => number) =>
  items.reduce((n, r) => n + pick(r), 0);
const rate = (n: number, total: number) => (total ? n / total : 0);
const median = (items: number[]) => {
  const list = [...items].sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const time = (s: string) =>
  Date.parse(s.length === 10 ? s + "T00:00:00+05:30" : s);
const day = (s: string) =>
  s.length === 10 ? s : new Date(time(s) + 19800000).toISOString().slice(0, 10);
const days = (a: string, b: string) =>
  Math.round((time(day(a)) - time(day(b))) / DAY);
const sortAt = <T>(rows: T[], at: (r: T) => string) =>
  [...rows].sort((a, b) => time(at(a)) - time(at(b)));
const latest = <T>(rows: T[], key: (r: T) => string, at: (r: T) => string) =>
  new Map(sortAt(rows, at).map((r) => [key(r), r]));
const groupFor = (channel: string): ChannelGroup =>
  ["introduction", "web_inbound", "referral", "inbound", "warm"].includes(
    channel,
  )
    ? "warm"
    : "cold";
const matches = (
  selection: string | undefined,
  ...values: (string | undefined)[]
) =>
  !selection ||
  selection.toLowerCase() === "all" ||
  values.some((v) => v?.toLowerCase() === selection.toLowerCase());

function seedMoney(
  data: SourceData,
  settings: MetricSettings,
): { invoices: InvoiceRow[]; payments: PaymentRow[] } {
  const deals = new Map(data.opportunities.map((d) => [d.opportunity_id, d]));
  const firstWon = new Set<string>();
  const festival = day(data.event[0].event_starts_at);
  const invoices: InvoiceRow[] = [],
    payments: PaymentRow[] = [];
  // The archive payment simulation is calibrated to cash partners at the festival-eve checkpoint.
  // The imported stage ledger is untouched, including Cobalt Learning's withdrawn deal.
  const cohort = latest(
    data.opportunity_history.filter((s) => day(s.effective_at) < festival),
    (s) => s.opportunity_id,
    (s) => s.effective_at,
  );
  for (const stage of sortAt(
    data.opportunity_history.filter(
      (s) =>
        s.stage === "partner_confirmed" &&
        cohort.get(s.opportunity_id)?.stage === "partner_confirmed",
    ),
    (s) => s.effective_at,
  )) {
    const id = stage.opportunity_id;
    if (firstWon.has(id) || deals.get(id)?.support_type !== "cash") continue;
    firstWon.add(id);
    const confirmed = day(stage.effective_at);
    const firstDue = dateShift(confirmed, settings.paymentLag);
    const finalDue = [
      confirmed,
      dateShift(festival, -settings.finalMilestoneDays),
    ].sort()[1];
    const firstAmount = Math.round(
      stage.confirmed_value_inr * settings.firstMilestoneShare,
    );
    const amounts = [firstAmount, stage.confirmed_value_inr - firstAmount];
    for (const [i, amount] of amounts.entries()) {
      if (!amount) continue;
      const issued = i
        ? [confirmed, dateShift(finalDue, -settings.paymentLag)].sort()[1]
        : confirmed;
      const due = i ? finalDue : firstDue;
      const invoice_id = "INV-" + id + "-" + (i + 1);
      const idx = invoices.length;
      invoices.push({
        invoice_id,
        opportunity_id: id,
        amount_inr: amount,
        milestone: i ? "Festival balance" : "Confirmation deposit",
        issued_at: issued + "T12:00:00+05:30",
        due_at: due + "T18:00:00+05:30",
        status: "sent",
        origin: "simulation",
        provenance: "simulated",
      });
      const quantile = (((idx * 7) % 20) + 0.5) / 20;
      if (quantile >= Math.min(1, settings.payRate + settings.lateRate))
        continue;
      const received =
        quantile < settings.payRate ? due : dateShift(due, 1 + (idx % 10));
      payments.push({
        payment_id: "PAY-" + id + "-" + (i + 1),
        invoice_id,
        amount_inr: amount,
        received_at: received + "T15:00:00+05:30",
        method: "Bank transfer",
        provenance: "simulated",
        origin: "simulation",
      });
    }
  }
  return { invoices, payments };
}

export function snapshot(input: MetricInput) {
  const { asOf } = input,
    season = input.season ?? "2025",
    filters = input.filters ?? {},
    additions = input.additions ?? {};
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(time(asOf)) ||
    dateShift(asOf, 0) !== asOf
  )
    throw new Error("Invalid as-of date");
  const cutoff = time(asOf + "T23:59:59.999+05:30");
  const before = (s: string) => time(s) <= cutoff;
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };
  if (input.settings?.depositPercent !== undefined)
    settings.firstMilestoneShare = input.settings.depositPercent / 100;
  const source = sourceForSeason(season);
  const data = <K extends keyof SourceData>(table: K): SourceData[K] =>
    [...source[table], ...(additions[table] ?? [])] as SourceData[K];
  const event = source.event[0],
    festivalDate = day(event.event_starts_at);
  const daysLeft = Math.max(0, days(festivalDate, asOf));
  const tg = sortAt(
    data("targets").filter((t) => before(t.effective_at)),
    (t) => t.effective_at,
  ).at(-1);
  const targets = {
    qualified: tg?.qualified_brands_goal ?? 0,
    confirmed: tg?.confirmed_partnerships_goal ?? 0,
    cash: tg
      ? (input.settings?.cashTarget ?? tg.cash_goal_inr ?? settings.cashTarget)
      : 0,
    version: tg?.target_version ?? "No active plan",
    cashProvenance: input.settings?.cashTarget
      ? "user"
      : tg?.cash_goal_inr
        ? (tg.provenance ?? "user")
        : "assumption",
  };
  const campaignVersions = sortAt(
    data("sponsor_campaigns").filter((c) =>
      before(c.updated_at ?? c.effective_at ?? c.created_at),
    ),
    (c) => c.updated_at ?? c.effective_at ?? c.created_at,
  );
  const campaignMap = new Map<
    string,
    SourceData["sponsor_campaigns"][number]
  >();
  for (const c of campaignVersions) {
    const prior = campaignMap.get(c.sponsor_campaign_id);
    const populated = Object.fromEntries(
      Object.entries(c).filter(([, v]) => v !== undefined),
    );
    const merged = { ...prior, ...populated } as typeof c;
    if (c.owner_id && c.owner_id !== prior?.owner_id)
      merged.owner_name = OWNER_NAMES[c.owner_id] ?? c.owner_name;
    campaignMap.set(c.sponsor_campaign_id, merged);
  }
  const campaignRows = [...campaignMap.values()].filter((c) =>
    before(c.created_at),
  );
  const campaignById = new Map(
    campaignRows.map((c) => [c.sponsor_campaign_id, c]),
  );
  const campaignMatches = (id: string) => {
    const c = campaignById.get(id);
    return (
      matches(filters.campaign, id, c?.campaign_name) &&
      matches(filters.channel, c?.channel, c ? groupFor(c.channel) : undefined)
    );
  };
  const qualifications = sortAt(
    data("brand_qualification_history").filter((r) => before(r.effective_at)),
    (r) => r.effective_at,
  );
  const latestQual = new Map(qualifications.map((r) => [r.brand_id, r]));
  const allInteractions = sortAt(
    data("sponsor_interactions").filter((r) => before(r.occurred_at)),
    (r) => r.occurred_at,
  );
  const firstCampaign = new Map<string, string>();
  for (const row of allInteractions)
    if (!firstCampaign.has(row.brand_id) && row.sponsor_campaign_id)
      firstCampaign.set(row.brand_id, row.sponsor_campaign_id);
  const sourceBrands = data("brands").filter((r) => before(r.created_at));
  const allBrands = sourceBrands.map((b) => {
    const q = latestQual.get(b.brand_id);
    const campaignId =
      q?.sponsor_campaign_id ?? firstCampaign.get(b.brand_id) ?? "";
    return {
      id: b.brand_id,
      name: b.brand_name,
      /** The provided dataset's own name for this brand, kept so questions that use it still resolve. */
      aka: (b as { dataset_brand_name?: string }).dataset_brand_name ?? "",
      /** Real-world evidence behind the mapped name (lib/brand-register.ts). */
      realBrand: BRAND_MAP[b.brand_id] ?? registerEntry(b.brand_name) ?? null,
      industry: b.industry,
      ownerId: b.owner_id,
      owner: b.owner_name ?? OWNER_NAMES[b.owner_id] ?? b.owner_id,
      qualification: q?.qualification_status ?? "unreviewed",
      qualificationAt: q?.effective_at ?? b.created_at,
      campaignId,
      group: groupFor(campaignById.get(campaignId)?.channel ?? ""),
      createdAt: b.created_at,
      provenance: b.provenance ?? "user",
      doNotContact: allInteractions.some(
        (t) => t.brand_id === b.brand_id && t.event_type === "opt_out",
      ),
    };
  });
  const baseBrandMatch = (b: (typeof allBrands)[number]) =>
    matches(filters.industry, b.industry);
  const brands = allBrands.filter(
    (b) =>
      baseBrandMatch(b) &&
      matches(filters.owner, b.ownerId, b.owner) &&
      campaignMatches(b.campaignId),
  );
  const allBrandById = new Map(allBrands.map((b) => [b.id, b]));
  const ids = new Set(brands.map((b) => b.id));
  const interactions = allInteractions
    .filter((r) => {
      const b = allBrandById.get(r.brand_id);
      return (
        b &&
        baseBrandMatch(b) &&
        matches(filters.owner, b.ownerId, b.owner) &&
        campaignMatches(r.sponsor_campaign_id ?? "")
      );
    })
    .map((r) => ({
      ...r,
      id: r.interaction_id,
      brandId: r.brand_id,
      date: r.occurred_at,
      type: r.event_type,
      brand: allBrandById.get(r.brand_id)?.name ?? r.brand_id,
    }));
  const contacts = data("sponsor_contacts")
    .filter((c) => ids.has(c.brand_id) && before(c.created_at))
    .map((c) => ({
      ...c,
      id: c.contact_id,
      name: c.contact_name,
      brandId: c.brand_id,
      title: c.job_title,
    }));
  const stageHistory = sortAt(
    data("opportunity_history").filter((h) => before(h.effective_at)),
    (h) => h.effective_at,
  );
  const byDeal = new Map<string, typeof stageHistory>();
  for (const h of stageHistory) {
    const list = byDeal.get(h.opportunity_id);
    if (list) list.push(h);
    else byDeal.set(h.opportunity_id, [h]);
  }
  const allDeals = data("opportunities")
    .filter((o) => before(o.created_at))
    .flatMap((o) => {
      const history = byDeal.get(o.opportunity_id) ?? [],
        h = history.at(-1),
        b = allBrandById.get(o.brand_id);
      if (!b) return [];
      const ownerId = h?.owner_id ?? b.ownerId,
        campaignId = o.sponsor_campaign_id ?? b.campaignId;
      const stage = h?.stage ?? "prospecting",
        since = h?.effective_at ?? o.created_at;
      const channel = campaignById.get(campaignId)?.channel ?? "";
      return [
        {
          id: o.opportunity_id,
          name: o.opportunity_name,
          brandId: b.id,
          brand: b.name,
          industry: b.industry,
          stage,
          value:
            stage === "partner_confirmed"
              ? (h?.confirmed_value_inr ?? 0)
              : (h?.proposed_value_inr ?? 0),
          proposedValue: h?.proposed_value_inr ?? 0,
          confirmedValue: h?.confirmed_value_inr ?? 0,
          ownerId,
          owner: h?.owner_name ?? OWNER_NAMES[ownerId] ?? ownerId,
          daysInStage: days(asOf, since),
          stageSince: since,
          createdAt: o.created_at,
          campaignId,
          channel,
          group: groupFor(channel),
          supportType: o.support_type,
          history,
          provenance: h?.provenance ?? o.provenance ?? "user",
        },
      ];
    });
  const stageStats = (stage: string, group?: ChannelGroup) => {
    const eligible = allDeals.filter(
      (d) =>
        isClosed(d.stage) &&
        (!group || d.group === group) &&
        d.history.some((h) => h.stage === stage),
    );
    const won = eligible.filter((d) => d.stage === "partner_confirmed");
    const waits = won.map((d) =>
      days(
        d.stageSince,
        d.history.find((h) => h.stage === stage)!.effective_at,
      ),
    );
    const durations = won.flatMap((d) => {
      const ix = d.history.findIndex((h) => h.stage === stage);
      const next = d.history.slice(ix + 1).find((h) => h.stage !== stage);
      return next ? [days(next.effective_at, d.history[ix].effective_at)] : [];
    });
    return {
      winChance: (won.length + 1) / (eligible.length + 2),
      waits,
      durations,
    };
  };
  const stats = new Map(
    OPEN_STAGES.flatMap((stage) =>
      ["warm", "cold"].map(
        (g) => [stage + g, stageStats(stage, g as ChannelGroup)] as const,
      ),
    ),
  );
  const allStats = new Map(
    OPEN_STAGES.map((stage) => [stage, stageStats(stage)]),
  );
  const deals = allDeals
    .filter(
      (d) =>
        matches(filters.industry, d.industry) &&
        matches(filters.owner, d.ownerId, d.owner) &&
        campaignMatches(d.campaignId),
    )
    .map((d) => {
      const pooled = allStats.get(d.stage),
        group = stats.get(d.stage + d.group);
      const threshold = Math.max(
        settings.stalledDays,
        2 * median(pooled?.durations ?? []),
      );
      const waits = group?.waits.length ? group.waits : (pooled?.waits ?? []);
      const remaining = daysLeft - settings.paymentLag;
      const timeChance = rate(
        waits.filter((w) => w <= remaining).length,
        waits.length,
      );
      const expectedCash =
        d.supportType === "cash" && isOpen(d.stage)
          ? Math.round(
              d.proposedValue *
                (group?.winChance ?? 0) *
                timeChance *
                settings.payRate,
            )
          : 0;
      return {
        ...d,
        threshold,
        stalled: isOpen(d.stage) && d.daysInStage > threshold,
        expectedCash,
        winChance: group?.winChance ?? 0,
        timeChance,
        lastSafeDate: dateShift(
          festivalDate,
          -Math.ceil(median(waits)) - settings.paymentLag,
        ),
      };
    });
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const won = deals.filter((d) => d.stage === "partner_confirmed"),
    open = deals.filter((d) => isOpen(d.stage)),
    stalled = open
      .filter((d) => d.stalled)
      .sort((a, b) => b.value - a.value || b.daysInStage - a.daysInStage);
  const simulated = seedMoney(source, settings);
  const issued = [
    ...latest(
      [...simulated.invoices, ...data("invoices")].filter(
        (i) =>
          before(i.issued_at) &&
          before(i.effective_at ?? i.issued_at) &&
          dealById.get(i.opportunity_id)?.supportType === "cash",
      ),
      (i) => i.invoice_id,
      (i) => i.effective_at ?? i.issued_at,
    ).values(),
  ].filter((i) => !["void", "draft"].includes(i.status ?? ""));
  const validInvoices = new Set(issued.map((i) => i.invoice_id));
  const posted = sortAt(
    [
      ...latest(
        [...simulated.payments, ...data("payments")].filter(
          (p) => validInvoices.has(p.invoice_id) && before(p.received_at),
        ),
        (p) => p.payment_id,
        (p) => p.received_at,
      ).values(),
    ],
    (p) => p.received_at,
  );
  const balances = new Map(issued.map((i) => [i.invoice_id, i.amount_inr]));
  const payments = posted.flatMap((p) => {
    const balance = balances.get(p.invoice_id) ?? 0;
    // A simulated settlement receives only the remainder after staff have logged payments.
    const amount =
      p.provenance === "simulated"
        ? Math.min(balance, p.amount_inr)
        : p.amount_inr;
    balances.set(p.invoice_id, Math.max(0, balance - amount));
    return amount > 0
      ? [
          {
            ...p,
            id: p.payment_id,
            invoiceId: p.invoice_id,
            amount,
            receivedAt: p.received_at,
          },
        ]
      : [];
  });
  const invoices = issued
    .map((i) => {
      const d = dealById.get(i.opportunity_id)!,
        paid = sum(
          payments.filter((p) => p.invoiceId === i.invoice_id),
          (p) => p.amount,
        );
      const balance = Math.max(0, i.amount_inr - paid);
      const status =
        balance === 0
          ? "paid"
          : time(i.due_at) < cutoff
            ? "overdue"
            : paid
              ? "part paid"
              : "sent";
      return {
        ...i,
        id: i.invoice_id,
        dealId: d.id,
        brandId: d.brandId,
        brand: d.brand,
        ownerId: d.ownerId,
        owner: d.owner,
        amount: i.amount_inr,
        balance,
        paid,
        dueAt: i.due_at,
        issuedAt: i.issued_at,
        expectedPaymentAt: i.expected_payment_at ?? "",
        status,
      };
    })
    .sort((a, b) => time(a.dueAt) - time(b.dueAt));
  const preFestPayments = payments.filter(
    (p) => time(p.receivedAt) < time(event.event_starts_at),
  );
  const cash = {
    target: targets.cash,
    confirmed: sum(
      won.filter((d) => d.supportType === "cash"),
      (d) => d.confirmedValue,
    ),
    inKind: sum(
      won.filter((d) => d.supportType === "in_kind"),
      (d) => d.confirmedValue,
    ),
    invoiced: sum(invoices, (i) => i.amount),
    collected: sum(preFestPayments, (p) => p.amount),
    overdue: sum(
      invoices.filter((i) => i.status === "overdue"),
      (i) => i.balance,
    ),
    outstanding: sum(invoices, (i) => i.balance),
  };
  const qualified = brands.filter((b) => b.qualification === "qualified");
  const counts = {
    qualified: qualified.length,
    confirmed: won.length,
    confirmedValue: sum(won, (d) => d.confirmedValue),
    open: open.length,
    openValue: sum(open, (d) => d.value),
    brands: brands.length,
    deals: deals.length,
  };
  const touched = (condition: (i: (typeof interactions)[number]) => boolean) =>
    distinct(interactions.filter(condition).map((i) => i.brandId));
  const steps: [string, string, string[], number?][] = [
    ["contacted", "Contacted", touched((i) => firstTouch.has(i.event_type))],
    ["responded", "Responded", touched((i) => i.event_type === "replied")],
    [
      "positive",
      "Positive reply",
      touched((i) => i.event_type === "replied" && i.outcome === "positive"),
    ],
    [
      "meeting",
      "Meeting held",
      touched((i) => i.event_type === "meeting_held"),
    ],
    ["qualified", "Qualified", qualified.map((b) => b.id)],
    [
      "deals",
      "Deal opened",
      distinct(deals.map((d) => d.brandId)),
      deals.length,
    ],
    [
      "proposal",
      "Proposal sent",
      distinct(
        deals
          .filter((d) =>
            d.history.some((h) =>
              ["proposal_sent", "negotiating", "partner_confirmed"].includes(
                h.stage,
              ),
            ),
          )
          .map((d) => d.brandId),
      ),
      deals.filter((d) =>
        d.history.some((h) =>
          ["proposal_sent", "negotiating", "partner_confirmed"].includes(
            h.stage,
          ),
        ),
      ).length,
    ],
    [
      "negotiating",
      "Negotiating",
      distinct(
        deals
          .filter((d) =>
            d.history.some((h) =>
              ["negotiating", "partner_confirmed"].includes(h.stage),
            ),
          )
          .map((d) => d.brandId),
      ),
      deals.filter((d) =>
        d.history.some((h) =>
          ["negotiating", "partner_confirmed"].includes(h.stage),
        ),
      ).length,
    ],
    ["confirmed", "Confirmed", distinct(won.map((d) => d.brandId)), won.length],
    [
      "invoiced",
      "Invoiced",
      distinct(invoices.map((i) => i.brandId)),
      distinct(invoices.map((i) => i.dealId)).length,
    ],
    [
      "paid",
      "Payment received",
      distinct(
        invoices
          .filter((i) => preFestPayments.some((p) => p.invoiceId === i.id))
          .map((i) => i.brandId),
      ),
      distinct(
        invoices
          .filter((i) => preFestPayments.some((p) => p.invoiceId === i.id))
          .map((i) => i.dealId),
      ).length,
    ],
  ];
  const funnel = steps.map(([key, label, brandIds, n], i) => {
    const count = n ?? brandIds.length,
      previous = i ? (steps[i - 1][3] ?? steps[i - 1][2].length) : count;
    return {
      key,
      label,
      brandIds,
      count,
      conversion: rate(count, previous),
      lost: Math.max(0, previous - count),
      unit: i < 5 ? "brands" : "deals",
    };
  });
  const assumedBudgets: Record<string, number> = {
    SC01: 40000,
    SC02: 25000,
    SC03: 30000,
    SC04: 18000,
    SC05: 35000,
    SC06: 12000,
  };
  const campaigns = campaignRows
    .filter((c) => campaignMatches(c.sponsor_campaign_id))
    .map((c) => {
      const id = c.sponsor_campaign_id,
        rows = interactions.filter((i) => i.sponsor_campaign_id === id);
      const attempts = distinct(
        rows
          .filter((i) => firstTouch.has(i.event_type))
          .map((i) => i.attempt_id ?? i.id),
      ).length;
      const responded = distinct(
        rows
          .filter((i) => i.event_type === "replied")
          .map((i) => i.attempt_id ?? i.id),
      ).length;
      const positive = distinct(
        rows
          .filter((i) => i.event_type === "replied" && i.outcome === "positive")
          .map((i) => i.attempt_id ?? i.id),
      ).length;
      const meeting = distinct(
        rows
          .filter((i) => i.event_type === "meeting_held")
          .map((i) => i.attempt_id ?? i.id),
      ).length;
      const reached = distinct(
        rows.filter((i) => firstTouch.has(i.event_type)).map((i) => i.brandId),
      ).length;
      const campaignDeals = deals.filter((d) => d.campaignId === id),
        wins = campaignDeals.filter((d) => d.stage === "partner_confirmed");
      // At festival eve the open cohort is known; before it, only terminal outcomes enter win rate.
      const closed = campaignDeals.filter((d) => isClosed(d.stage)).length;
      const winDenominator =
        asOf >= dateShift(festivalDate, -1) ? campaignDeals.length : closed;
      const winRate = rate(wins.length, winDenominator),
        positiveRate = rate(positive, attempts),
        confirmedValue = sum(wins, (d) => d.confirmedValue);
      const budget =
        c.budget_inr === undefined
          ? (assumedBudgets[id] ?? null)
          : c.budget_inr;
      let verdict: "Scale" | "Fix" | "Stop" | "Observe" = "Observe";
      if (
        wins.length === 0 &&
        attempts >= settings.stopAttempts &&
        positiveRate < settings.positiveThreshold
      )
        verdict = "Stop";
      else if (wins.length === 0 && positiveRate >= settings.positiveThreshold)
        verdict = "Fix";
      else if (
        closed >= settings.scaleClosed &&
        winRate >= settings.scaleWinRate
      )
        verdict = "Scale";
      const qualifiedCount = qualified.filter(
        (b) => b.campaignId === id,
      ).length;
      return {
        id,
        name: c.campaign_name,
        channel: c.channel,
        group: groupFor(c.channel),
        ownerId: c.owner_id,
        owner: c.owner_name,
        status: c.status ?? "active",
        budget,
        budgetProvenance:
          c.budget_inr === undefined ? "assumption" : (c.provenance ?? "user"),
        attempts,
        brands: reached,
        responded,
        positive,
        meeting,
        qualified: qualifiedCount,
        replyRate: rate(responded, attempts),
        positiveRate,
        meetingRate: rate(meeting, attempts),
        qualifiedRate: rate(qualifiedCount, reached),
        winRate,
        deals: campaignDeals.length,
        closed,
        confirmed: wins.length,
        confirmedValue,
        per100: Math.round(rate(confirmedValue, attempts) * 100),
        roi: budget ? (confirmedValue - budget) / budget : null,
        verdict,
        directional: winDenominator < 10,
        plannedStart: c.planned_start_at,
        plannedEnd: c.planned_end_at,
        objective: c.objective ?? "",
        audience: c.audience ?? "",
        provenance: c.provenance ?? "user",
      };
    });
  const avgDeal = won.length
    ? Math.round(sum(won, (d) => d.confirmedValue) / won.length)
    : 0;
  const groupValue = (g: ChannelGroup) => {
    const ds = allDeals.filter((d) => d.group === g && isClosed(d.stage));
    const ws = ds.filter((d) => d.stage === "partner_confirmed");
    const cashWins = ws.filter((d) => d.supportType === "cash");
    return Math.round(
      ((ws.length + 1) / (ds.length + 2)) *
        rate(
          sum(cashWins, (d) => d.confirmedValue),
          ws.length,
        ),
    );
  };
  const brandLeak = (b: (typeof brands)[number], detail: string) => ({
    id: b.id,
    brandId: b.id,
    brand: b.name,
    owner: b.owner,
    ownerId: b.ownerId,
    group: b.group,
    value: groupValue(b.group),
    detail,
  });
  const dealLeak = (d: (typeof deals)[number], detail: string) => ({
    id: d.id,
    brandId: d.brandId,
    brand: d.brand,
    owner: d.owner,
    ownerId: d.ownerId,
    group: d.group,
    value: d.value,
    detail,
  });
  const anyDeal = new Set(allDeals.map((d) => d.brandId));
  const qualifiedWithoutDeal = qualified.filter((b) => !anyDeal.has(b.id));
  const unserved = qualifiedWithoutDeal.filter(
    (b) => days(asOf, b.qualificationAt) >= settings.qualifiedDays,
  );
  const lastTouch = (type: string, outcome?: string) =>
    latest(
      interactions.filter(
        (i) => i.event_type === type && (!outcome || i.outcome === outcome),
      ),
      (i) => i.brandId,
      (i) => i.occurred_at,
    );
  const positiveReplies = lastTouch("replied", "positive"),
    bookings = lastTouch("meeting_booked"),
    meetings = lastTouch("meeting_held");
  const leakRows = [
    {
      key: "qualified_no_deal",
      label: "Qualified without a deal",
      records: unserved.map((b) =>
        brandLeak(
          b,
          "Qualified " + days(asOf, b.qualificationAt) + " days ago",
        ),
      ),
    },
    {
      key: "reply_no_meeting",
      label: "Positive reply without a meeting",
      records: brands.flatMap((b) => {
        const p = positiveReplies.get(b.id);
        return p &&
          !bookings.has(b.id) &&
          !meetings.has(b.id) &&
          days(asOf, p.occurred_at) >= settings.replyDays
          ? [brandLeak(b, "Positive reply on " + day(p.occurred_at))]
          : [];
      }),
    },
    {
      key: "meeting_no_decision",
      label: "Meeting without a qualification decision",
      records: brands.flatMap((b) => {
        const m = meetings.get(b.id);
        return m &&
          !["qualified", "unqualified"].includes(b.qualification) &&
          days(asOf, m.occurred_at) >= settings.meetingDays
          ? [brandLeak(b, "Meeting held on " + day(m.occurred_at))]
          : [];
      }),
    },
    {
      key: "unqualified_deal",
      label: "Deals on unqualified brands",
      records: deals
        .filter(
          (d) => allBrandById.get(d.brandId)?.qualification !== "qualified",
        )
        .map((d) =>
          dealLeak(
            d,
            "Brand is " +
              (allBrandById.get(d.brandId)?.qualification ?? "unreviewed"),
          ),
        ),
    },
    {
      key: "confirmed_no_invoice",
      label: "Confirmed cash without an invoice",
      records: won
        .filter(
          (d) =>
            d.supportType === "cash" &&
            !invoices.some((i) => i.dealId === d.id) &&
            days(asOf, d.stageSince) >= settings.invoiceDays,
        )
        .map((d) => dealLeak(d, "Cash deal confirmed on " + day(d.stageSince))),
    },
    {
      key: "overdue_invoice",
      label: "Overdue invoices",
      records: invoices
        .filter((i) => i.status === "overdue")
        .map((i) => ({
          ...dealLeak(dealById.get(i.dealId)!, "Invoice due " + day(i.dueAt)),
          id: i.id,
          value: i.balance,
        })),
    },
  ];
  const leakage = leakRows.map((r) => ({
    ...r,
    count: r.records.length,
    value: sum(r.records, (n) => n.value),
  }));
  const unpaidDue = sum(
    invoices.filter((i) => time(i.dueAt) < time(event.event_starts_at)),
    (i) => i.balance,
  );
  const committed = Math.round(cash.collected + unpaidDue * settings.payRate);
  const base = committed + sum(open, (d) => d.expectedCash);
  const forecast = {
    committed,
    base,
    stretch: base + sum(qualifiedWithoutDeal, (b) => groupValue(b.group)),
    unpaidDue,
    openExpected: sum(open, (d) => d.expectedCash),
    leakedExpected: sum(qualifiedWithoutDeal, (b) => groupValue(b.group)),
    payRate: settings.payRate,
    paymentLag: settings.paymentLag,
    averageDeal: avgDeal,
  };
  const eventStart = day(event.history_start);
  const versionTargets = sortAt(
    data("targets").filter((t) => before(t.effective_at)),
    (t) => t.effective_at,
  );
  const chartPoint = (date: string) => {
    const seen = deals
      .filter((d) => day(d.createdAt) <= date)
      .map((d) => d.history.filter((h) => day(h.effective_at) <= date).at(-1))
      .filter((h) => h?.stage === "partner_confirmed");
    const targetAtDate = versionTargets
      .filter((t) => day(t.effective_at) <= date)
      .at(-1);
    const tCash = targetAtDate
      ? (input.settings?.cashTarget ??
        targetAtDate.cash_goal_inr ??
        settings.cashTarget)
      : 0;
    const progress = Math.max(
      0,
      Math.min(1, rate(days(date, eventStart), days(festivalDate, eventStart))),
    );
    return {
      date,
      confirmed: seen.length,
      confirmedValue: sum(seen, (s) => s?.confirmed_value_inr ?? 0),
      collected: sum(
        preFestPayments.filter((p) => day(p.received_at) <= date),
        (p) => p.amount,
      ),
      target:
        Math.round(
          (targetAtDate?.confirmed_partnerships_goal ?? 0) * progress * 10,
        ) / 10,
      cashTarget: Math.round(tCash * progress),
    };
  };
  const points: ReturnType<typeof chartPoint>[] = [];
  for (
    let date = eventStart;
    date <= asOf && points.length < 367;
    date = dateShift(date, 1)
  )
    points.push(chartPoint(date));
  if (!points.length || points.at(-1)?.date !== asOf)
    points.push(chartPoint(asOf));
  const pacing = {
    neededPerWeek:
      daysLeft > 0
        ? (Math.max(0, targets.confirmed - counts.confirmed) * 7) / daysLeft
        : 0,
    points,
  };
  const owners = Object.entries(OWNER_NAMES).map(([id, name]) => ({
    id,
    name,
    brands: brands.filter((b) => b.ownerId === id).length,
    open: open.filter((d) => d.ownerId === id).length,
    stalled: stalled.filter((d) => d.ownerId === id).length,
    capacity: (
      { T01: 24, T02: 30, T03: 20, T05: 24 } as Record<string, number>
    )[id],
  }));
  const moneyList = [
    ...open.map((d) => ({
      ...dealLeak(d, d.stage.replaceAll("_", " ")),
      kind: "deal" as const,
      expectedCash: d.expectedCash,
    })),
    ...qualifiedWithoutDeal.map((b) => ({
      ...brandLeak(b, "Qualified · no deal"),
      kind: "brand" as const,
      expectedCash: groupValue(b.group),
    })),
  ].sort((a, b) => b.expectedCash - a.expectedCash || b.value - a.value);
  return {
    asOf,
    season,
    festivalDate,
    daysLeft,
    targets,
    cash,
    counts,
    pacing,
    forecast,
    funnel,
    campaigns,
    brands,
    deals,
    invoices,
    payments,
    stalled,
    leakage,
    interactions,
    contacts,
    owners,
    moneyList,
    qualifiedWithoutDeal,
    qualificationHistory: qualifications.filter((q) => ids.has(q.brand_id)),
    activations: data("sponsor_activations").filter(
      (a) => ids.has(a.brand_id) && before(a.linked_at),
    ),
    provenance: season === "2025" ? "source" : "simulated",
    industries: distinct(allBrands.map((b) => b.industry)).sort(),
    event,
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
