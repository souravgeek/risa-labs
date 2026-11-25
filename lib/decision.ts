import type { ScenarioInput, Season, StageRow } from "./data-types";
import type { Snapshot } from "./metrics";
import { dateAdd as dateShift } from "./shared";
import { RANKED } from "./brand-register";

const DAY = 86_400_000;

const between = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
const fraction = (value: number) => between(value, 0, 1);
const canonical = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const companyKey = (s: string) =>
  canonical(s)
    .replace(/(?:\s+(?:private|pvt|limited|ltd|inc|llp|llc|company))+$/g, "")
    .trim();
const dayNumber = (day: string) =>
  Date.parse(day.slice(0, 10) + "T00:00:00Z") / DAY;

export interface Connection {
  viaType: "alumni" | "creator" | "sponsor";
  viaName: string;
  ownerId: string;
  strength: number; // 0–100
}
export interface Prospect {
  id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  city: string;
  source: string;
  targetsYouth?: boolean;
  timing?: number;
  timingSignal?: string;
  connections?: Connection[];
  doNotContact?: boolean;
  optedOut?: boolean;
  status?: "new" | "intro requested" | "cold queued" | "added" | "review";
  createdAt?: string;
}
export interface ExclusiveSponsor {
  industry: string;
  company: string;
  active?: boolean;
}
type SampleRate = { winRate: number; sampleSize: number };
export interface ScoringOptions {
  industryWinRates?: Record<string, SampleRate>;
  weights?: { fit: number; warmth: number; timing: number };
}
export function scoreProspect(
  prospect: Prospect,
  {
    industryWinRates = {},
    weights = { fit: 0.4, warmth: 0.4, timing: 0.2 },
  }: ScoringOptions = {},
) {
  const evidence = Object.entries(industryWinRates).find(
    ([industry]) => canonical(industry) === canonical(prospect.industry),
  )?.[1];
  const title = canonical(prospect.title);
  const decisionAuthority =
    /\b(founder|head|director|vice president|vp|chief|cmo)\b/.test(title);
  const relevantRole =
    /\b(partnerships?|brand|marketing|growth|sponsorships?|founder|cmo)\b/.test(
      title,
    );
  const role = relevantRole
    ? decisionAuthority
      ? 100
      : 78
    : decisionAuthority
      ? 65
      : 36;
  const industryFit = evidence ? fraction(evidence.winRate) * 100 : 50;
  const fit = Math.round(
    0.45 * industryFit +
      0.35 * role +
      0.2 *
        (prospect.targetsYouth === undefined
          ? 50
          : prospect.targetsYouth
            ? 100
            : 0),
  );
  const connection = (prospect.connections || []).reduce<
    Connection | undefined
  >(
    (best, current) =>
      current.strength > 0 && (!best || current.strength > best.strength)
        ? current
        : best,
    undefined,
  );
  const warmth = connection ? between(connection.strength, 0, 100) : 0;
  const timing = between(prospect.timing ?? 50, 0, 100);
  const w = [weights.fit, weights.warmth, weights.timing].map((x) =>
    between(x, 0, 100),
  );
  const sum = w[0] + w[1] + w[2];
  const score = Math.round(
    sum
      ? (fit * w[0] + warmth * w[1] + timing * w[2]) / sum
      : 0.4 * fit + 0.4 * warmth + 0.2 * timing,
  );
  return {
    score,
    fit,
    warmth,
    timing,
    connection,
    industrySampleSize: evidence?.sampleSize ?? 0,
    directional: true,
  };
}
export function routeProspect(
  prospect: Prospect,
  options: {
    exclusiveSponsors?: ExclusiveSponsor[];
    coldUsed?: number;
    coldCap?: number;
  } = {},
) {
  const { connection } = scoreProspect(prospect);
  if (prospect.doNotContact || prospect.optedOut)
    return {
      kind: "excluded",
      reason: "Do not contact",
      ownerId: null,
    } as const;
  const conflict = options.exclusiveSponsors?.find(
    (s) =>
      s.active !== false &&
      canonical(s.industry) === canonical(prospect.industry) &&
      companyKey(s.company) !== companyKey(prospect.company),
  );
  if (conflict)
    return {
      kind: "excluded",
      reason: "Category exclusivity held by " + conflict.company,
      ownerId: null,
    } as const;
  if (prospect.status && !["new", "review"].includes(prospect.status))
    return {
      kind: "complete",
      reason: prospect.status,
      ownerId: null,
    } as const;
  if (prospect.status === "review")
    return {
      kind: "review",
      reason: "Resolve the possible company match",
      ownerId: null,
    } as const;
  if (connection)
    return {
      kind: "intro",
      reason: "Request an introduction from " + connection.viaName,
      ownerId: connection.ownerId,
    } as const;
  if ((options.coldUsed ?? 0) >= (options.coldCap ?? 10))
    return {
      kind: "deferred",
      reason: "Daily cold queue is full",
      ownerId: null,
    } as const;
  return {
    kind: "cold",
    reason: "Queue in the cold test campaign",
    ownerId: null,
  } as const;
}
export function matchProspectCompany(
  prospect: Pick<Prospect, "company">,
  brands: { id: string; name: string }[],
) {
  const key = companyKey(prospect.company);
  if (!key) return { kind: "new", matches: [] } as const;
  const exact = brands.filter((b) => companyKey(b.name) === key);
  if (exact.length)
    return {
      kind: exact.length === 1 ? "existing" : "review",
      matches: exact,
    } as const;
  // Suggestions only. Human review resolves the identity before any merge.
  const distinctive = (s: string) =>
    new Set(
      s
        .split(" ")
        .filter(
          (w) =>
            w.length > 2 &&
            ![
              "the",
              "and",
              "studio",
              "works",
              "group",
              "brand",
              "goods",
              "india",
            ].includes(w),
        ),
    );
  const tokens = distinctive(key);
  const near = brands.filter((b) => {
    const theirs = distinctive(companyKey(b.name));
    const overlap = [...tokens].filter((t) => theirs.has(t)).length;
    return overlap > 0 && overlap / Math.max(theirs.size, tokens.size) >= 0.66;
  });
  return { kind: near.length ? "review" : "new", matches: near } as const;
}
export function seedProspects(season: Season = "2026"): Prospect[] {
  const titles = [
    "Head of Partnerships",
    "Brand Manager",
    "Marketing Director",
    "Community Lead",
    "Partnerships Manager",
    "Founder",
    "Growth Manager",
  ];
  const via = [
    "Devika Nair",
    "Soham Joshi",
    "Leena Rao",
    "Arjun Sen",
    "Maya Das",
    "Sameer Roy",
  ];
  // Simulated signals are labelled as such; a verified fest sponsorship is the only real signal we hold.
  const signal = [
    "Recent campus launch (simulated)",
    "New youth product line (simulated)",
    "Festive-season campaign (simulated)",
    "No current timing signal",
  ];
  const baseDate = season === "2026" ? "2026-09-22" : "2025-01-15";
  return Array.from({ length: 150 }, (_, i) => {
    const warm = i % 5 < 3;
    // Real companies (lib/brand-register.ts), each prospect shown by role: no real person is named.
    const company = RANKED.at(i % RANKED.length)!, title = titles[(i * 3) % titles.length];
    const verified = company.evidence !== "none";
    return {
      id: "P" + season + "-" + String(i + 1).padStart(3, "0"),
      name: title + ", " + company.name,
      company: company.name,
      industry: company.industry,
      title,
      city: "Bengaluru",
      source: verified ? "Public research" : "Simulated",
      status: "new",
      targetsYouth: company.youth >= 20,
      timing: verified ? 90 : [70, 60, 50, 35][i % 4],
      timingSignal: verified ? company.evidenceNote + " (" + company.source + ")" : signal[i % 4],
      connections: warm
        ? [
            {
              viaType: (["alumni", "creator", "sponsor"] as const)[i % 3],
              viaName: via[i % via.length],
              ownerId: ["T01", "T02", "T03", "T05"][i % 4],
              strength: 65 + ((i * 11) % 35),
            },
          ]
        : [],
      createdAt: dateShift(baseDate, i % 50),
    };
  });
}
export function coldFollowUpPolicy({
  channel,
  previousTouches,
  dailyColdCount = 0,
  dailyCap = 10,
}: {
  channel: string;
  previousTouches: number;
  dailyColdCount?: number;
  dailyCap?: number;
}) {
  if (
    !["cold", "email", "linkedin", "cold_email", "cold_linkedin"].includes(
      channel.toLowerCase(),
    )
  )
    return { allowed: true, warning: null };
  if (dailyColdCount >= dailyCap)
    return { allowed: false, warning: "Daily cold queue limit reached." };
  if (previousTouches >= 2)
    return {
      allowed: true,
      warning:
        "Third or later cold touch. Prior follow-ups generated no positive replies in the 2025 dataset.",
    };
  return { allowed: true, warning: null };
}

