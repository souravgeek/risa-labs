"use client";
import React,{useEffect,useState} from "react";
import {PlayCircle,Lightbulb,Boxes,Calculator,ListOrdered,Bot,PhoneCall,Workflow,ShieldCheck,TriangleAlert,ArrowRight,FlaskConical} from "lucide-react";
import {Panel,Tag} from "./common";
import {useDesk} from "./context";
import {rupees,pct,niceDate} from "@/lib/shared";
import {scoreProspect} from "@/lib/decision";
import "./product-guide.css";

/**
 * Walkthrough video. Paste a Google Drive share link here (the file must be shared as
 * "Anyone with the link can view"), or set NEXT_PUBLIC_GUIDE_VIDEO_URL in the host's environment.
 */
const GUIDE_VIDEO_URL = process.env.NEXT_PUBLIC_GUIDE_VIDEO_URL || "https://drive.google.com/file/d/15arxuZr2sBe_zOEF2IFFUa8CssPOwB1S/view?usp=sharing";

/** Turns any Google Drive share link into its embeddable /preview URL. Other URLs pass through. */
export function videoEmbedUrl(url:string){
 const id=url.match(/\/file\/d\/([\w-]+)/)?.[1]||url.match(/[?&]id=([\w-]+)/)?.[1];
 return id?`https://drive.google.com/file/d/${id}/preview`:url;
}

const SECTIONS=[
 {id:"video",label:"Walkthrough video",icon:PlayCircle},
 {id:"why",label:"Why it exists",icon:Lightbulb},
 {id:"build",label:"How it's built",icon:Boxes},
 {id:"logic",label:"The logic",icon:Calculator},
 {id:"priority",label:"Prioritization",icon:ListOrdered},
 {id:"copilot",label:"Copilot",icon:Bot},
 {id:"calls",label:"Call agent",icon:PhoneCall},
 {id:"automation",label:"Automations",icon:Workflow},
 {id:"honesty",label:"Data honesty",icon:ShieldCheck},
 {id:"limits",label:"Limitations",icon:TriangleAlert},
] as const;

export function ProductGuide(){
 const [active,setActive]=useState<string>("video");
 useEffect(()=>{
  const els=SECTIONS.map(s=>document.getElementById("guide-"+s.id)).filter(Boolean) as HTMLElement[];
  const io=new IntersectionObserver(es=>{const top=es.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(top)setActive(top.target.id.slice(6))},{rootMargin:"-15% 0px -70% 0px"});
  els.forEach(e=>io.observe(e));return ()=>io.disconnect();
 },[]);
 const jump=(id:string)=>document.getElementById("guide-"+id)?.scrollIntoView({behavior:"smooth",block:"start"});
 return <div className="guide">
  <aside className="guide-toc" aria-label="Guide sections">
   <p className="guide-sandbox-note"><FlaskConical size={14}/>Sandbox: nothing here changes your workspace.</p>
   {SECTIONS.map(s=><button key={s.id} className={active===s.id?"on":""} aria-current={active===s.id?"true":undefined} onClick={()=>jump(s.id)}><s.icon size={15}/>{s.label}</button>)}
  </aside>
  <div className="guide-body">
   <VideoSection/><WhySection/><BuildSection/><LogicSection/><PrioritySection/><CopilotSection/><CallsSection/><AutomationSection/><HonestySection/><LimitsSection/>
  </div>
 </div>;
}

function Section({id,kicker,title,children}:{id:string;kicker:string;title:string;children:React.ReactNode}){
 return <section id={"guide-"+id} className="guide-section"><Panel kicker={kicker} title={title}><div className="guide-content">{children}</div></Panel></section>;
}
function Why({children}:{children:React.ReactNode}){return <p className="guide-why"><b>Why:</b> {children}</p>}
function Live({children}:{children:React.ReactNode}){return <span className="guide-live" title="Live value from the current workspace snapshot">{children}</span>}

function VideoSection(){
 const src=GUIDE_VIDEO_URL?videoEmbedUrl(GUIDE_VIDEO_URL):"";
 return <Section id="video" kicker="Start here" title="Walkthrough video">
  {src?<div className="guide-video"><iframe src={src} title="Unmaad Growth Center walkthrough" allow="autoplay; fullscreen" allowFullScreen loading="lazy"/></div>
  :<div className="guide-video empty-video"><PlayCircle size={34}/><b>Walkthrough video coming soon</b><small>Add the Google Drive link in <code>components/product-guide.tsx</code> or as <code>NEXT_PUBLIC_GUIDE_VIDEO_URL</code>. Share the file as "Anyone with the link can view".</small></div>}
  <p>The video walks through both demo workflows: from a copilot insight to confirmed actions, and a call with the AI call agent from brief to reviewed insight.</p>
 </Section>;
}

