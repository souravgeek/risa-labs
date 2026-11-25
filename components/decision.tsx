"use client";
import React, { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  FileText,
  Phone,
  Plus,
  Save,
  Upload,
  UserRoundPlus,
} from "lucide-react";
import { useDesk, type R } from "./context";
import { Empty, Field, Panel, Sheet, Table, Tabs, Tag } from "./common";
import { niceDate, packagesSeed, pct, rupees, shortMoney } from "@/lib/shared";
import {
  compareScenarios,
  historicalIndustryRates,
  matchProspectCompany,
  routeProspect,
  scenarioControls,
  scenarioForecast,
  scoreProspect,
  workspaceProspects,
} from "@/lib/decision";
import type { Snapshot, ScenarioInput, Season } from "@/lib/metrics";

const snapshotOf = (d: R) => d as Snapshot;
const amount = (key: string, label: string) => ({
  key,
  label,
  render: (r: R) => rupees(r[key]),
});
const tone = (v: string) =>
  ({
    Scale: "green",
    Fix: "orange",
    Stop: "red",
    Observe: "muted",
    intro: "green",
    excluded: "red",
    cold: "blue",
    deferred: "orange",
  })[v] || "muted";
const actionButton = (label: string, onClick: () => void, disabled = false) => (
  <button type="button" className="btn" onClick={onClick} disabled={disabled}>
    {label}
  </button>
);
const orderedForecast = ["committed", "base", "stretch"] as const;
const title = (key: string) => key[0].toUpperCase() + key.slice(1);
function StatStrip({
  items,
}: {
  items: { label: string; value: string | number; detail?: string }[];
}) {
  return (
    <div className="growth-stats">
      {items.map((r) => (
        <div key={r.label}>
          <span>{r.label}</span>
          <strong>{r.value}</strong>
          {r.detail && <small>{r.detail}</small>}
        </div>
      ))}
    </div>
  );
}
function ExperienceStyle() {
  return (
    <style>{`
.growth-layout{display:grid;gap:18px;min-width:0}.growth-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:18px;align-items:start}.growth-body{padding:0 20px 20px}.growth-sub{font-size:.88rem;line-height:1.55;color:var(--muted-foreground,#58695e);margin:0 0 16px}.growth-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));border:1px solid #dbe4dc;border-radius:13px;background:#fff;overflow:hidden}.growth-stats>div{padding:18px 20px;border-right:1px solid #e4e9e4}.growth-stats>div:last-child{border:0}.growth-stats span,.growth-stats small{display:block;color:#57665c;font-size:.84rem}.growth-stats strong{display:block;font-size:1.6rem;margin:4px 0;font-variant-numeric:tabular-nums;letter-spacing:-.045em}.growth-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.growth-actions .btn{white-space:normal}.growth-form{display:grid;gap:14px}.growth-form textarea,.growth-layout textarea{min-height:115px;width:100%;padding:10px;border:1px solid #cbd7ce;border-radius:7px;font:inherit;resize:vertical}.growth-slider{display:grid;gap:4px;margin-bottom:13px}.growth-slider span{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.9rem}.growth-slider input{padding:0;border:0;accent-color:#226f4d;width:100%;height:20px}.growth-table-note{padding:8px 20px 18px;line-height:1.55;font-size:.85rem;color:#536258}.growth-stack{display:grid;gap:12px}.growth-result{padding:12px 0;border-bottom:1px solid #e4e9e4;display:flex;align-items:center;justify-content:space-between;gap:12px}.growth-result:last-child{border:0}.growth-result strong,.growth-result small{display:block}.growth-result small{margin-top:2px;color:#52665a}.growth-card-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.growth-card-list button{border:1px solid #d9e2da;border-radius:10px;background:#fff;padding:16px;text-align:left;color:inherit}.growth-card-list button[aria-pressed=true]{border-color:#226f4d;background:#ecf5ed}.growth-card-list small,.growth-card-list strong{display:block}.growth-card-list small{color:#536258;margin-top:5px}.growth-chooser{display:flex;align-items:center;gap:8px;padding:8px 0}.growth-chooser input[type=checkbox]{width:16px;height:16px}.growth-proposal{min-height:245px!important}.growth-error{color:#8c2b24;line-height:1.4}.growth-term{font-variant-numeric:tabular-nums}.growth-pill-button{border:1px solid #cdd9d0;border-radius:6px;background:#fff;padding:5px 9px;color:#1f6343;cursor:pointer}
@media(max-width:860px){.growth-grid{grid-template-columns:1fr}}@media(max-width:500px){.growth-stats>div{padding:12px}.growth-stats{grid-template-columns:1fr 1fr}.growth-stats strong{font-size:1.35rem}.growth-body{padding:0 12px 14px}}
`}</style>
  );
}
function ScenarioPlanner() {
  const { data, asOf, filters, act, busy } = useDesk(),
    view = snapshotOf(data),
    [input, setInput] = useState<ScenarioInput>({}),
    [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]);
  const saved = (data.extras.scenarios || []) as {
    id: string;
    name: string;
    inputs: ScenarioInput;
    createdAt: string;
  }[];
  const result = useMemo(() => scenarioForecast(view, input), [view, input]);
  const compared = useMemo(
    () =>
      compareScenarios(
        view,
        saved.filter((s) => ids.includes(s.id)).slice(0, 3),
      ),
    [view, saved, ids],
  );
  return (
    <div className="growth-layout">
      <div className="growth-grid">
        <Panel title="Scenario inputs" action={<Tag>Assumptions</Tag>}>
          <div className="growth-body">
            {scenarioControls.map((c) => {
              const value =
                input[c.key] ??
                (c.key === "paymentLag" ? view.forecast.paymentLag : 0);
              return (
                <label key={c.key} className="growth-slider">
                  <span>
                    {c.label}
                    <b>
                      {c.unit === "share" ? pct(value) : value + " " + c.unit}
                    </b>
                  </span>
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={value}
                    onChange={(e) =>
                      setInput({ ...input, [c.key]: Number(e.target.value) })
                    }
                  />
                </label>
              );
            })}
          </div>
        </Panel>
        <div className="growth-stack">
          <Panel title="Pre-festival cash forecast">
            <div className="growth-body">
              {orderedForecast.map((k) => (
                <div key={k} className="growth-result">
                  <div>
                    {title(k)}
                    <small>Baseline {rupees(result.baseline[k])}</small>
                  </div>
                  <div>
                    <strong>{rupees(result[k])}</strong>
                    <small>
                      {result.delta[k] > 0 ? "+" : ""}
                      {rupees(result.delta[k])} change
                    </small>
                  </div>
                </div>
              ))}
              <p className="growth-sub">
                Assumes {result.assumptions.introsPerPartner} introductions per
                new partner and {pct(result.assumptions.payRate)} on-time
                payment. Outreach uses the observed attempt rate through{" "}
                {niceDate(asOf)}.
              </p>
              <form
                className="growth-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await act({
                      kind: "scenario",
                      name,
                      inputs: input,
                      scope: filters,
                    })
                  )
                    setName("");
                }}
              >
                <Field label="Scenario name">
                  <input
                    required
                    maxLength={160}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Referral expansion"
                  />
                </Field>
                <div className="growth-actions">
                  <button className="btn primary" disabled={busy}>
                    <Save size={15} />
                    Save scenario
                  </button>
                  {actionButton("Reset", () => setInput({}))}
                </div>
              </form>
            </div>
          </Panel>
        </div>
      </div>
      <Panel title="Compare saved scenarios">
        <div className="growth-body">
          {!saved.length ? (
            <Empty text="Save a scenario to compare its forecast." />
          ) : (
            <>
              <p className="growth-sub">
                Choose up to three scenarios. Forecasts recalculate at the
                selected date.
              </p>
              {saved.map((s) => (
                <label key={s.id} className="growth-chooser">
                  <input
                    type="checkbox"
                    checked={ids.includes(s.id)}
                    disabled={!ids.includes(s.id) && ids.length === 3}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...ids, s.id]
                          : ids.filter((v) => v !== s.id),
                      )
                    }
                  />
                  {s.name} <small>· {niceDate(s.createdAt)}</small>
                </label>
              ))}
              {compared.length > 0 && (
                <Table
                  rows={compared.map((c) => ({ name: c.name, ...c.forecast }))}
                  columns={[
                    { key: "name", label: "Scenario" },
                    ...orderedForecast.map((k) => amount(k, title(k))),
                  ]}
                  search={false}
                />
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
export function DecisionPage() {
  const { data, asOf, act, busy, open, go, owner } = useDesk(),
    [tab, setTab] = useState("Money list"),
    [ownerOnly, setOwnerOnly] = useState(false);
  const m = snapshotOf(data);
  const money = ownerOnly
    ? m.moneyList.filter((r) => r.ownerId === owner).slice(0, 5)
    : m.moneyList;
  return (
    <section className="growth-layout">
      <ExperienceStyle />
      <Tabs
        items={[
          "Money list",
          "Campaign verdicts",
          "Scenarios",
          "Deadline cutoffs",
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Money list" && (
        <>
          <StatStrip
            items={[
              { label: "Base forecast", value: shortMoney(m.forecast.base) },
              {
                label: "Cash in open pipeline",
                value: shortMoney(m.forecast.openExpected),
                detail: "Probability-weighted",
              },
              {
                label: "Qualified without a deal",
                value: m.leakage[0]?.count ?? 0,
              },
            ]}
          />
          <Panel
            title="Expected cash opportunities"
            action={
              <select
                aria-label="Owner scope"
                value={ownerOnly ? "mine" : "all"}
                onChange={(e) => setOwnerOnly(e.target.value === "mine")}
              >
                <option value="all">All owners</option>
                <option value="mine">My top five</option>
              </select>
            }
          >
            <Table
              rows={money}
              columns={[
                {
                  key: "brand",
                  label: "Brand",
                  render: (r) => (
                    <button
                      className="text-link"
                      onClick={() =>
                        open({ kind: "brand", row: { id: r.brandId } })
                      }
                    >
                      {r.brand}
                    </button>
                  ),
                },
                { key: "detail", label: "Opportunity" },
                amount("expectedCash", "Expected cash"),
                { key: "owner", label: "Owner" },
                {
                  key: "action",
                  label: "Next step",
                  render: (r) => (
                    <div className="growth-actions">
                      {actionButton(
                        "Create task",
                        () =>
                          void act({
                            kind: "task",
                            title: "Follow up with " + r.brand,
                            brandId: r.brandId,
                            owner: r.ownerId,
                            due: asOf,
                            source: "alert",
                            linkedId: r.id,
                          }),
                        busy,
                      )}
                      {r.group === "warm" && (
                        <button
                          className="btn"
                          onClick={() =>
                            open({ kind: "call", row: { brandId: r.brandId } })
                          }
                        >
                          <Phone size={14} />
                          Call
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
              search="Find opportunity…"
            />
          </Panel>
        </>
      )}
      {tab === "Campaign verdicts" && (
        <Panel title="Campaign decisions">
          <Table
            rows={m.campaigns}
            columns={[
              { key: "name", label: "Campaign" },
              {
                key: "verdict",
                label: "Verdict",
                render: (r) => <Tag tone={tone(r.verdict)}>{r.verdict}</Tag>,
              },
              { key: "attempts", label: "Attempts" },
              {
                key: "positiveRate",
                label: "Positive",
                render: (r) => pct(r.positiveRate),
              },
              { key: "closed", label: "Closed deals" },
              {
                key: "winRate",
                label: "Win rate",
                render: (r) => (
                  <span>
                    {pct(r.winRate)} {r.directional && <Tag>Directional</Tag>}
                  </span>
                ),
              },
              {
                key: "evidence",
                label: "Evidence",
                render: (r) =>
                  actionButton("View evidence", () =>
                    open({
                      kind: "info",
                      title: r.name + " · " + r.verdict,
                      extra: {
                        text:
                          r.confirmed +
                          " confirmed from " +
                          r.closed +
                          " closed opportunities. " +
                          r.positive +
                          " of " +
                          r.attempts +
                          " attempts had a positive response. " +
                          (r.verdict === "Scale"
                            ? "Review if win rate drops below " +
                              pct(data.settings.scaleWinRate ?? 0.5) +
                              "."
                            : r.verdict === "Stop"
                              ? "Reconsider when positive reply rate reaches " +
                                pct(data.settings.positiveThreshold ?? 0.1) +
                                " or a deal confirms."
                              : "Review after new positive replies or wins."),
                      },
                    }),
                  ),
              },
            ]}
            search={false}
          />
          <div className="growth-table-note">
            Verdicts use originating-campaign associations and the current
            decision thresholds.{" "}
            <button className="text-link" onClick={() => go("Settings")}>
              View thresholds
            </button>
          </div>
        </Panel>
      )}
      {tab === "Scenarios" && <ScenarioPlanner />}
      {tab === "Deadline cutoffs" && (
        <Panel title="Last safe date to collect">
          <div className="growth-table-note">
            Each cutoff deducts historical time to confirmation and the{" "}
            {m.forecast.paymentLag}-day payment lag from festival day. Review
            later deals for post-festival or in-kind terms.
          </div>
          <Table
            rows={m.deals
              .filter((d) =>
                [
                  "prospecting",
                  "contacted",
                  "proposal_sent",
                  "negotiating",
                ].includes(d.stage),
              )
              .map((d) => ({
                ...d,
                terms: asOf > d.lastSafeDate ? "Review terms" : "In window",
              }))}
            columns={[
              { key: "brand", label: "Brand" },
              {
                key: "stage",
                label: "Stage",
                render: (r) => title(r.stage.replace(/_/g, " ")),
              },
              {
                key: "lastSafeDate",
                label: "Last safe date",
                render: (r) => niceDate(r.lastSafeDate, true),
              },
              {
                key: "terms",
                label: "Status",
                render: (r) => (
                  <Tag tone={r.terms === "In window" ? "green" : "orange"}>
                    {r.terms}
                  </Tag>
                ),
              },
              amount("proposedValue", "Deal value"),
            ]}
            onRow={(r) => open({ kind: "brand", row: { id: r.brandId } })}
          />
        </Panel>
      )}
    </section>
  );
}

function ProspectImport({ close }: { close: () => void }) {
  const { act, busy } = useDesk(),
    [mode, setMode] = useState("Manual"),
    [rows, setRows] = useState<R[]>([]),
    [error, setError] = useState(""),
    [manual, setManual] = useState<R>({ source: "Manual" }),
    [fileName, setFileName] = useState("");
  const required = ["name", "title", "company", "industry", "source"];
  async function parse(file?: File) {
    setError("");
    setRows([]);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 1024 * 1024) {
      setError("Choose a CSV under 1 MB.");
      return;
    }
    const parsed = Papa.parse<R>(await file.text(), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (parsed.errors.length) {
      setError(parsed.errors[0].message);
      return;
    }
    const missing = required.filter((h) => !parsed.meta.fields?.includes(h));
    if (missing.length) {
      setError("Missing columns: " + missing.join(", "));
      return;
    }
    if (!parsed.data.length || parsed.data.length > 1000) {
      setError("Choose a file with 1 to 1,000 contacts.");
      return;
    }
    const bad = parsed.data.findIndex((r) =>
      required.some((k) => !String(r[k] || "").trim()),
    );
    if (bad !== -1) {
      setError("Complete the required fields on CSV row " + (bad + 2) + ".");
      return;
    }
    setRows(parsed.data);
  }
  return (
    <Sheet title="Add prospects" close={close}>
      <div className="growth-form">
        <Tabs
          items={["Manual", "CSV import"]}
          value={mode}
          onChange={setMode}
        />
        <form
          className="growth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act({
                kind: "prospectImport",
                rows: mode === "Manual" ? [manual] : rows,
              })
            )
              close();
          }}
        >
          {mode === "Manual" ? (
            ["name", "title", "company", "industry", "city", "source"].map(
              (key) => (
                <Field
                  key={key}
                  label={title(key) + (key === "city" ? " (optional)" : "")}
                >
                  <input
                    required={key !== "city"}
                    value={manual[key] ?? ""}
                    maxLength={180}
                    onChange={(e) =>
                      setManual({ ...manual, [key]: e.target.value })
                    }
                  />
                </Field>
              ),
            )
          ) : (
            <>
              <p className="growth-sub">
                Import licensed, referred or manually researched contacts.
                Include name, title, company, industry and source. City is
                optional.
              </p>
              <Field label="CSV file">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void parse(e.target.files?.[0])}
                />
              </Field>
              {rows.length > 0 && (
                <>
                  <p className="growth-sub">
                    {fileName} · {rows.length} ready to import
                  </p>
                  <Table
                    rows={rows.slice(0, 3)}
                    search={false}
                    columns={[
                      { key: "name", label: "Contact" },
                      { key: "company", label: "Company" },
                      { key: "source", label: "Source" },
                    ]}
                  />
                </>
              )}
              {error && (
                <p role="alert" className="growth-error">
                  {error}
                </p>
              )}
            </>
          )}
          <div className="growth-actions">
            <button
              className="btn primary"
              disabled={busy || (mode === "CSV import" && !rows.length)}
            >
              <Upload size={15} />
              {mode === "Manual"
                ? "Add prospect"
                : "Import " + (rows.length || "") + " contacts"}
            </button>
            {actionButton("Cancel", close)}
          </div>
        </form>
      </div>
    </Sheet>
  );
}

export function ProspectsPage() {
  const { data, asOf, season, owner, act, busy } = useDesk(),
    view = snapshotOf(data),
    [scope, setScope] = useState("All prospects"),
    [importing, setImporting] = useState(false),
    [selected, setSelected] = useState(""),
    [match, setMatch] = useState(""),
    [referrer, setReferrer] = useState(""),
    [via, setVia] = useState("alumni");
  const contacts = useMemo(
    () =>
      workspaceProspects(
        season as Season,
        asOf,
        data.extras.prospects,
        data.extras.connections,
      ),
    [season, asOf, data.extras.prospects, data.extras.connections],
  );
  const scores = useMemo(
    () => data.decisionIndustryRates ?? historicalIndustryRates(view),
    [data.decisionIndustryRates, view],
  );
  const exclusiveSponsors = (data.extras.allocations as R[])
    .filter(
      (r) =>
        packagesSeed.find((p) => p.id === r.packageId)?.tier === "Exclusive",
    )
    .flatMap((r) => {
      const d = view.deals.find(
        (d) => d.id === r.dealId && d.stage === "partner_confirmed",
      );
      return d ? [{ company: d.brand, industry: d.industry }] : [];
    });
  const coldUsed = (data.extras.prospects as R[]).filter(
    (r) => r.coldQueuedAt === asOf,
  ).length;
  const ranked = contacts
    .map((p) => {
      const match = matchProspectCompany(p, view.brands);
      const b =
        match.kind === "existing"
          ? view.brands.find((b) => b.id === match.matches[0].id)
          : undefined;
      const scored = scoreProspect(p, {
        industryWinRates: scores,
        weights: {
          fit: data.settings.prospectFitWeight ?? 0.4,
          warmth: data.settings.prospectWarmthWeight ?? 0.4,
          timing: data.settings.prospectTimingWeight ?? 0.2,
        },
      });
      const resolved = {
        ...p,
        doNotContact: p.doNotContact || b?.doNotContact,
        status:
          match.kind === "review" && p.status === "new"
            ? ("review" as const)
            : p.status,
      };
      const route = routeProspect(resolved, {
        exclusiveSponsors,
        coldUsed,
        coldCap: data.settings.coldCap ?? 10,
      });
      return {
        ...p,
        ...scored,
        route: route.kind,
        reason: route.reason,
        match,
        matches: match.matches,
        linkedBrand: b,
        score: scored.score,
      };
    })
    .sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
  const active = ranked.find((p) => p.id === selected),
    warm = ranked.filter((p) => p.warmth > 0),
    qualified = ranked.filter(
      (p) =>
        p.status === "added" && p.linkedBrand?.qualification === "qualified",
    );
  const scopeRows =
    scope === "Warm paths"
      ? ranked.filter((p) => p.route === "intro")
      : scope === "Cold queue"
        ? ranked.filter(
            (p) =>
              p.route === "cold" ||
              p.status === "cold queued" ||
              p.route === "deferred",
          )
        : scope === "Review"
          ? ranked.filter((p) => p.route === "review" || p.route === "excluded")
          : scope === "Added"
            ? ranked.filter((p) => p.status === "added")
            : ranked;
  const added = ranked.filter((p) => p.status === "added");
  const sources = [...new Set(added.map((r) => r.source))].map((source) => {
    const n = added.filter((r) => r.source === source);
    return {
      source,
      added: n.length,
      qualified: qualified.filter((r) => r.source === source).length,
      rate: n.length
        ? qualified.filter((r) => r.source === source).length / n.length
        : 0,
    };
  });
  const leadTime = added.flatMap((row) => {
    if (!row.linkedBrand || !row.createdAt) return [];
    const touch = view.interactions.find(
      (e) =>
        e.brandId === row.linkedBrand?.id &&
        e.date.slice(0, 10) >= row.createdAt!,
    );
    return touch
      ? [
          Math.round(
            (Date.parse(touch.date.slice(0, 10)) - Date.parse(row.createdAt)) /
              86400000,
          ),
        ]
      : [];
  });
  const leaders = new Map<
    string,
    {
      name: string;
      intros: number;
      deals: number;
      cash: number;
      brandIds: Set<string>;
    }
  >();
  for (const c of data.extras.connections as R[]) {
    const entry = leaders.get(c.viaName) || {
      name: c.viaName,
      intros: 0,
      deals: 0,
      cash: 0,
      brandIds: new Set<string>(),
    };
    entry.intros++;
    const linked = ranked.find(
      (p) => p.id === c.prospectId && p.status === "added",
    )?.linkedBrand;
    if (linked && !entry.brandIds.has(linked.id)) {
      entry.brandIds.add(linked.id);
      const wins = view.deals.filter(
        (d) => d.brandId === linked.id && d.stage === "partner_confirmed",
      );
      entry.deals += wins.length;
      entry.cash += wins
        .filter((d) => d.supportType === "cash")
        .reduce((sum, d) => sum + d.confirmedValue, 0);
    }
    leaders.set(c.viaName, entry);
  }
  const routeLabel = (r: R) =>
    r.route === "intro"
      ? "Warm introduction"
      : r.route === "cold"
        ? "Cold test"
        : r.route === "complete"
          ? title(r.status)
          : title(r.route);
  return (
    <div className="growth-layout">
      <ExperienceStyle />
      <div className="section-controls">
        <Tabs
          items={[
            "All prospects",
            "Warm paths",
            "Cold queue",
            "Review",
            "Added",
            "Referrers",
          ]}
          value={scope}
          onChange={setScope}
        />
        <button className="btn primary" onClick={() => setImporting(true)}>
          <UserRoundPlus size={16} />
          Add prospects
        </button>
      </div>
      <StatStrip
        items={[
          { label: "Prospects", value: ranked.length },
          {
            label: "With a warm path",
            value: pct(warm.length / Math.max(1, ranked.length)),
            detail: warm.length + " contacts",
          },
          { label: "Added to pipeline", value: added.length },
          {
            label: "Daily cold queue",
            value: coldUsed + " / " + (data.settings.coldCap ?? 10),
          },
        ]}
      />
      {scope === "Referrers" ? (
        <Panel title="Referrer leaderboard">
          <Table
            rows={[...leaders.values()].sort(
              (a, b) => b.cash - a.cash || b.intros - a.intros,
            )}
            columns={[
              { key: "name", label: "Referrer" },
              { key: "intros", label: "Introductions" },
              { key: "deals", label: "Confirmed deals" },
              amount("cash", "Confirmed cash"),
            ]}
            search={false}
          />
          <p className="growth-table-note">
            Introductions logged in this workspace and their associated
            sponsors.
          </p>
        </Panel>
      ) : (
        <Panel
          title={scope === "All prospects" ? "Prospect directory" : scope}
          action={<Tag>{scopeRows.length} contacts</Tag>}
        >
          <Table
            rows={scopeRows}
            columns={[
              {
                key: "company",
                label: "Company",
                render: (r) => <b>{r.company}</b>,
              },
              { key: "name", label: "Contact" },
              { key: "industry", label: "Industry" },
              { key: "score", label: "Score" },
              {
                key: "route",
                label: "Outreach path",
                render: (r) => <Tag tone={tone(r.route)}>{routeLabel(r)}</Tag>,
              },
              { key: "source", label: "Source" },
            ]}
            search="Search prospects…"
            onRow={(r) => {
              setSelected(r.id);
              setMatch("");
              setReferrer("");
            }}
          />
        </Panel>
      )}
      {scope === "Added" && (
        <Panel title="Conversion by source">
          <Table
            rows={sources}
            columns={[
              { key: "source", label: "Source" },
              { key: "added", label: "Added" },
              { key: "qualified", label: "Qualified" },
              {
                key: "rate",
                label: "Qualification rate",
                render: (r) => pct(r.rate),
              },
            ]}
            search={false}
          />
          <p className="growth-table-note">
            Average time to first touch:{" "}
            {leadTime.length
              ? (leadTime.reduce((a, b) => a + b, 0) / leadTime.length).toFixed(
                  1,
                ) + " days"
              : "No recorded first touch"}
            .
          </p>
        </Panel>
      )}
      {active && (
        <Sheet title={active.company} close={() => setSelected("")}>
          <div className="growth-form">
            <div>
              <h3>{active.name}</h3>
              <p className="growth-sub">
                {active.title} · {active.city || active.industry} ·{" "}
                {active.source}
              </p>
              <Tag tone={tone(active.route)}>{routeLabel(active)}</Tag>
            </div>
            <StatStrip
              items={[
                { label: "Fit", value: active.fit },
                { label: "Warmth", value: active.warmth },
                { label: "Timing", value: active.timing },
              ]}
            />
            <p className="growth-sub">
              {active.reason}.{" "}
              {active.timingSignal ||
                "Timing uses a neutral assumption when no signal is available."}{" "}
              Industry fit is directional ({active.industrySampleSize} closed
              deals).
            </p>
            {active.match.kind === "existing" && (
              <p className="growth-sub">
                Existing brand match · {active.match.matches[0].name}
              </p>
            )}
            {active.match.kind === "review" && (
              <Field label="Resolve possible company match">
                <select
                  value={match}
                  onChange={(e) => setMatch(e.target.value)}
                >
                  <option value="">Choose a match</option>
                  {active.matches.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                  <option value="new">Create a separate brand</option>
                </select>
              </Field>
            )}
            <div className="growth-actions">
              {["intro", "cold"].includes(active.route) &&
                actionButton(
                  active.route === "intro"
                    ? "Request introduction"
                    : "Queue cold test",
                  () => void act({ kind: "prospectRoute", id: active.id }),
                  busy,
                )}
              {active.route !== "excluded" &&
                active.status !== "added" &&
                actionButton(
                  "Add to pipeline",
                  () =>
                    void act({
                      kind: "prospectAdd",
                      id: active.id,
                      ...(match === "new"
                        ? { createNew: true }
                        : match
                          ? { brandId: match }
                          : {}),
                    }),
                  busy || (active.match.kind === "review" && !match),
                )}
            </div>
            {active.status !== "added" && active.route !== "excluded" && (
              <form
                className="growth-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await act({
                      kind: "prospectIntro",
                      id: active.id,
                      viaName: referrer,
                      viaType: via,
                      owner,
                    })
                  )
                    setReferrer("");
                }}
              >
                <Field label="Referrer">
                  <input
                    placeholder="Who introduced this contact?"
                    required
                    value={referrer}
                    onChange={(e) => setReferrer(e.target.value)}
                  />
                </Field>
                <Field label="Connection type">
                  <select value={via} onChange={(e) => setVia(e.target.value)}>
                    {["alumni", "creator", "sponsor"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <button className="btn" disabled={busy}>
                  <Plus size={15} />
                  Log introduction
                </button>
              </form>
            )}
          </div>
        </Sheet>
      )}
      {importing && <ProspectImport close={() => setImporting(false)} />}
    </div>
  );
}