export type DealStage =
  "prospecting" | "contacted" | "proposal_sent" | "negotiating";
const openStages: DealStage[] = [
  "prospecting",
  "contacted",
  "proposal_sent",
  "negotiating",
];
const wonStage = "partner_confirmed";
export function stageDeadlines(
  view: { asOf: string; festivalDate: string },
  historicalStageRows: StageRow[],
  paymentLag = 15,
) {
  const grouped = new Map<string, StageRow[]>();
  for (const row of historicalStageRows) {
    if (row.effective_at.slice(0, 10) > view.asOf) continue;
    const history = grouped.get(row.opportunity_id) || [];
    history.push(row);
    grouped.set(row.opportunity_id, history);
  }
  const samples = Object.fromEntries(
    openStages.map((s) => [s, [] as number[]]),
  ) as Record<DealStage, number[]>;
  for (const unsorted of grouped.values()) {
    const history = unsorted
      .slice()
      .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
    if (history.at(-1)?.stage !== wonStage) continue;
    const won = history.find((r) => r.stage === wonStage)!;
    for (const stage of openStages) {
      const first = history.find(
        (r) => r.stage === stage && r.effective_at <= won.effective_at,
      );
      if (first)
        samples[stage].push(
          dayNumber(won.effective_at) - dayNumber(first.effective_at),
        );
    }
  }
  return openStages.map((stage) => {
    const items = samples[stage].sort((a, b) => a - b);
    const mid = Math.floor(items.length / 2);
    const medianDays = items.length
      ? items.length % 2
        ? items[mid]
        : (items[mid] + items[mid - 1]) / 2
      : null;
    const lastSafeDate =
      medianDays === null
        ? null
        : dateShift(
            view.festivalDate,
            -Math.ceil(medianDays + between(paymentLag, 0, 90)),
          );
    return {
      stage,
      medianDays,
      sampleSize: items.length,
      directional: items.length < 10,
      lastSafeDate,
      behind: Boolean(lastSafeDate && view.asOf > lastSafeDate),
    };
  });
}

