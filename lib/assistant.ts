import {type State,type Input,command,change,task,uid,commit,state} from "./workspace";
import {entries,type Row} from "./storage";
import {rupees,pct,dateAdd,title} from "./shared";
import {askCopilot,geminiConfigured,type GeminiLogEntry,type CopilotTool} from "./gemini";
import {compareSnapshots,scenarioForecast} from "./decision";
export function plan(s:State,i:Input){
 const m=s.snap, warm=m.qualifiedWithoutDeal.filter(b=>b.group==="warm");
 const actions:Row[]=warm.map(b=>({kind:"deal",brandId:b.id,owner:b.ownerId,campaignId:b.campaignId,value:Math.round(m.forecast.averageDeal||55000),supportType:"cash",description:"Open deal · "+b.name}));
 for(const d of [...m.stalled].sort((a,b)=>b.value-a.value).slice(0,5))actions.push({kind:"task",brandId:d.brandId,linkedId:d.id,title:"Arrange consent-based follow-up with "+d.brand,due:i.asOf,owner:d.ownerId,description:"Follow-up task · "+d.brand});
 for(const c of m.campaigns.filter(c=>c.verdict.toLowerCase()==="stop"&&c.status==="active"))actions.push({kind:"campaign",id:c.id,status:"paused",owner:c.ownerId,budget:c.budget,description:"Pause "+c.name});
 return actions
}
const MONTHS=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
/** Dates mentioned in a question, as ISO strings in question order. A missing year takes the season's year. */
export function questionDates(question:string,season:string):string[]{
 const mon="(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?",found:{at:number;iso:string}[]=[];
 const push=(at:number,y:string|undefined,mi:number,d:number)=>{const iso=(y||season)+"-"+String(mi+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");const t=new Date(iso+"T00:00:00Z");if(mi>=0&&!isNaN(+t)&&t.toISOString().slice(0,10)===iso&&!found.some(f=>f.at===at))found.push({at,iso})};
 for(const r of question.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g))push(r.index!,r[1],+r[2]-1,+r[3]);
 for(const r of question.matchAll(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+"+mon+"(?:,?\\s+(20\\d\\d))?","gi")))push(r.index!,r[3],MONTHS.indexOf(r[2].toLowerCase()),+r[1]);
 for(const r of question.matchAll(new RegExp("\\b"+mon+"\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:deals?|brands?|days?|weeks?|%))(?:,?\\s+(20\\d\\d))?","gi")))push(r.index!,r[3],MONTHS.indexOf(r[1].toLowerCase()),+r[2]);
 return found.sort((a,b)=>a.at-b.at).map(f=>f.iso)
}
/** A follow-up that leans on the previous question's topic, such as "now only LinkedIn" or "and a month earlier?". */
export const followUp=(q:string)=>/^\s*(and|now|what about|how about|same|then|ok(ay)?,?)\b/i.test(q)&&q.trim().split(/\s+/).length<=8;
export const changeQuestion=(q:string)=>/what changed|changed since|since (?:the )?\d|since (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|between .* and|compared? (?:to|with) (?:\d|last|a week|a month)/i.test(q);
/** Filters a question asks for, layered over the thread's existing filters. */
export function questionFilters(question:string,m:State["snap"],base:Record<string,string>):Record<string,string>{
 const q=question.toLowerCase(),f={...base},scoped=/\b(only|just|filter(?:ed)?(?: it)? (?:to|by|on)|for|in|now)\b/.test(q);
 if(/all channels|clear (?:the )?filters?|remove (?:the )?filters?|everything|all owners|all industries/.test(q))return Object.fromEntries(Object.keys(f).map(k=>[k,""]));
 if(/linkedin/.test(q))f.channel="linkedin";else if(scoped&&/\bemail\b/.test(q))f.channel="email";else if(/(only|just) warm|warm (channels )?only/.test(q))f.channel="warm";else if(/(only|just) cold|cold (channels )?only/.test(q))f.channel="cold";
 if(scoped){const ind=m.industries.find(n=>q.includes(n.toLowerCase()));if(ind)f.industry=ind;
  const own=m.owners.find(o=>new RegExp("\\b"+o.name.split(" ")[0].toLowerCase()+"\\b").test(q));if(own)f.owner=own.id;
  const camp=m.campaigns.find(c=>q.includes(c.name.toLowerCase()));if(camp){f.campaign=camp.id;delete f.channel}}
 return f
}
const WON="partner_confirmed",CLOSED=/^(partner_confirmed|lost|withdrawn|closed_lost)$/;
function segmentRows(deals:State["snap"]["deals"],key:(d:State["snap"]["deals"][number])=>string){
 const map=new Map<string,{name:string;deals:number;closed:number;won:number;value:number;open:number}>();
 for(const d of deals){const k=key(d)||"Unknown",r=map.get(k)||{name:k,deals:0,closed:0,won:0,value:0,open:0};r.deals++;if(CLOSED.test(d.stage))r.closed++;if(d.stage===WON){r.won++;r.value+=d.confirmedValue||0}else if(!CLOSED.test(d.stage))r.open+=d.value||0;map.set(k,r)}
 return [...map.values()].map(r=>({...r,winRate:r.closed?r.won/r.closed:0,directional:r.closed<10}))
}
export function localAnswer(s:State,question:string,extra:{prior?:State["snap"]}={}){
 const m=s.snap,q=question.toLowerCase(),a=m.stalled,w=m.qualifiedWithoutDeal,stalledValue=a.reduce((n,d)=>n+d.value,0);
 const summary="At "+m.asOf+", "+m.counts.confirmed+" of "+m.targets.confirmed+" partnerships are confirmed, with "+m.daysLeft+" days left. The remaining pace is "+m.pacing.neededPerWeek.toFixed(1)+" deals per week. "+a.length+" stalled deals are worth "+rupees(stalledValue)+". "+w.length+" qualified brands have no deal, including "+w.filter(b=>b.group==="warm").length+" from warm channels.";
 let answer=summary,tool="pacing",missingData:string[]=[],sampleSize=m.counts.confirmed;
 const evidence:{metric:string;value:string;asOf:string;tool:string}[]=[];const ev=(metric:string,value:string|number,t=tool)=>evidence.push({metric,value:String(value),asOf:m.asOf,tool:t});
 const assumptions=["Invoice and payment history includes simulated milestones. Forecasts use assumed payment behaviour."];
 if(/renew|caus|sponsor('s|s)? budget|bank receipt|real spend|actual(ly)? spen[dt]|how much (did|have) we spen[dt]|lost reason|why .*\b(lose|lost)\b|lifetime value|next year/.test(q)){
  answer="The data cannot support that conclusion.";tool="data_coverage";
  missingData=[/renew|next year|lifetime/.test(q)?"Renewal history and post-festival results are needed.":/budget/.test(q)?"Sponsor budget data is needed; the dataset holds none.":/\blos[et]\b/.test(q)?"Lost reasons are only recorded once call insights exist; the 2025 data has none.":/caus/.test(q)?"Campaign and activation links are observational. A controlled test would be needed to show cause.":"Verified spend or bank receipts are needed; cash and budgets here are simulated or assumed."];ev("data coverage","no "+(/renew|next year/.test(q)?"renewal history":/budget/.test(q)?"sponsor budgets":/\blos[et]\b/.test(q)?"lost reasons":/caus/.test(q)?"causal evidence":"receipts or spend"))}
 else if(changeQuestion(q)&&extra.prior){
  const c=compareSnapshots(extra.prior,m);tool="what_changed";
  answer="Between "+c.from+" and "+c.to+": "+c.newConfirmations.length+" new confirmations"+(c.newConfirmations.length?" ("+c.newConfirmations.slice(0,5).map(d=>d.brand).join(", ")+")":"")+", "+c.newDeals.length+" new deals, "+c.stageMoves.length+" stage moves, "+c.newlyDormant.length+" newly dormant brands and "+c.newLeaks.length+" new leaks. The base forecast moved by "+rupees(c.forecastChange.base)+": new deals "+rupees(c.causes.newDeals)+", stage moves "+rupees(c.causes.stageMoves)+", losses "+rupees(c.causes.losses)+", payments "+rupees(c.causes.payments)+", timing and model "+rupees(c.causes.timingAndModel)+".";
  ev("new confirmations",c.newConfirmations.length);ev("stage moves",c.stageMoves.length);ev("base forecast change",rupees(c.forecastChange.base));sampleSize=c.stageMoves.length}
 else if(/week|recommend|do it|take action/.test(q)&&!/pace|needed|behind|per week/.test(q)){answer="Open deals for qualified warm brands, follow up with the largest stalled opportunities, and pause campaigns with a Stop verdict. Review the individual actions before committing them.";tool="propose_actions";ev("warm qualified brands without a deal",w.filter(b=>b.group==="warm").length);ev("stalled deals",a.length)}
 else if(/forecast|how much cash does|expected cash/.test(q)){answer="Committed "+rupees(m.forecast.committed)+", base "+rupees(m.forecast.base)+", stretch "+rupees(m.forecast.stretch)+". Expected collections use stage and channel win rates, payment timing and the on-time payment assumption.";tool="forecast";ev("committed",rupees(m.forecast.committed));ev("base",rupees(m.forecast.base));ev("stretch",rupees(m.forecast.stretch));assumptions.push("Win chance uses (wins + 1) / (closed + 2) by stage and channel group.")}
 else if(/\bcalls?\b|objection|\bsaid\b|\bsay\b/.test(q)){// A brand named in the question, by its real name or the dataset's original name.
 const named=m.brands.find(b=>q.includes(b.name.toLowerCase())||(b.aka&&q.includes(b.aka.toLowerCase())));
 const calls=s.extras.calls.filter(c=>c.status==="completed"&&(!named||c.brandId===named.id));sampleSize=calls.length;answer=calls.length?calls.map(c=>c.brand+" · "+(c.insights?.fields?.objections?.quote||c.insights?.fields?.outcome?.quote||"No quoted objection")).slice(-4).join("\n")+". Sample size "+calls.length+(calls.length<10?"; this is directional, and "+(calls.length===1?"one call is not a pattern.":"too few calls to call a pattern."):"."):"No completed calls match this snapshot.";tool="call_insights";ev("completed calls",calls.length)}
 else if(/workload|overload|capacity|owner|who (is|has) (the most|too)|imbalance/.test(q)){const rows=[...m.owners].sort((x,y)=>y.brands/Math.max(1,y.capacity)-x.brands/Math.max(1,x.capacity));const total=m.owners.reduce((n,o)=>n+o.brands,0);tool="owner_workload";answer=rows.map(o=>o.name+": "+o.brands+" brands, "+o.open+" open deals, "+o.stalled+" stalled, "+o.capacity+" h/week capacity").join("\n")+". "+rows[0].name+" holds "+rows[0].brands+" of "+total+" brands, the heaviest load per hour of capacity.";rows.forEach(o=>ev(o.name+" brands",o.brands));assumptions.push("Weekly capacity hours are simulated.")}
 else if(/leak|qualified (brands )?(with )?no deal|without a deal|handoff|slipp/.test(q)){tool="find_leakage";const rows=m.leakage.filter(r=>r.records.length);answer=(rows.length?rows.map(r=>r.label+(r.key==="qualified_no_deal"?" past the alert window":"")+": "+r.records.length+(r.records.some(x=>x.value)?" ("+rupees(r.records.reduce((n,x)=>n+(x.value||0),0))+" at stake)":"")).join("\n"):"No leakage rules fire at this snapshot.")+". In total "+w.length+" qualified brands have no deal, "+w.filter(b=>b.group==="warm").length+" of them from warm channels.";rows.forEach(r=>ev(r.label,r.records.length));sampleSize=w.length}
 else if(/stall|stuck|frozen/.test(q)){tool="list_stalled_deals";const top=[...a].sort((x,y)=>y.value-x.value).slice(0,5);answer=a.length+" open deals are past their stalled threshold, worth "+rupees(stalledValue)+". Largest: "+top.map(d=>d.brand+" "+rupees(d.value)+" ("+d.daysInStage+" days in "+d.stage.replaceAll("_"," ")+")").join(", ")+".";ev("stalled deals",a.length);ev("stalled value",rupees(stalledValue));sampleSize=a.length}
 else if(/warm (vs|versus|or|and) cold|cold (vs|versus|or|and) warm|compare|segment|channel group|industr/.test(q)){const byIndustry=/industr/.test(q),rows=segmentRows(m.deals,d=>byIndustry?d.industry:d.group).sort((x,y)=>y.winRate-x.winRate||y.value-x.value);tool="compare_segments";answer=rows.map(r=>r.name+": "+r.won+" won of "+r.closed+" closed ("+pct(r.winRate)+" win rate), "+rupees(r.value)+" confirmed, "+rupees(r.open)+" open"+(r.directional?" (directional, under 10 closed deals)":"")).join("\n")+".";rows.forEach(r=>ev(r.name+" win rate",pct(r.winRate)));sampleSize=rows.reduce((n,r)=>n+r.closed,0);if(byIndustry)assumptions.push("Industry and channel overlap, so industry differences are association, not cause.")}
 else if(/campaign|stop|win rate|roi|scale|verdict/.test(q)){answer=m.campaigns.map(c=>c.name+" · "+c.verdict+", "+c.attempts+" attempts, "+pct(c.positiveRate)+" positive, "+c.confirmed+" confirmed"+(c.directional?" (directional)":"")+(q.includes("roi")?(c.roi==null?" · ROI unavailable without a budget":" · "+pct(c.roi)+" ROI on an assumed budget"):"")).join("\n");tool="campaign_scorecard";m.campaigns.forEach(c=>ev(c.name+" verdict",c.verdict));if(q.includes("roi")){assumptions.push("Campaign budgets are assumptions, not recorded spend.");missingData=["Real campaign spend is needed for a true ROI."]}}
 else if(/cash|collect|invoic|in.kind|confirmed value|overdue|paid/.test(q)){answer="Confirmed "+rupees(m.cash.confirmed+m.cash.inKind)+" in total, including "+rupees(m.cash.confirmed)+" cash and "+rupees(m.cash.inKind)+" in-kind. Invoices total "+rupees(m.cash.invoiced)+", collections "+rupees(m.cash.collected)+", and overdue balances "+rupees(m.cash.overdue)+".";tool="cash_summary";ev("confirmed value",rupees(m.cash.confirmed+m.cash.inKind));ev("cash collected",rupees(m.cash.collected));ev("overdue",rupees(m.cash.overdue))}
 else if(/funnel|linkedin|qualified|open pipeline|conversion|contacted|meeting|now only|only /.test(q)){answer=m.funnel.map(f=>f.label+" "+f.count).join(" · ")+". Open pipeline "+rupees(m.counts.openValue)+".";tool="funnel";m.funnel.forEach(f=>ev(f.label,f.count));sampleSize=m.funnel[0]?.count||0;if(sampleSize<10)assumptions.push("Fewer than 10 records match these filters, so treat this as directional.")}
 else if(!/behind|pace|partnership|status|deal|snapshot|target|needed/.test(q)){answer="The local report covers cash, funnel, pacing, forecast, campaigns, stalled deals, leakage, owner workload, segments, what changed, calls and the weekly action plan. A configured Gemini connection handles free-form analysis.";tool="data_coverage"}
 else{ev("confirmed",m.counts.confirmed+" of "+m.targets.confirmed);ev("deals needed per week",m.pacing.neededPerWeek.toFixed(1));ev("stalled value",rupees(stalledValue))}
 return {answer,evidence,missingData,assumptions,confidence:"Computed from this snapshot",sampleSize,facts:[],followUps:[],suggestedActions:[],toolsUsed:[tool],unverifiedNumbers:[]}
}
export async function assistant(i:Input,b:Row){
 if(b.decision){await commit(i,s=>{const p=s.extras.proposals.find(p=>p.id===b.proposalId&&p.type==="weekly"&&p.asOf===i.asOf);if(!p||p.status!=="proposed")throw Error("This proposal is unavailable or already decided.");const yes=b.decision==="confirm";if(!yes&&b.decision!=="reject")throw Error("Unknown decision.");const changes=yes?p.actions.flatMap((a:Row)=>{if(a.kind==="deal"&&!s.snap.qualifiedWithoutDeal.some(o=>o.id===a.brandId))throw Error("A proposed brand already has a deal. Generate a fresh plan.");return command(s,i,{...a,source:"copilot"}).changes}):[];return {label:yes?"Confirmed copilot action plan":"Rejected copilot action plan",changes:[...changes,change("proposals",{id:p.id,status:yes?"confirmed":"rejected",baseBefore:s.snap.forecast.base})]}},"Copilot");return {ok:true}}
 const question=String(b.question||"").trim().slice(0,4000);if(!question)throw Error("Enter a question.");
 const list=await entries(i.season);const threadId=String(b.threadId||uid("thread")).slice(0,100),prev=state(list,i).extras.threads.find(t=>t.id===threadId);
 const dates=questionDates(question,i.season).filter(d=>d.startsWith(i.season)),changed=changeQuestion(question);
 const keep=prev&&prev.pageAsOf===i.asOf?prev.asOf:i.asOf;
 let date=changed?(dates[1]||keep):dates[0]||(/month earlier/i.test(question)?dateAdd(prev?.asOf||i.asOf,-30):/week earlier/i.test(question)?dateAdd(prev?.asOf||i.asOf,-7):keep);
 let from=changed?(dates[0]||dateAdd(date,-7)):undefined;if(from&&from>date)[from,date]=[date,from];
 const filters=questionFilters(question,state(list,{...i,asOf:date}).snap,{...i.filters,...(prev?.filters||{})});
 const ctx={...i,filters,asOf:date},s=state(list,ctx),m=s.snap,history=(prev?.messages||[]) as Row[];
 let proposal:Row|undefined;
 const propose=()=>{const actions=plan(s,ctx);proposal={id:uid("proposal"),type:"weekly",actions,asOf:date,status:"proposed"};return actions.map(a=>a.description)};
 const tools:Record<string,CopilotTool>={};const expose=(name:string,run:CopilotTool["run"],parameters?:Record<string,unknown>)=>{tools[name]={description:name.replaceAll("_"," "),run,parameters}};
 const simple:Record<string,unknown>={get_funnel:m.funnel,get_cash_summary:m.cash,get_pacing:{...m.pacing,points:undefined,daysLeft:m.daysLeft,counts:m.counts,targets:m.targets},get_campaign_scorecard:m.campaigns,list_stalled_deals:m.stalled.map(d=>({brand:d.brand,value:d.value,days:d.daysInStage})),find_leakage:m.leakage,list_tasks:s.extras.tasks,call_insights:s.extras.calls.map(c=>({brand:c.brand,insights:c.insights})),data_coverage:"2025 workbook has no receipts, spend, sponsor budgets, causal evidence or renewals. Cash ledger simulated."};
 for(const [k,v] of Object.entries(simple))expose(k,()=>v);
 const obj=(properties:Row)=>({type:"object",properties});
 expose("get_forecast",args=>scenarioForecast(m,args),obj({recover:{type:"number"},partners:{type:"number"}}));
 expose("propose_actions",propose);expose("what_changed",a=>compareSnapshots(state(list,{...ctx,asOf:String(a.from||from||dateAdd(date,-7))}).snap,m),obj({from:{type:"string"}}));
 expose("compare_segments",()=>["warm","cold"].map(channel=>{const n=state(list,{...ctx,filters:{...filters,channel}}).snap;return {channel,counts:n.counts,cash:n.cash}}));
 for(const k of ["search_entities","get_entity","query_records"])expose(k,a=>[...m.brands,...m.deals,...m.campaigns].filter(r=>(r.name+" "+r.id+" "+("aka" in r?r.aka:"")).toLowerCase().includes(String(a.query||"").toLowerCase())).slice(0,200).map(r=>({id:r.id,name:r.name,...("aka" in r&&r.aka?{datasetName:r.aka}:{}),...("realBrand" in r&&r.realBrand?{evidence:r.realBrand.evidenceNote}:{})})),obj({query:{type:"string"}}));
 const logs:GeminiLogEntry[]=[];const enabled=geminiConfigured();
 const result=enabled?await askCopilot({question,asOf:date,context:{page:b.page,filters,coverage:simple.data_coverage},history:history.map(h=>({role:h.role,content:h.content})),tools,log:e=>logs.push(e)}):localAnswer(s,followUp(question)?[...history].reverse().find(h=>h.role==="user"&&!followUp(String(h.content)))?.content+" "+question:question,{prior:from?state(list,{...ctx,asOf:from}).snap:undefined});
 if(!enabled&&/do it|preview|take action|apply plan/i.test(question))propose();
 if(!enabled&&/how much cash does|forecast change/i.test(question)){const last=s.extras.proposals.filter(p=>p.status==="confirmed"&&p.type==="weekly").at(-1);if(last)result.answer+=" Base forecast change since approval: "+rupees(m.forecast.base-last.baseBefore)+"."}
 const reply={...result,engine:enabled?"Copilot":"Local report",proposalId:proposal?.id,asOf:date};
 await commit(i,()=>({label:"Saved copilot conversation",changes:[change("threads",{id:threadId,filters,asOf:date,pageAsOf:i.asOf,messages:[...history,{role:"user",content:question},{role:"assistant",content:reply.answer,reply}].slice(-60)}),...(proposal?[change("proposals",proposal)]:[]),...logs.map(l=>change("llm_calls",{id:uid("log"),...l}))]}),"Copilot");
 return {threadId,reply,proposal}
}
