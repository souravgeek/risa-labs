"use client";
import { useEffect, useState } from "react";
import { ListPlus, CalendarDays } from "lucide-react";
import { useDesk, type R } from "./context";
import { Empty, Panel, Table, Tabs, Tag, type Col } from "./common";
import {
  niceDate,
  dateAdd,
  pct,
  rupees,
  shortMoney,
  title,
} from "@/lib/shared";

const tabs = [
  "Stalled deals",
  "Leakage",
  "Scorecard",
  "Workload",
  "Bottlenecks",
  "What changed",
];
const amount = (key: string, label: string): Col => ({
  key,
  label,
  render: (r) => rupees(r[key]),
});
const percent = (key: string, label: string): Col => ({
  key,
  label,
  render: (r) => pct(r[key]),
});
const brand: Col = {
  key: "brand",
  label: "Brand",
  render: (r) => <strong>{r.brand}</strong>,
};
const owner: Col = { key: "owner", label: "Owner" };
const tone = (v: string) =>
  ({ Scale: "green", Fix: "orange", Stop: "red" })[v] ?? "muted";

function StatRow({ items }: { items: [string, string | number][] }) {
  return (
    <div className="diag-stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
function BulkTasks({ rule, rows }: { rule: string; rows: R[] }) {
  const { act, busy } = useDesk();
  return (
    <button
      type="button"
      className="btn"
      disabled={!rows.length || busy}
      onClick={() =>
        act({ kind: "alertTasks", rule, ids: rows.map((r) => r.id) })
      }
    >
      <ListPlus size={15} />
      Create follow-up tasks
    </button>
  );
}
function Stalled() {
  const { data, open } = useDesk(),
    rows: R[] = data.stalled;
  return (
    <Panel
      title="Stalled deals"
      action={<BulkTasks rule="stalled" rows={rows} />}
    >
      <StatRow
        items={[
          ["Open deals stalled", rows.length],
          [
            "Proposed value at risk",
            shortMoney(rows.reduce((n, r) => n + r.value, 0)),
          ],
          [
            "Longest in stage",
            rows.length
              ? Math.max(...rows.map((r) => r.daysInStage)) + " days"
              : "—",
          ],
        ]}
      />
      <Table
        rows={rows}
        columns={[
          brand,
          { key: "stage", label: "Stage", render: (r) => title(r.stage) },
          amount("value", "Value at risk"),
          {
            key: "daysInStage",
            label: "Days in stage",
            render: (r) => <Tag tone="orange">{r.daysInStage} days</Tag>,
          },
          {
            key: "threshold",
            label: "Threshold",
            render: (r) => r.threshold + " days",
          },
          owner,
        ]}
        search="Search stalled deals"
        onRow={(r) => open({ kind: "brand", row: { id: r.brandId } })}
      />
    </Panel>
  );
}
function Leakage() {
  const { data, open } = useDesk(),
    rules: R[] = data.leakage;
  const [selected, select] = useState("qualified_no_deal"),
    rule = rules.find((r) => r.key === selected) ?? rules[0];
  if (!rule) return <Empty />;
  return (
    <div className="diag-stack">
      <Panel title="Leakage detector">
        <div className="diag-rules">
          {rules.map((r) => (
            <button
              type="button"
              className={r.key === rule.key ? "chosen" : ""}
              key={r.key}
              aria-pressed={rule.key === r.key}
              onClick={() => select(r.key)}
            >
              <strong>{r.count}</strong>
              <span>{r.label}</span>
              <small>{shortMoney(r.value)} at stake</small>
            </button>
          ))}
        </div>
      </Panel>
      <Panel
        title={rule.label}
        action={<BulkTasks rule={rule.key} rows={rule.records} />}
      >
        <Table
          rows={rule.records}
          columns={[
            brand,
            { key: "detail", label: "Evidence" },
            amount("value", "Estimated value"),
            owner,
          ]}
          onRow={(r) => open({ kind: "brand", row: { id: r.brandId } })}
          search="Search affected records"
        />
      </Panel>
    </div>
  );
}
function Scorecard() {
  const { data, open } = useDesk();
  return (
    <Panel title="Campaign scorecard" action={<Tag>Originating campaign</Tag>}>
      <p className="diag-description">
        Results show association with the originating campaign. ROI uses the
        campaign budget shown in the manager.
      </p>
      <Table
        rows={data.campaigns}
        columns={[
          { key: "name", label: "Campaign", render: (r) => <b>{r.name}</b> },
          {
            key: "verdict",
            label: "Verdict",
            render: (r) => <Tag tone={tone(r.verdict)}>{r.verdict}</Tag>,
          },
          { key: "attempts", label: "Attempts" },
          { key: "brands", label: "Brands" },
          percent("replyRate", "Reply"),
          percent("positiveRate", "Positive"),
          percent("meetingRate", "Meeting"),
          percent("qualifiedRate", "Qualified"),
          {
            key: "winRate",
            label: "Win rate",
            render: (r) => (
              <span title={r.closed + " closed deals"}>
                {pct(r.winRate)}
                {r.directional ? " · directional" : ""}
              </span>
            ),
          },
          amount("confirmedValue", "Confirmed"),
          amount("per100", "₹ / 100 attempts"),
          {
            key: "roi",
            label: "ROI",
            render: (r) =>
              r.roi == null
                ? "No budget"
                : pct(r.roi) + " · " + r.budgetProvenance,
          },
        ]}
        onRow={(row) => open({ kind: "campaign", row })}
        search="Search campaigns"
      />
    </Panel>
  );
}
function Workload() {
  const { data, asOf, open } = useDesk();
  const rows: R[] = data.owners.map((o: R) => ({
    ...o,
    overdue: data.extras.tasks.filter(
      (t: R) => t.owner === o.id && t.status !== "Done" && t.due < asOf,
    ).length,
  }));
  return (
    <Panel title="Owner workload" action={<Tag>Capacity assumed</Tag>}>
      <Table
        rows={rows}
        columns={[
          { key: "name", label: "Owner", render: (r) => <b>{r.name}</b> },
          { key: "brands", label: "Brands" },
          { key: "open", label: "Open deals" },
          { key: "stalled", label: "Stalled" },
          { key: "overdue", label: "Overdue tasks" },
          {
            key: "capacity",
            label: "Weekly capacity",
            render: (r) => r.capacity + " h",
          },
        ]}
        search={false}
        onRow={(r) =>
          open({
            kind: "records",
            title: r.name + " · assigned brands",
            rows: data.brands.filter((b: R) => b.ownerId === r.id),
          })
        }
      />
    </Panel>
  );
}
function useMetric<T>(key: string, from?: string) {
  const { season, asOf, filters, data } = useDesk();
  const [state, set] = useState<{ key: string; result?: T; error?: string }>({
    key: "",
  });
  const query = new URLSearchParams({
    season,
    asOf,
    ...filters,
    ...(from ? { from } : {}),
  }).toString();
  const path = "/api/metrics/" + key + "?" + query;
  useEffect(() => {
    const controller = new AbortController();
    fetch(path, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load these metrics.");
        set({ key: path, result: body.result ?? body.data ?? body });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          set({
            key: path,
            error:
              e instanceof Error ? e.message : "Unable to load these metrics.",
          });
      });
    return () => controller.abort();
  }, [path, data]);
  return state.key === path ? state : { key: path };
}
function Bottlenecks() {
  const { data, open } = useDesk(),
    { result: rows, error } = useMetric<R[]>("bottlenecks");
  return (
    <Panel
      title="Funnel bottlenecks"
      action={<Tag>Warm-channel benchmark</Tag>}
    >
      <p className="diag-description">
        The three largest conversion gaps ranked by estimated cash at stake.
        Estimates use entrants, the conversion gap, average cash deal value and
        downstream win rate.
      </p>
      {error ? (
        <p className="diag-description" role="alert">
          {error}
        </p>
      ) : !rows ? (
        <p className="diag-description" role="status">
          Loading conversion gaps…
        </p>
      ) : !rows.length ? (
        <Empty text="No measurable conversion gap at this snapshot." />
      ) : (
        <Table
          rows={rows}
          columns={[
            {
              key: "label",
              label: "Funnel step",
              render: (r) => <b>{r.label}</b>,
            },
            { key: "entering", label: "Entrants" },
            percent("actualRate", "Actual"),
            percent("benchmarkRate", "Warm benchmark"),
            amount("lostCash", "Estimated cash gap"),
            {
              key: "benchmarkSample",
              label: "Benchmark sample",
              render: (r) =>
                r.benchmarkSample + (r.directional ? " · directional" : ""),
            },
          ]}
          search={false}
          onRow={(r) => {
            const ids = new Set(
              data.funnel.find((s: R) => s.key === r.key)?.brandIds ?? [],
            );
            open({
              kind: "records",
              title: r.label,
              rows: data.brands.filter((b: R) => ids.has(b.id)),
            });
          }}
        />
      )}
    </Panel>
  );
}
const changesTabs = [
  "Confirmations",
  "Stage moves",
  "Dormant brands",
  "New leaks",
  "Forecast",
];
function Comparison({ from }: { from: string }) {
  const { open } = useDesk(),
    { result, error } = useMetric<R>("what_changed", from),
    [tab, setTab] = useState(changesTabs[0]);
  if (error)
    return (
      <p className="diag-description" role="alert">
        {error}
      </p>
    );
  if (!result)
    return (
      <p className="diag-description" role="status">
        Comparing snapshots…
      </p>
    );
  const {
    newConfirmations = [],
    stageMoves = [],
    newlyDormant = [],
    newLeaks = [],
    causes = {},
    forecastChange = {},
  } = result;
  const datasets: Record<string, { rows: R[]; cols: Col[] }> = {
    Confirmations: {
      rows: newConfirmations,
      cols: [brand, amount("confirmedValue", "Confirmed value"), owner],
    },
    "Stage moves": {
      rows: stageMoves,
      cols: [
        brand,
        { key: "from", label: "Previous", render: (r) => title(r.from) },
        { key: "to", label: "Current", render: (r) => title(r.to) },
        { key: "at", label: "Changed", render: (r) => niceDate(r.at) },
      ],
    },
    "Dormant brands": {
      rows: newlyDormant,
      cols: [
        { key: "name", label: "Brand" },
        owner,
        {
          key: "qualificationAt",
          label: "Changed",
          render: (r) => niceDate(r.qualificationAt),
        },
      ],
    },
    "New leaks": {
      rows: newLeaks,
      cols: [
        brand,
        { key: "label", label: "Rule" },
        amount("value", "Estimated value"),
        owner,
      ],
    },
    Forecast: {
      rows: Object.entries(causes).map(([key, value]) => ({
        label:
          {
            newDeals: "New deals",
            stageMoves: "Stage moves",
            losses: "Losses",
            payments: "Collections and invoices",
            timingAndModel: "Time and probability changes",
          }[key] ?? key,
        value,
      })),
      cols: [
        { key: "label", label: "Change in base forecast" },
        amount("value", "Contribution"),
      ],
    },
  };
  const selected = datasets[tab];
  return (
    <>
      <StatRow
        items={[
          ["New confirmations", newConfirmations.length],
          ["Stage moves", stageMoves.length],
          ["Base forecast change", rupees(forecastChange.base)],
        ]}
      />
      <div className="diag-subtabs">
        <Tabs items={changesTabs} value={tab} onChange={setTab} />
      </div>
      <Table
        rows={selected.rows}
        columns={selected.cols}
        search={false}
        onRow={
          tab === "Forecast"
            ? undefined
            : (r) => open({ kind: "brand", row: { id: r.brandId ?? r.id } })
        }
      />
    </>
  );
}
function Changes() {
  const { asOf, season } = useDesk();
  const defaultFrom = [season + "-01-01", dateAdd(asOf, -7)].sort()[1];
  const [start, setStart] = useState(defaultFrom);
  const from = start <= asOf && start.startsWith(season) ? start : defaultFrom;
  return (
    <Panel
      title="What changed"
      action={
        <label className="diag-date">
          <CalendarDays size={15} />
          <span>Compare from</span>
          <input
            aria-label="Compare from"
            type="date"
            min={season + "-01-01"}
            max={asOf}
            value={from}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
      }
    >
      <Comparison from={from} />
    </Panel>
  );
}
export function Diagnosis() {
  const { tab, go } = useDesk(),
    active = tabs.includes(tab) ? tab : "Stalled deals";
  return (
    <div className="diag-stack">
      <style>{`
.diag-stack{display:grid;gap:20px;min-width:0}.diag-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-block:1px solid var(--border,#e2e6df);margin:4px 0 8px}.diag-stats>div{padding:18px 22px;display:grid;gap:4px}.diag-stats>div+div{border-left:1px solid var(--border,#e2e6df)}.diag-stats span,.diag-description,.diag-rules small{color:var(--muted-foreground,#5c665d);font-size:.87rem}.diag-stats strong{font-size:clamp(1.25rem,2.1vw,2.05rem);letter-spacing:-.04em;line-height:1.2}.diag-description{margin:0 22px 18px;max-width:84ch}.diag-rules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 20px 18px}.diag-rules button{border:1px solid var(--border,#dbe2dc);border-radius:8px;background:transparent;text-align:left;display:grid;padding:13px;gap:4px}.diag-rules button.chosen{border-color:#477357;background:#eff6ed}.diag-rules button strong{font-size:1.45rem;line-height:1.1}.diag-rules button span{font-weight:580;font-size:.9rem}.diag-date{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:.85rem}.diag-date input{font:inherit;border:1px solid var(--border,#dbe2dc);border-radius:6px;padding:4px 6px;background:white}.diag-subtabs{padding:0 18px 12px}.diag-stack>.section-controls{margin:0}.diag-stack .tabs{max-width:100%;overflow:auto}.diag-stack .tabs button{flex-shrink:0}@media(max-width:680px){.diag-rules{grid-template-columns:repeat(2,minmax(0,1fr));padding-inline:12px}.diag-stats>div{padding:12px 8px}.diag-description{margin-inline:14px}.diag-stats span{font-size:.77rem}.diag-stack .panel-head{flex-wrap:wrap;gap:8px}.diag-date svg{display:none}}
`}</style>
      <div className="section-controls">
        <Tabs
          items={tabs}
          value={active}
          onChange={(v) => go("Diagnosis", v)}
        />
      </div>
      {active === "Leakage" ? (
        <Leakage />
      ) : active === "Scorecard" ? (
        <Scorecard />
      ) : active === "Workload" ? (
        <Workload />
      ) : active === "Bottlenecks" ? (
        <Bottlenecks />
      ) : active === "What changed" ? (
        <Changes />
      ) : (
        <Stalled />
      )}
    </div>
  );
}