/** Align with the same number of days remaining in the historical season. */
export function historicalBaselineDate(
  view: Pick<Snapshot, "asOf" | "festivalDate">,
  historicalFestivalDate = "2025-04-12",
) {
  const daysRemaining = Math.max(
    0,
    dayNumber(view.festivalDate) - dayNumber(view.asOf),
  );
  return dateShift(historicalFestivalDate, -daysRemaining);
}

export function historicalIndustryRates(
  view: Pick<Snapshot, "deals">,
): Record<string, SampleRate> {
  const counts = new Map<string, { wins: number; n: number }>();
  for (const deal of view.deals) {
    if (![wonStage, "lost", "withdrawn"].includes(deal.stage)) continue;
    const group = counts.get(deal.industry) ?? { wins: 0, n: 0 };
    group.n++;
    group.wins += Number(deal.stage === wonStage);
    counts.set(deal.industry, group);
  }
  return Object.fromEntries(
    [...counts].map(([key, s]) => [
      key,
      { winRate: (s.wins + 1) / (s.n + 2), sampleSize: s.n },
    ]),
  );
}

export function rankBottlenecks(view: Snapshot, benchmark: Snapshot) {
  const confirmed = view.deals.filter(
    (d) => d.stage === wonStage && d.supportType === "cash",
  );
  const averageCashDeal = confirmed.length
    ? confirmed.reduce((total, d) => total + d.confirmedValue, 0) /
      confirmed.length
    : 0;
  const winIndex = view.funnel.findIndex((step) => step.key === "confirmed");
  const benchmarkCounts = new Map(
    benchmark.funnel.map((step, idx) => [
      step.key,
      { step, prior: benchmark.funnel[idx - 1]?.count ?? 0 },
    ]),
  );
  return view.funnel
    .slice(1)
    .flatMap((step, index) => {
      const entering = view.funnel[index].count;
      const ref = benchmarkCounts.get(step.key);
      if (!entering || !ref || !ref.prior || index + 1 > winIndex) return [];
      const actualRate = fraction(step.count / entering),
        benchmarkRate = fraction(ref.step.count / ref.prior);
      if (benchmarkRate <= actualRate) return [];
      const downstreamWinRate =
        index + 1 === winIndex
          ? 1
          : fraction(benchmark.counts.confirmed / Math.max(1, ref.step.count));
      const lostCash = Math.round(
        (benchmarkRate - actualRate) *
          entering *
          averageCashDeal *
          downstreamWinRate,
      );
      return [
        {
          key: step.key,
          label: step.label,
          entering,
          actualRate,
          benchmarkRate,
          averageCashDeal: Math.round(averageCashDeal),
          downstreamWinRate,
          lostCash,
          benchmarkSample: ref.prior,
          directional: Math.min(entering, ref.prior) < 10,
        },
      ];
    })
    .sort((a, b) => b.lostCash - a.lostCash || b.entering - a.entering)
    .slice(0, 3);
}