function WhySection(){
 const {data:d}=useDesk();
 return <Section id="why" kicker="The problem" title="Why this app exists">
  <p>Unmaad, IIM Bangalore's cultural fest, raises its budget from sponsors. In the 2025 records the team worked hard but blind: no single view of cash, no way to see which deals had frozen, and no record of which channels actually worked.</p>
  <div className="guide-callout"><b>North Star: cash collected before the festival.</b> Tracked as confirmed → invoiced → collected. In-kind value is shown separately and never counted as cash, because a festival can't pay vendors with product samples.</div>
  <p>Right now, for {d.season==="2025"?"the 2025 history":"Unmaad 2027"} as of <Live>{niceDate(d.asOf,true)}</Live>: <Live>{rupees(d.cash.collected)}</Live> collected of a <Live>{rupees(d.targets.cash)}</Live> target, <Live>{d.counts.confirmed} / {d.targets.confirmed}</Live> deals confirmed, <Live>{d.daysLeft}</Live> days to the festival.</p>
  <h3>What the 2025 data showed, and what each finding became</h3>
  <table className="guide-table"><thead><tr><th>Finding</th><th>Feature it drove</th></tr></thead><tbody>
   <tr><td>Warm channels won every deal: 48 attempts → 24 deals. Cold: 321 attempts → 0</td><td>Campaign scorecard, scale/fix/stop verdicts, warm-intro engine</td></tr>
   <tr><td>26 cold deals (₹14.4L) froze for 12–80 days instead of being closed</td><td>Stalled-deal alerts, call agent check-ins</td></tr>
   <tr><td>18 qualified brands never got a deal</td><td>Leakage detector, money list</td></tr>
   <tr><td>About 165 second and third cold touches, 0 positive replies</td><td>Third-cold-touch warning</td></tr>
   <tr><td>No invoice or payment data at all</td><td>Collections tracker on a simulated ledger</td></tr>
   <tr><td>One owner held 126 of 180 brands</td><td>Owner workload view</td></tr>
  </tbody></table>
 </Section>;
}

function BuildSection(){
 const flow=[["Sponsor workbook","Imported unchanged; IDs kept"],["Append-only event log","SQLite locally, Supabase when hosted"],["Metrics engine","snapshot(asOf, filters)"],["Every surface","Dashboard · Copilot · Call agent · Tests"]];
 return <Section id="build" kicker="Architecture" title="How it's built">
  <div className="guide-flow">{flow.map(([t,s],i)=><React.Fragment key={t}>{i>0&&<ArrowRight size={16} className="guide-flow-arrow"/>}<div><b>{t}</b><small>{s}</small></div></React.Fragment>)}</div>
  <h3>Design decisions, and the reasons for them</h3>
  <dl className="guide-decisions">
   <dt>One metrics engine for everything</dt><dd>The dashboard, copilot, call brief, tests and eval runner all call <code>lib/metrics.ts</code>. <Why>if the copilot computed its own numbers, it would eventually disagree with the dashboard, and nobody would trust either.</Why></dd>
   <dt>Every view has an as-of date</dt><dd>Pick any date and the whole app rebuilds as it looked then; nothing dated later leaks in. <Why>it lets the team replay 2025 honestly and ask "what did we know on 20 March?", which is how the findings above were checked.</Why></dd>
   <dt>Append-only history</dt><dd>Every change is a new event; earlier snapshots never change. <Why>audits and "what changed since last week" come for free, and a bad edit can't rewrite the past.</Why></dd>
   <dt>Runs fully offline with no keys</dt><dd>Without a Gemini key the copilot uses a deterministic local engine over the same tools, and the call agent runs scripted calls. <Why>a demo or a reviewer should never be blocked by a missing key or a rate limit.</Why></dd>
   <dt>AI proposes, a person confirms</dt><dd>Every write from the copilot or call agent goes through a preview card. <Why>sponsorship is relationship work; an unreviewed AI change to a deal or a promise to a sponsor costs more than the minute it saves.</Why></dd>
   <dt>Every number is tagged</dt><dd>Source, simulated or assumption, on every tile. <Why>the cash ledger is simulated; a reader must be able to tell a workbook fact from a modelled one at a glance.</Why></dd>
  </dl>
  <p className="guide-stack"><b>Stack:</b> Next.js 16 and React 19 with TypeScript · Gemini via <code>@google/genai</code> (server only; the key never reaches the browser) · Supabase Postgres or local SQLite · Recharts, TanStack Table, dnd-kit · Vitest and an eval runner.</p>
 </Section>;
}

