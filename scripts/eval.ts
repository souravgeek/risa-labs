// Copilot eval runner (`npm run eval`).
// Runs ~30 questions through the same `assistant()` path the UI uses. Expected values are
// computed by the metrics engine at run time, never typed by hand, so the set stays valid
// when the data changes. Uses Gemini when GEMINI_API_KEY is set, otherwise the local engine.
// Writes to an isolated data directory so evals never touch the workspace.
import {mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

process.env.CAMPUSFEST_DATA_DIR=mkdtempSync(path.join(tmpdir(),"campusfest-eval-"));

type Turn={question:string;expect:string[];asOf?:string;refusal?:boolean};
type Case={type:"Lookup"|"Calculation"|"Diagnosis"|"Follow-up"|"Can't answer";turns:Turn[]};

async function main(){
 const {state,input}=await import("../lib/workspace");
 const {assistant}=await import("../lib/assistant");
 const {compareSnapshots}=await import("../lib/decision");
 const {geminiConfigured}=await import("../lib/gemini");
 const {rupees}=await import("../lib/shared");
 const snap=(asOf:string,filters:Record<string,string>={})=>state([],input({asOf,filters})).snap;
 const feb=snap("2025-02-15"),mar15=snap("2025-03-15"),mar20=snap("2025-03-20"),apr=snap("2025-04-11");
 const total=(m:typeof mar20)=>rupees(m.cash.confirmed+m.cash.inKind);
 const funnelCount=(m:typeof mar20,label:string)=>label+" "+m.funnel.find(f=>f.label===label)!.count;
 const stalledValue=(m:typeof mar20)=>rupees(m.stalled.reduce((n,d)=>n+d.value,0));
 const verdicts=(m:typeof mar20,v:string)=>m.campaigns.filter(c=>c.verdict===v).map(c=>c.name);
 const heaviest=[...apr.owners].sort((a,b)=>b.brands/b.capacity-a.brands/a.capacity)[0];
 const warmWon=apr.deals.filter(d=>d.group==="warm"&&d.stage==="partner_confirmed").length;
 const changed=compareSnapshots(mar15,mar20);
 const monthEarlier=snap("2025-02-13");

 const cases:Case[]=[
  // Lookup (10)
  {type:"Lookup",turns:[{question:"Confirmed value as of 15 Mar 2025?",expect:[total(mar15)],asOf:"2025-03-15"}]},
  {type:"Lookup",turns:[{question:"Confirmed value as of 11 Apr 2025?",expect:[total(apr),rupees(apr.cash.inKind)],asOf:"2025-04-11"}]},
  {type:"Lookup",turns:[{question:"Confirmed value as of 15 Feb 2025?",expect:[total(feb)],asOf:"2025-02-15"}]},
  {type:"Lookup",turns:[{question:"How much cash is collected as of 20 Mar 2025?",expect:[rupees(mar20.cash.collected)]}]},
  {type:"Lookup",turns:[{question:"What is overdue as of 20 Mar 2025?",expect:[rupees(mar20.cash.overdue)]}]},
  {type:"Lookup",turns:[{question:"How many deals are stalled as of 20 Mar 2025?",expect:[String(mar20.stalled.length),stalledValue(mar20)]}]},
  {type:"Lookup",turns:[{question:"What is the open pipeline in the funnel as of 11 Apr 2025?",expect:[rupees(apr.counts.openValue)]}]},
  {type:"Lookup",turns:[{question:"How many brands are qualified in the funnel as of 15 Mar 2025?",expect:[funnelCount(mar15,"Qualified")]}]},
  {type:"Lookup",turns:[{question:"How many brands were contacted? Show the funnel as of 15 Feb 2025",expect:[funnelCount(feb,"Contacted")]}]},
  {type:"Lookup",turns:[{question:"What is the forecast as of 20 Mar 2025?",expect:[rupees(mar20.forecast.base),rupees(mar20.forecast.committed)]}]},
  // Calculation (6)
  {type:"Calculation",turns:[{question:"Deals needed per week as of 20 Mar 2025?",expect:[mar20.pacing.neededPerWeek.toFixed(1),mar20.counts.confirmed+" of "+mar20.targets.confirmed,mar20.daysLeft+" days"]}]},
  {type:"Calculation",turns:[{question:"Deals needed per week as of 15 Mar 2025?",expect:[mar15.pacing.neededPerWeek.toFixed(1),mar15.counts.confirmed+" of "+mar15.targets.confirmed]}]},
  {type:"Calculation",turns:[{question:"Are we behind on partnerships as of 11 Apr 2025?",expect:[apr.counts.confirmed+" of "+apr.targets.confirmed,apr.pacing.neededPerWeek.toFixed(1)]}]},
  {type:"Calculation",turns:[{question:"How much cash does the plan add before the festival as of 20 Mar 2025?",expect:[rupees(mar20.forecast.committed),rupees(mar20.forecast.base),rupees(mar20.forecast.stretch)]}]},
  {type:"Calculation",turns:[{question:"Compare warm vs cold as of 11 Apr 2025",expect:[warmWon+" won"]}]},
  {type:"Calculation",turns:[{question:"What changed between 15 Mar 2025 and 20 Mar 2025?",expect:[changed.newConfirmations.length+" new confirmations",rupees(changed.forecastChange.base)]}]},
  // Diagnosis (5)
  {type:"Diagnosis",turns:[{question:"Which campaign should we stop as of 11 Apr 2025?",expect:verdicts(apr,"Stop").map(n=>n+" · Stop")}]},
  {type:"Diagnosis",turns:[{question:"Which campaigns should we scale as of 11 Apr 2025?",expect:verdicts(apr,"Scale").map(n=>n+" · Scale")}]},
  {type:"Diagnosis",turns:[{question:"Which deals are stalled as of 20 Mar 2025?",expect:[[...mar20.stalled].sort((a,b)=>b.value-a.value)[0].brand]}]},
  {type:"Diagnosis",turns:[{question:"Where are we leaking qualified brands as of 11 Apr 2025?",expect:[String(apr.qualifiedWithoutDeal.length)+" qualified brands have no deal","Deals on unqualified brands: "+apr.leakage.find(l=>l.key!=="qualified_no_deal"&&/unqualified/i.test(l.label))!.records.length]}]},
  {type:"Diagnosis",turns:[{question:"Which owner is overloaded as of 11 Apr 2025?",expect:[heaviest.name+" holds "+heaviest.brands]}]},
  // Follow-up (4)
  {type:"Follow-up",turns:[{question:"Show the funnel as of 15 Mar 2025",expect:[funnelCount(mar15,"Contacted")]},{question:"Now only LinkedIn",expect:[funnelCount(snap("2025-03-15",{channel:"linkedin"}),"Contacted")],asOf:"2025-03-15"}]},
  {type:"Follow-up",turns:[{question:"Confirmed value as of 15 Mar 2025?",expect:[total(mar15)]},{question:"And a month earlier?",expect:[total(monthEarlier)],asOf:"2025-02-13"}]},
  {type:"Follow-up",turns:[{question:"Show the funnel as of 20 Mar 2025",expect:[funnelCount(mar20,"Contacted")]},{question:"Now just Education",expect:[funnelCount(snap("2025-03-20",{industry:"Education"}),"Contacted")],asOf:"2025-03-20"}]},
  {type:"Follow-up",turns:[{question:"Show the funnel only for LinkedIn as of 20 Mar 2025",expect:[funnelCount(snap("2025-03-20",{channel:"linkedin"}),"Contacted")]},{question:"Now all channels",expect:[funnelCount(mar20,"Contacted")],asOf:"2025-03-20"}]},
  // Can't answer (5)
  {type:"Can't answer",turns:[{question:"Which of these sponsors will renew next year?",expect:["renewal history"],refusal:true}]},
  {type:"Can't answer",turns:[{question:"What is Beardo's sponsor budget?",expect:["budget"],refusal:true}]},
  {type:"Can't answer",turns:[{question:"Did the activations cause sponsors to sign?",expect:["observational"],refusal:true}]},
  {type:"Can't answer",turns:[{question:"Why did we lose deals?",expect:["lost reasons"],refusal:true}]},
  {type:"Can't answer",turns:[{question:"How much did we actually spend on LinkedIn?",expect:["spend"],refusal:true}]},
 ];

 const norm=(t:string)=>t.toLowerCase().replace(/,/g,"").replace(/\s+/g," ");
 const results:{type:string;questions:string[];passed:boolean;problems:string[]}[]=[];
 for(const c of cases){
  let threadId:string|undefined;const problems:string[]=[];
  for(const t of c.turns){
   const r=await assistant(input({asOf:"2025-03-20"}),{question:t.question,threadId});
   if(!("reply" in r)||!r.reply){problems.push(`"${t.question}" returned no answer`);break}
   threadId=r.threadId;const reply=r.reply;
   const text=norm([reply.answer,...(reply.missingData||[])].join(" "));
   for(const e of t.expect)if(!text.includes(norm(e)))problems.push(`"${t.question}" missing "${e}"`);
   if(t.asOf&&reply.asOf!==t.asOf)problems.push(`"${t.question}" used ${reply.asOf}, expected ${t.asOf}`);
   if(t.refusal&&!text.includes("cannot support"))problems.push(`"${t.question}" did not decline`);
  }
  results.push({type:c.type,questions:c.turns.map(t=>t.question),passed:!problems.length,problems});
 }

 const passed=results.filter(r=>r.passed).length,engine=geminiConfigured()?"Gemini":"Local report";
 const byType:Record<string,{passed:number;total:number}>={};
 for(const r of results){const b=byType[r.type]??={passed:0,total:0};b.total++;if(r.passed)b.passed++}
 for(const r of results.filter(r=>!r.passed))console.error("FAIL",r.type,"·",r.problems.join("; "));
 console.log(`\nCopilot eval · engine: ${engine}`);
 for(const [k,v] of Object.entries(byType))console.log(`  ${k.padEnd(13)} ${v.passed}/${v.total}`);
 console.log(`  ${"Total".padEnd(13)} ${passed}/${results.length} (${Math.round(100*passed/results.length)}%)`);
 writeFileSync(path.join(process.cwd(),"data","eval-report.json"),JSON.stringify({ranAt:new Date().toISOString(),engine,passed,total:results.length,passRate:passed/results.length,byType,results},null,1));
 if(passed/results.length<0.9)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