type ForecastTotals = Pick<
  Snapshot["forecast"],
  "committed" | "base" | "stretch"
>;
const subtract = (a: ForecastTotals, b: ForecastTotals) => ({
  committed: a.committed - b.committed,
  base: a.base - b.base,
  stretch: a.stretch - b.stretch,
});

/** Book only cash receipts before festival start and weight unpaid pre-festival invoices. */
function committedByDeal(view: Snapshot) {
  const byDeal = new Map<string, number>();
  const byInvoice = new Map(view.invoices.map((row) => [row.id, row]));
  const festival = Date.parse(view.event.event_starts_at);
  for (const payment of view.payments) {
    const invoice = byInvoice.get(payment.invoiceId);
    if (invoice && Date.parse(payment.receivedAt) < festival)
      byDeal.set(
        invoice.dealId,
        (byDeal.get(invoice.dealId) ?? 0) + payment.amount,
      );
  }
  for (const invoice of view.invoices) {
    if (Date.parse(invoice.dueAt) < festival)
      byDeal.set(
        invoice.dealId,
        (byDeal.get(invoice.dealId) ?? 0) +
          invoice.balance * view.forecast.payRate,
      );
  }
  return byDeal;
}

export function compareSnapshots(before: Snapshot, after: Snapshot) {
  if (before.season !== after.season)
    throw new Error("Choose dates in the same season.");
  if (before.asOf > after.asOf)
    throw new Error(
      "The comparison start date must be on or before its end date.",
    );
  const oldDeals = new Map(before.deals.map((d) => [d.id, d])),
    oldBrands = new Map(before.brands.map((b) => [b.id, b]));
  const newDeals = after.deals.filter((d) => !oldDeals.has(d.id));
  const newConfirmations = after.deals.filter(
    (d) => d.stage === wonStage && oldDeals.get(d.id)?.stage !== wonStage,
  );
  // Include intermediate transitions, even when the deal returned to its starting stage.
  const stageMoves = after.deals
    .flatMap((deal) => {
      const since = deal.history.filter(
        (h) => h.effective_at.slice(0, 10) > before.asOf,
      );
      let previous = oldDeals.get(deal.id)?.stage;
      return since.flatMap((version) => {
        const from = previous;
        previous = version.stage;
        return from && from !== version.stage
          ? [
              {
                id: deal.id,
                brandId: deal.brandId,
                brand: deal.brand,
                from,
                to: version.stage,
                at: version.effective_at,
              },
            ]
          : [];
      });
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const newlyDormant = after.brands.filter(
    (b) =>
      b.qualification === "dormant" &&
      oldBrands.get(b.id)?.qualification !== "dormant",
  );
  const priorLeaks = new Set(
    before.leakage.flatMap((rule) =>
      rule.records.map((r) => rule.key + "/" + r.id),
    ),
  );
  const newLeaks = after.leakage.flatMap((rule) =>
    rule.records
      .filter((r) => !priorLeaks.has(rule.key + "/" + r.id))
      .map((r) => ({ ...r, rule: rule.key, label: rule.label })),
  );
  const oldMoney = committedByDeal(before),
    newMoney = committedByDeal(after);
  const causes = {
    newDeals: 0,
    stageMoves: 0,
    losses: 0,
    payments: 0,
    timingAndModel: 0,
  };
  for (const deal of after.deals) {
    const old = oldDeals.get(deal.id);
    const committedDelta =
      (newMoney.get(deal.id) ?? 0) - (oldMoney.get(deal.id) ?? 0);
    const openDelta = deal.expectedCash - (old?.expectedCash ?? 0);
    if (!old) causes.newDeals += committedDelta + openDelta;
    else if (
      old.stage !== deal.stage &&
      ["lost", "withdrawn"].includes(deal.stage)
    )
      causes.losses += committedDelta + openDelta;
    else if (old.stage !== deal.stage)
      causes.stageMoves += committedDelta + openDelta;
    else {
      causes.payments += committedDelta;
      causes.timingAndModel += openDelta;
    }
  }
  const forecastChange = subtract(after.forecast, before.forecast);
  for (const key of Object.keys(causes) as (keyof typeof causes)[])
    causes[key] = Math.round(causes[key]);
  // Reconcile filter exits, rounding, and re-estimated stage rates explicitly.
  causes.timingAndModel =
    forecastChange.base -
    causes.newDeals -
    causes.stageMoves -
    causes.losses -
    causes.payments;
  return {
    from: before.asOf,
    to: after.asOf,
    newDeals,
    newConfirmations,
    stageMoves,
    newlyDormant,
    newLeaks,
    forecastChange,
    causes,
  };
}

function timingShare(
  view: Snapshot,
  stage: string,
  group: "warm" | "cold",
  paymentLag: number,
) {
  const waits = (onlyGroup: boolean) =>
    view.deals.flatMap((deal) => {
      if (deal.stage !== wonStage || (onlyGroup && deal.group !== group))
        return [];
      const entered = deal.history.find((row) => row.stage === stage);
      const won = deal.history.find((row) => row.stage === wonStage);
      return entered && won
        ? [dayNumber(won.effective_at) - dayNumber(entered.effective_at)]
        : [];
    });
  const grouped = waits(true);
  const sample = grouped.length ? grouped : waits(false);
  return sample.length
    ? sample.filter((days) => days + paymentLag <= view.daysLeft).length /
        sample.length
    : 0;
}

export const scenarioControls = [
  {
    key: "shiftCold",
    label: "Cold outreach moved to warm channels",
    min: 0,
    max: 1,
    step: 0.05,
    unit: "share",
  },
  {
    key: "partners",
    label: "New referral partners",
    min: 0,
    max: 20,
    step: 1,
    unit: "partners",
  },
  {
    key: "recover",
    label: "Qualified leads recovered",
    min: 0,
    max: 1,
    step: 0.05,
    unit: "share",
  },
  {
    key: "dealSizeChange",
    label: "Change in average deal size",
    min: -0.5,
    max: 1,
    step: 0.05,
    unit: "share",
  },
  {
    key: "discount",
    label: "Early-payment discount",
    min: 0,
    max: 0.25,
    step: 0.01,
    unit: "share",
  },
  {
    key: "uptake",
    label: "Discount uptake",
    min: 0,
    max: 1,
    step: 0.05,
    unit: "share",
  },
  {
    key: "paymentLag",
    label: "Payment terms",
    min: 0,
    max: 60,
    step: 1,
    unit: "days",
  },
] as const;

export function scenarioForecast(view: Snapshot, input: ScenarioInput = {}) {
  // Shares are fractions and dealSizeChange is signed. New terms apply prospectively.
  const shift = fraction(input.shiftCold ?? 0),
    partners = Math.floor(between(input.partners ?? 0, 0, 100)),
    recovered = fraction(input.recover ?? 0),
    sizeFactor = 1 + between(input.dealSizeChange ?? 0, -0.95, 3),
    discount = between(input.discount ?? 0, 0, 0.5),
    uptake = discount ? fraction(input.uptake ?? 0) : 0,
    lag = between(input.paymentLag ?? view.forecast.paymentLag, 0, 90),
    introsPerPartner = between(input.introsPerPartner ?? 2, 0, 50);
  const baseline: ForecastTotals = {
    committed: view.forecast.committed,
    base: view.forecast.base,
    stretch: view.forecast.stretch,
  };
  const canAct = view.daysLeft > 0 ? 1 : 0;
  const campaignTotals = (group: "warm" | "cold") =>
    view.campaigns
      .filter((c) => c.group === group)
      .reduce((acc, c) => acc + c.attempts, 0);
  const attemptValue = (group: "warm" | "cold") => {
    const groupWins = view.deals.filter(
      (d) =>
        d.group === group && d.stage === wonStage && d.supportType === "cash",
    );
    return (
      groupWins.reduce((n, d) => n + d.confirmedValue, 0) /
      Math.max(1, campaignTotals(group))
    );
  };
  const elapsed = Math.max(
    1,
    dayNumber(view.asOf) - dayNumber(view.event.history_start) + 1,
  );
  const expectedColdAttempts =
    (view.daysLeft * campaignTotals("cold")) / elapsed;
  const redirected = expectedColdAttempts * shift,
    addedIntros = partners * introsPerPartner;
  const chances = new Map<string, number>();
  function chance(stage: string, group: "warm" | "cold") {
    const key = stage + group;
    if (!chances.has(key))
      chances.set(key, timingShare(view, stage, group, lag));
    return chances.get(key)!;
  }
  const warmChance = chance("prospecting", "warm"),
    coldChance = chance("prospecting", "cold");
  const pay = view.forecast.payRate;
  const newOutreach = Math.round(
    canAct *
      sizeFactor *
      pay *
      ((redirected + addedIntros) * attemptValue("warm") * warmChance -
        redirected * attemptValue("cold") * coldChance),
  );
  const cashOpen = view.deals.filter(
    (d) =>
      d.supportType === "cash" && openStages.includes(d.stage as DealStage),
  );
  const open =
    lag === view.forecast.paymentLag && sizeFactor === 1
      ? view.forecast.openExpected
      : cashOpen.reduce(
          (n, d) =>
            n +
            Math.round(
              d.proposedValue *
                sizeFactor *
                d.winChance *
                (lag === view.forecast.paymentLag
                  ? d.timeChance
                  : chance(d.stage, d.group)) *
                pay,
            ),
          0,
        );
  const leakage = view.leakage.find((rule) => rule.key === "qualified_no_deal");
  const recovery = Math.round(
    canAct *
      recovered *
      (leakage?.records ?? []).reduce(
        (n, b) =>
          n + b.value * chance("prospecting", b.group) * pay * sizeFactor,
        0,
      ),
  );
  // Take-up is mutually exclusive with ordinary payment. Offer the discount to the outstanding balance only.
  const eligible = view.invoices.reduce((sum, i) => sum + i.balance, 0);
  const ordinaryOnAffected = view.forecast.unpaidDue * pay;
  const discountDelta = Math.round(
    canAct * uptake * (eligible * (1 - discount) - ordinaryOnAffected),
  );
  const committed = baseline.committed + discountDelta;
  const base = Math.max(committed, committed + open + recovery + newOutreach);
  const stretch = Math.max(
    base,
    base +
      Math.round(
        view.forecast.leakedExpected * sizeFactor * (1 - canAct * recovered),
      ),
  );
  const outputs = { committed, base, stretch };
  return {
    ...outputs,
    delta: subtract(outputs, baseline),
    baseline,
    assumptions: {
      introsPerPartner,
      expectedColdAttempts,
      redirected,
      addedIntros,
      payRate: pay,
      paymentLag: lag,
      warmTimeChance: warmChance,
      coldTimeChance: coldChance,
    },
    contributions: {
      newOutreach,
      recovery,
      discountDelta,
      openDealChange: open - view.forecast.openExpected,
    },
  };
}

export function compareScenarios(
  view: Snapshot,
  scenarios: { id?: string; name: string; inputs: ScenarioInput }[],
) {
  if (scenarios.length > 3)
    throw new Error("Choose up to three scenarios to compare.");
  return scenarios.map(({ id, name, inputs }) => ({
    id,
    name,
    inputs,
    forecast: scenarioForecast(view, inputs),
  }));
}

export function workspaceProspects(
  season: Season,
  asOf: string,
  overlay: Partial<Prospect>[],
  connections: {
    prospectId: string;
    viaType: Connection["viaType"];
    viaName: string;
    ownerId: string;
    strength: number;
  }[] = [],
) {
  const items = new Map(
    seedProspects(season)
      .filter((p) => !p.createdAt || p.createdAt <= asOf)
      .map((p) => [p.id, p]),
  );
  for (const p of overlay) {
    if (!p.id || (p.createdAt && p.createdAt > asOf)) continue;
    const combined = { ...items.get(p.id), ...p };
    if (combined.name && combined.company)
      items.set(p.id, combined as Prospect);
  }
  for (const c of connections) {
    const p = items.get(c.prospectId);
    if (p)
      items.set(p.id, { ...p, connections: [...(p.connections ?? []), c] });
  }
  return [...items.values()];
}