function LogicSection(){
 const {data:d}=useDesk();
 return <Section id="logic" kicker="Calculations" title="The logic behind the numbers">
  <h3>As-of rules</h3>
  <ul>
   <li>The cutoff is the selected date at 23:59:59 IST.</li>
   <li>Records count only if created on or before the cutoff; interactions only if they happened by then.</li>
   <li>For anything with history (deal stage, qualification, targets) the engine takes the latest version on or before the cutoff. Versions are never added together.</li>
  </ul>
  <h3>Funnel</h3>
  <p>Contacted → responded → meeting held → qualified → deal → proposal → confirmed. Each step counts distinct brands, so one brand emailed five times is still one contact.</p>
  <h3>Forecast</h3>
  <pre className="guide-formula">{"P_win = (wins + 1) / (closed + 2)        per stage and channel group\nE     = value × cash? × P_win × P_time × P_pay"}</pre>
  <ul>
   <li><b>P_win</b> is Laplace-smoothed so a stage with 1 win in 1 deal reads 67%, not 100%. <Why>small samples otherwise produce wild forecasts.</Why></li>
   <li><b>P_time</b> is the share of past wins from that stage that closed in time to be paid before the fest.</li>
   <li><b>P_pay</b> is the on-time payment rate (<Live>{pct(d.forecast.payRate)}</Live> in Settings).</li>
  </ul>
  <div className="guide-levels">
   <div><small>Committed</small><b><Live>{rupees(d.forecast.committed)}</Live></b><span>Collected + unpaid pre-fest invoices × P_pay</span></div>
   <div><small>Base</small><b><Live>{rupees(d.forecast.base)}</Live></b><span>Committed + Σ E over open deals</span></div>
   <div><small>Stretch</small><b><Live>{rupees(d.forecast.stretch)}</Live></b><span>Base + leaked qualified brands × group win rate × average deal</span></div>
  </div>
  <ForecastSandbox payRate={d.forecast.payRate}/>
  <h3>Other rules</h3>
  <ul>
   <li><b>Stalled:</b> days in stage &gt; max(7, 2 × the median days won deals spent in that stage). Right now <Live>{d.stalled.length}</Live> deals are stalled. <Why>a fixed "14 days" would flag healthy negotiations and miss slow-moving early stages.</Why></li>
   <li><b>Pacing:</b> deals needed per week = (target − confirmed) ÷ weeks left: <Live>{d.pacing.neededPerWeek.toFixed(1)}</Live> a week now.</li>
   <li><b>Scale / fix / stop:</b> Stop = 40+ attempts, 0 confirmed and under 10% positive replies. Fix = 0 confirmed but 10%+ positive. Scale = 50%+ win rate on 5+ closed deals.</li>
   <li><b>Small samples:</b> any segment under 10 records is labelled <i>directional</i>.</li>
  </ul>
 </Section>;
}

function Slider({label,value,set,min,max,step=1,fmt=(v:number)=>String(v)}:{label:string;value:number;set:(v:number)=>void;min:number;max:number;step?:number;fmt?:(v:number)=>string}){
 return <label className="guide-slider"><span>{label}<b>{fmt(value)}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>set(Number(e.target.value))}/></label>;
}