export function InventoryPage() {
  const { data, season, asOf, owner, act, busy } = useDesk(),
    view = snapshotOf(data),
    [tab, setTab] = useState("Packages"),
    [packageId, setPackageId] = useState("PK1"),
    [brandId, setBrandId] = useState(""),
    [proposal, setProposal] = useState(""),
    [mode, setMode] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const packs = packagesSeed.map((p) => {
      const sold = (data.extras.allocations as R[]).filter(
        (r) => r.packageId === p.id,
      ).length;
      return { ...p, sold, available: Math.max(0, p.quantity - sold) };
    }),
    pack = packs.find((p) => p.id === packageId)!;
  const isUpsell = tab === "Upsell",
    eligible = view.brands.filter(
      (b) =>
        !b.doNotContact &&
        (!isUpsell ||
          view.deals.some(
            (d) => d.brandId === b.id && d.stage === "partner_confirmed",
          )),
    );
  const drafts = (data.extras.proposals as R[]).filter(
    (r) => r.kind === "proposalDraft",
  );
  const requestId = useRef(0);
  function clear() {
    requestId.current++;
    setProposal("");
    setMode("");
    setError("");
    setLoading(false);
  }
  function switchTab(t: string) {
    clear();
    setTab(t);
    setBrandId("");
  }
  async function generate() {
    if (!brandId || !pack.available) return;
    const token = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season,
          asOf,
          owner,
          brandId,
          packageId,
          purpose: isUpsell ? "upsell" : "proposal",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not create a draft.");
      if (token === requestId.current) {
        setProposal(result.text);
        setMode(result.mode);
      }
    } catch (e) {
      if (token === requestId.current)
        setError(e instanceof Error ? e.message : "Draft creation failed.");
    } finally {
      if (token === requestId.current) setLoading(false);
    }
  }
  React.useEffect(() => {
    clear();
    setBrandId("");
  }, [season, asOf]);
  return (
    <div className="growth-layout">
      <ExperienceStyle />
      <Tabs
        items={["Packages", "Upsell", "Proposal drafts"]}
        value={tab}
        onChange={switchTab}
      />
      <StatStrip
        items={[
          { label: "Package tiers", value: packs.length },
          {
            label: "Available units",
            value: packs.reduce((n, p) => n + p.available, 0),
          },
          { label: "Sold units", value: packs.reduce((n, p) => n + p.sold, 0) },
          {
            label: "Unsold list value",
            value: shortMoney(
              packs.reduce((n, p) => n + p.available * p.price, 0),
            ),
            detail: "Assumed package pricing",
          },
        ]}
      />
      {tab === "Packages" ? (
        <Panel title="Sponsorship packages" action={<Tag>Assumed prices</Tag>}>
          <Table
            rows={packs}
            search={false}
            columns={[
              { key: "name", label: "Asset", render: (r) => <b>{r.name}</b> },
              { key: "tier", label: "Tier" },
              amount("price", "List price"),
              { key: "quantity", label: "Capacity" },
              { key: "sold", label: "Sold" },
              { key: "available", label: "Available" },
              {
                key: "offer",
                label: "Proposal",
                render: (r) =>
                  actionButton(
                    "Start draft",
                    () => {
                      setPackageId(r.id);
                      switchTab("Proposal drafts");
                    },
                    !r.available,
                  ),
              },
            ]}
          />
          <p className="growth-table-note">
            Quantity is reserved when a linked deal confirms. Inventory
            allocations in this workspace are tracked separately from historical
            activation records.
          </p>
        </Panel>
      ) : (
        <>
          <div className="growth-grid">
            <Panel
              title={isUpsell ? "Suggest an add-on" : "Prepare a proposal"}
            >
              <div className="growth-body growth-form">
                <Field label={isUpsell ? "Confirmed sponsor" : "Sponsor"}>
                  <select
                    value={brandId}
                    onChange={(e) => {
                      clear();
                      setBrandId(e.target.value);
                    }}
                  >
                    <option value="">Choose a brand</option>
                    {eligible.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} · {b.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Available package">
                  <select
                    value={packageId}
                    onChange={(e) => {
                      clear();
                      setPackageId(e.target.value);
                    }}
                  >
                    {packs.map((p) => (
                      <option value={p.id} key={p.id} disabled={!p.available}>
                        {p.name} · {rupees(p.price)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="growth-result">
                  <span>{pack.tier} tier</span>
                  <Tag>{pack.available} available</Tag>
                </div>
                <button
                  className="btn primary"
                  disabled={!brandId || !pack.available || loading}
                  onClick={() => void generate()}
                >
                  <FileText size={15} />
                  {loading
                    ? "Preparing…"
                    : isUpsell
                      ? "Generate suggestion"
                      : "Generate draft"}
                </button>
                {error && (
                  <p role="alert" className="growth-error">
                    {error}
                  </p>
                )}
              </div>
            </Panel>
            <Panel
              title={isUpsell ? "Review suggestion" : "Draft editor"}
              action={mode && <Tag>{mode}</Tag>}
            >
              {proposal ? (
                <div className="growth-body growth-form">
                  <Field label="Editable draft">
                    <textarea
                      className="growth-proposal"
                      value={proposal}
                      onChange={(e) => setProposal(e.target.value)}
                    />
                  </Field>
                  <div className="growth-actions">
                    {actionButton(
                      isUpsell ? "Accept and open deal" : "Save draft",
                      async () => {
                        if (
                          await act(
                            isUpsell
                              ? { kind: "upsellDeal", brandId, packageId }
                              : {
                                  kind: "saveDraft",
                                  brandId,
                                  packageId,
                                  text: proposal,
                                },
                          )
                        ) {
                          setProposal("");
                          setMode("");
                        }
                      },
                      busy || !proposal.trim(),
                    )}
                    {actionButton("Download text", () => {
                      const url = URL.createObjectURL(
                        new Blob([proposal], {
                          type: "text/plain;charset=utf-8",
                        }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "campusfest-proposal.txt";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })}
                  </div>
                </div>
              ) : (
                <Empty text="Choose a sponsor and package to prepare a draft for review." />
              )}
            </Panel>
          </div>
          {!isUpsell && (
            <Panel title="Saved drafts">
              <Table
                rows={drafts.map((d) => ({
                  ...d,
                  brand:
                    view.brands.find((b) => b.id === d.brandId)?.name ||
                    d.brandId,
                  pack:
                    packs.find((p) => p.id === d.packageId)?.name ||
                    d.packageId,
                }))}
                columns={[
                  { key: "brand", label: "Sponsor" },
                  { key: "pack", label: "Package" },
                  {
                    key: "createdAt",
                    label: "Created",
                    render: (r) => niceDate(r.createdAt, true),
                  },
                  {
                    key: "copy",
                    label: "Draft",
                    render: (r) =>
                      actionButton("Open draft", () => {
                        setBrandId(r.brandId);
                        setPackageId(r.packageId);
                        setProposal(r.text);
                        setMode("Saved draft");
                      }),
                  },
                ]}
                search={false}
              />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