function ForecastSandbox({payRate}:{payRate:number}){
 const [value,setValue]=useState(100000),[wins,setWins]=useState(8),[closed,setClosed]=useState(14),[time,setTime]=useState(.8),[pay,setPay]=useState(payRate),[cash,setCash]=useState(true);
 const closedN=Math.max(closed,wins),pWin=(wins+1)/(closedN+2),e=Math.round(value*(cash?1:0)*pWin*time*pay);
 return <div className="guide-sandbox">
  <div className="guide-sandbox-head"><FlaskConical size={16}/><b>Try it: one deal's expected cash</b><Tag tone="purple">Sandbox</Tag></div>
  <div className="guide-sandbox-grid">
   <div>
    <Slider label="Proposed value" value={value} set={setValue} min={10000} max={500000} step={5000} fmt={rupees}/>
    <Slider label="Past wins from this stage" value={wins} set={v=>{setWins(v);if(v>closed)setClosed(v)}} min={0} max={30}/>
    <Slider label="Past closed deals from this stage" value={closedN} set={setClosed} min={wins} max={40}/>
    <Slider label="P_time: share closed in time" value={time} set={setTime} min={0} max={1} step={.05} fmt={pct}/>
    <Slider label="P_pay: on-time payment rate" value={pay} set={setPay} min={0} max={1} step={.05} fmt={pct}/>
    <label className="guide-check"><input type="checkbox" checked={cash} onChange={e=>setCash(e.target.checked)}/>Cash deal (untick for in-kind)</label>
   </div>
   <div className="guide-result">
    <small>P_win = ({wins} + 1) / ({closedN} + 2)</small><b>{pct(pWin)}</b>
    <small>Expected cash before the fest</small><strong>{rupees(e)}</strong>
    <p>{cash?`${rupees(value)} × ${pct(pWin)} × ${pct(time)} × ${pct(pay)}`:"In-kind deals add nothing to the cash forecast."}</p>
   </div>
  </div>
 </div>;
}

function PrioritySection(){
 return <Section id="priority" kicker="Prioritization framework" title="What to work on first, and why">
  <div className="guide-callout">One rule at every level: <b>rank work by the cash it is expected to bring in before the festival, discounted by how strong the evidence is and how long the cash takes to arrive.</b></div>
  <h3>The five strategies for Unmaad 2027</h3>
  <table className="guide-table"><thead><tr><th>#</th><th>Strategy</th><th>Base</th><th>Stretch</th><th>Why it sits here</th></tr></thead><tbody>
   <tr><td>1</td><td>Renew and upsell 2025 sponsors</td><td>₹9.0L</td><td>₹15.0L</td><td>Known buyers who already paid once: fastest cash, cheapest pitch</td></tr>
   <tr><td>2</td><td>Warm-intro engine</td><td>₹12.5L</td><td>₹16.7L</td><td>Largest base cash and the strongest observed rate (50%), but intros must be generated first</td></tr>
   <tr><td>3</td><td>Leak recovery and stalled revival</td><td>₹6.0L</td><td>₹11.7L</td><td>Cheap, since the brands already qualified, but cold pools barely converted in 2025</td></tr>
   <tr><td>4</td><td>Collections push</td><td>+₹1.6L</td><td>+₹4.4L</td><td>No new deals; turns signed cash into collected cash, the North Star, at almost no cost</td></tr>
   <tr><td>5</td><td>Anchor (title) sponsor</td><td>₹0</td><td>₹12.0L</td><td>One deal with no 2025 precedent, so stretch only</td></tr>
   <tr><td>–</td><td>Cold outreach</td><td>₹0</td><td>₹0.8L</td><td>321 attempts → 0 deals in 2025. Capped at 100 test attempts</td></tr>
  </tbody></table>
  <PlanSandbox/>
  <h3>How the app ranks today's work</h3>
  <ul>
   <li><b>Money list:</b> open deals and qualified brands with no deal, by expected cash.</li>
   <li><b>Weekly action plan:</b> open deals for warm qualified brands first, then follow up the 5 largest stalled deals, then pause Stop campaigns.</li>
   <li><b>Bottleneck finder:</b> funnel steps below last season, ranked by cash lost = (benchmark rate − actual rate) × brands entering × average deal × downstream win rate.</li>
  </ul>
  <ProspectSandbox/>
 </Section>;
}

function PlanSandbox(){
 const [renew,setRenew]=useState(.45),[intros,setIntros]=useState(30),[haircut,setHaircut]=useState(.5),[coldRec,setColdRec]=useState(.1),[title,setTitle]=useState(0),[collect,setCollect]=useState(.9);
 // Same rates and pools as scripts/plan-model.mjs (2025 source data).
 const avg=100000,cashShare=20/24,perDeal=avg*cashShare;
 const streams=[["Renew and upsell",24*renew*perDeal],["Warm-intro engine",intros*.5*perDeal],["Leak recovery",(12*(24/36)*haircut+32*coldRec)*perDeal],["Title sponsor",title*1200000]] as const;
 const signed=streams.reduce((n,[,v])=>n+v,0),collected=signed*collect;
 return <div className="guide-sandbox">
  <div className="guide-sandbox-head"><FlaskConical size={16}/><b>Try it: the 2027 plan</b><Tag tone="purple">Sandbox</Tag></div>
  <div className="guide-sandbox-grid">
   <div>
    <Slider label="Renewal rate (24 sponsors)" value={renew} set={setRenew} min={0} max={1} step={.05} fmt={pct}/>
    <Slider label="Warm intros this season" value={intros} set={setIntros} min={0} max={80}/>
    <Slider label="Warm leak recovery haircut" value={haircut} set={setHaircut} min={0} max={1} step={.05} fmt={pct}/>
    <Slider label="Cold pool recovery" value={coldRec} set={setColdRec} min={0} max={.5} step={.05} fmt={pct}/>
    <Slider label="Title sponsor deals (₹12L)" value={title} set={setTitle} min={0} max={2}/>
    <Slider label="Collection rate" value={collect} set={setCollect} min={.5} max={1} step={.01} fmt={pct}/>
   </div>
   <div className="guide-result">
    {streams.map(([k,v])=><p key={k} className="guide-row"><span>{k}</span><b>{rupees(Math.round(v))}</b></p>)}
    <small>Cash collected before the fest</small><strong>{rupees(Math.round(collected))}</strong>
    <p>vs ₹16.8L in 2025 · target ₹25L. Defaults are the base case (₹24.8L).</p>
   </div>
  </div>
 </div>;
}

function ProspectSandbox(){
 const [title,setTitle]=useState("Head of Brand Marketing"),[youth,setYouth]=useState(true),[strength,setStrength]=useState(70),[timing,setTiming]=useState(60),[winRate,setWinRate]=useState(.3);
 const s=scoreProspect({id:"sandbox",name:"Sandbox",title,company:"Sandbox Co",industry:"Sandbox",city:"Bengaluru",source:"manual",targetsYouth:youth,timing,connections:strength?[{viaType:"alumni",viaName:"an alum",ownerId:"",strength}]:[]},{industryWinRates:{Sandbox:{winRate,sampleSize:10}}});
 return <div className="guide-sandbox">
  <div className="guide-sandbox-head"><FlaskConical size={16}/><b>Try it: Prospect Finder score</b><Tag tone="purple">Sandbox</Tag></div>
  <div className="guide-sandbox-grid">
   <div>
    <label className="guide-text">Contact's job title<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <Slider label="Industry win rate (2025)" value={winRate} set={setWinRate} min={0} max={1} step={.05} fmt={pct}/>
    <Slider label="Warm connection strength" value={strength} set={setStrength} min={0} max={100} step={5}/>
    <Slider label="Timing signal" value={timing} set={setTiming} min={0} max={100} step={5}/>
    <label className="guide-check"><input type="checkbox" checked={youth} onChange={e=>setYouth(e.target.checked)}/>Brand targets young people</label>
   </div>
   <div className="guide-result">
    <p className="guide-row"><span>Fit (0.45 industry + 0.35 role + 0.2 youth)</span><b>{s.fit}</b></p>
    <p className="guide-row"><span>Warmth</span><b>{s.warmth}</b></p>
    <p className="guide-row"><span>Timing</span><b>{s.timing}</b></p>
    <small>Score = 0.4 fit + 0.4 warmth + 0.2 timing</small><strong>{s.score} / 100</strong>
    <p>{s.connection?"Routed to an intro request through "+s.connection.viaName+".":"No warm path: joins the capped cold queue (10 a day)."}</p>
   </div>
  </div>
 </div>;
}

function CopilotSection(){
 return <Section id="copilot" kicker="AI" title="How the copilot works">
  <ol>
   <li>The panel sends your question with the page's as-of date and filters.</li>
   <li>The model calls read tools (funnel, cash, pacing, forecast, stalled, leakage, compare dates…). Every tool runs the metrics engine, so it sees exactly what the dashboard shows.</li>
   <li>The answer ends in a fixed shape: evidence, assumptions, sample size and missing data.</li>
   <li>A number check flags any figure that isn't in that turn's tool output, so an invented number can't pass as fact.</li>
   <li>Writes ("Do it") come back as a preview card. Nothing changes until someone presses <b>Confirm</b>.</li>
  </ol>
  <Why>an LLM is good at choosing which numbers matter and explaining them, and bad at arithmetic. So the engine does the maths and the model does the reasoning.</Why>
  <p>Threads remember their date and filters, so "now only LinkedIn" or "and a month earlier?" work without repeating context. Questions the data can't answer, such as "who will renew next year?", are declined, and the copilot names the data that would be needed.</p>
 </Section>;
}

function CallsSection(){
 return <Section id="calls" kicker="AI" title="How the call agent works">
  <div className="guide-flow">{["Brief from the engine","AI disclosure + reason","Conversation","Quote-checked insights","Person reviews"].map((t,i)=><React.Fragment key={t}>{i>0&&<ArrowRight size={16} className="guide-flow-arrow"/>}<div><b>{t}</b></div></React.Fragment>)}</div>
  <h3>Safety rails</h3>
  <ul>
   <li>Warm, consenting contacts on an allowlist only. Never cold calls to strangers. <Why>Indian rules on automated calls, and trust with sponsors.</Why></li>
   <li>Every call opens with a fixed AI disclosure line; a transcript without it is flagged.</li>
   <li>3 calls per contact per day, a 5-minute cap and a kill switch in Settings.</li>
   <li>"Stop calling me" opts the contact out instantly.</li>
   <li>Each extracted field (interest, objection, next step, payment promise) must quote the transcript, or it is set to unknown.</li>
   <li>Stage and payment changes wait for a person to confirm.</li>
   <li>Phone numbers are never sent to Gemini.</li>
  </ul>
  <h3>Why it feels fast</h3>
  <p>The opening line is templated, so pickup has no model wait. Replies stream sentence by sentence, and speech starts on the first sentence. If a model stays silent for 2 s, a fallback model starts, and the first to answer wins.</p>
 </Section>;
}

function AutomationSection(){
 return <Section id="automation" kicker="Execution" title="Automations and rules">
  <ul>
   <li><b>Positive reply</b> → task to book a meeting.</li>
   <li><b>Deal confirmed</b> → tasks to ask for 2 intros and to upsell.</li>
   <li><b>Third cold touch</b> to the same brand → logged, but the user is warned and the owner notified. <Why>the 2025 data showed follow-up cold touches never worked.</Why></li>
   <li><b>Rule builder</b> (Settings): pick a trigger, optionally narrow it by channel or value, and it creates a task for the record's owner.</li>
  </ul>
  <p>Automations act only on the live season, never on a past as-of view, so replaying 2025 can't create real tasks.</p>
 </Section>;
}

function HonestySection(){
 return <Section id="honesty" kicker="Trust" title="What's real, what's simulated">
  <div className="guide-tags"><span><Tag tone="green">Source</Tag>A row from the provided workbook, unchanged.</span><span><Tag tone="blue">Simulated</Tag>Generated deterministically (invoices, payments, the 2027 season).</span><span><Tag tone="orange">Assumption</Tag>A judgement call, such as the ₹25L target or campaign budgets. Editable in Settings.</span></div>
  <ul>
   <li>The 2025 workbook describes fictional brands. Each was given a real brand name by a reproducible method (fest-sponsor evidence + youth fit + Bengaluru presence). Only names changed; every ID, stage, value and date is as provided.</li>
   <li>2025 outcomes are the dataset's, not something the real company did.</li>
   <li>No real people: contacts are shown by role.</li>
  </ul>
 </Section>;
}

function LimitsSection(){
 return <Section id="limits" kicker="Known limitations" title="What this app doesn't do (yet)">
  <ul>
   <li>Cash is simulated; there are no bank receipts.</li>
   <li>ROI uses assumed budgets, because the dataset has no spend.</li>
   <li>Campaign results are association, not cause.</li>
   <li>The offline copilot is pattern-based; free-form questions need a Gemini key.</li>
   <li>There's no real telephony. Calls run in the browser.</li>
   <li>The 2027 plan rests on assumed renewal, intro and recovery rates.</li>
   <li>Deliberately not built: LinkedIn scraping, cold AI calls, an agent that passes as human, real email sending, ML lead scoring (58 deals is too few).</li>
  </ul>
 </Section>;
}
