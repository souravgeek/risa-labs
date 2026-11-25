import { randomUUID } from "node:crypto";
import {growthCommand} from "./growth-actions";
import {coldFollowUpPolicy} from "./decision";
import { snapshot } from "./metrics";
import { append,entries,type Change,type Entry,type Row,type Season } from "./storage";
import { actionsDate,dateAdd,packagesSeed,stages,title,RULE_TRIGGERS } from "./shared";
export type Input={season:Season;asOf:string;filters?:Record<string,string>;owner?:string};
const allTables=["brands","sponsor_contacts","sponsor_campaigns","sponsor_interactions","brand_qualification_history","opportunities","opportunity_history","targets","invoices","payments"];
const auxKeys:Record<string,string>={tasks:"id",notifications:"id",settings:"key",scenarios:"id",prospects:"id",connections:"id",proposals:"id",threads:"id",calls:"id",allowlist:"id",allocations:"id",verdicts:"id",llm_calls:"id",eval_runs:"id",rules:"id"};
export function input(obj:Row):Input{
 const season=obj.season||"2025";const asOf=obj.asOf||actionsDate(season);
 if(!["2025","2026"].includes(season)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!asOf.startsWith(season)||new Date(asOf+"T12:00:00Z").toISOString().slice(0,10)!==asOf)throw Error("Choose a valid date in the selected season.");
 return {season,asOf,filters:obj.filters||{},owner:obj.owner||"T01"}
}
export const uid=(prefix:string)=>prefix+"-"+randomUUID().slice(0,12);
export const change=(table:string,row:Row):Change=>({table,row});
export function state(list:Entry[],i:Input){
 const additions:Record<string,Row[]>={},aux:Record<string,Map<string,Row>>=Object.fromEntries(Object.keys(auxKeys).map(k=>[k,new Map()]));
 const visible=list.filter(e=>e.at.slice(0,10)<=i.asOf).sort((a,b)=>a.at.slice(0,10).localeCompare(b.at.slice(0,10)));
 for(const e of visible) for(const {table,row} of e.changes){
   if(allTables.includes(table))(additions[table]??=[]).push(row);
   else if(aux[table])aux[table].set(row[auxKeys[table]],{...aux[table].get(row[auxKeys[table]]),...row});
 }
 const settings=Object.fromEntries(Array.from(aux.settings.values(),r=>[r.key,r.value]));
 if(settings.depositPercent!==undefined)settings.firstMilestoneShare=settings.depositPercent/100;
 const snap=snapshot({...i,additions,settings});
 const extras:Record<string,Row[]>=Object.fromEntries(Object.entries(aux).map(([k,v])=>[k,[...v.values()].filter(r=>!r.deleted)]));
 return {snap,extras,settings,visible,additions};
}
export type State=ReturnType<typeof state>;
export function payload(s:State){
 const {allowlist,threads,calls,proposals,llm_calls,...rest}=s.extras;
 return {...s.snap,packages:packagesSeed,extras:{...rest,allowlist:allowlist.map(({phone,...r})=>r),calls:calls.map(({token,...r})=>r),threads,proposals} as Record<string,Row[]>,settings:s.settings,activity:s.visible.map(({id,at,label,actor,entity})=>({id,at,label,actor,entity})).reverse()};
}
export async function read(i:Input){const list=await entries(i.season);return {...payload(state(list,i)),version:list.length}}
export async function commit(i:Input,fn:(s:State)=>{label:string;entity?:string;changes:Change[]},actor="Team",key?:string){
 const list=await entries(i.season);if(key&&list.some(e=>e.id===key))return;
 const s=state(list,{...i,filters:{}});const {warning,...result}=fn(s) as ReturnType<typeof fn>&{warning?:string};if(!result.changes.length)return;
 await append({id:key||uid("evt"),at:i.asOf+"T23:59:58+05:30",season:i.season,actor,entity:result.entity||"",...result},list.length);return {label:result.label,warning}
}
const req=(x:unknown,name:string)=>{if(typeof x!=="string"||!x.trim())throw Error(name+" is required.");return x.trim().slice(0,5000)};
const num=(v:unknown,min=0,max=1e9)=>{const n=Number(v);if(v===""||v==null||!Number.isFinite(n)||n<min||n>max)throw Error("Enter a number between "+min+" and "+max+".");return n};
const date=(x:unknown)=>{const s=req(x,"Date");if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s)))throw Error("Choose a valid date.");return s};
export function task(title:string,brandId:string,owner:string,due:string,source="manual",linkedId=brandId){
 return change("tasks",{id:uid("task"),title,brandId,linkedId,owner,due,source,status:"Open",priority:"Normal"})
}
export const note=(message:string,owner:string,brandId="")=>change("notifications",{id:uid("note"),message,owner,brandId,read:false});
export function command(s:State,i:Input,a:Row):{label:string;entity?:string;changes:Change[];warning?:string}{
 const growth=growthCommand(s,i,a);if(growth)return growth;
 const m=s.snap, at=i.asOf+"T23:59:57+05:30", origin=a.source==="copilot"?"copilot":"app";
 const brand=m.brands.find(b=>b.id===a.brandId),deal=m.deals.find(d=>d.id===a.dealId),invoice=m.invoices.find(n=>n.id===a.invoiceId);
 const owner=a.owner||brand?.ownerId||deal?.ownerId||i.owner||"T01";
 const cs:Change[]=[];let label="",warning:string|undefined;
 const add=(t:string,r:Row)=>cs.push(change(t,{...r,origin,provenance:"user"}));
 function history(id:string,brandId:string,stage:string,proposed:number,confirmed:number,ownerId:string){add("opportunity_history",{history_id:uid("OH"),opportunity_id:id,brand_id:brandId,stage,proposed_value_inr:proposed,confirmed_value_inr:confirmed,owner_id:ownerId,owner_name:m.owners.find(o=>o.id===ownerId)?.name,effective_at:at,lost_reason:a.reason||null})}
 function milestones(id:string,amount:number){
   if(s.settings.invoiceAutomation===false||s.snap.invoices.some(n=>n.dealId===id))return;
   const split=s.settings.depositPercent??50,first=Math.round(amount*split/100);
   for(const [ix,amountInr,due] of [[1,first,dateAdd(i.asOf,s.settings.paymentLag??15)],[2,amount-first,dateAdd(m.festivalDate,-7)]] as const){if(amountInr>0)add("invoices",{invoice_id:uid("INV"),opportunity_id:id,amount_inr:amountInr,milestone:ix===1?"Deposit":"Balance",issued_at:at,due_at:due+"T17:00:00+05:30",status:"sent"})}
 }
 switch(a.kind){
 case "deal":{if(!brand)throw Error("Select a brand.");const id=uid("O"),value=num(a.value,1);const campaignId=a.campaignId||brand.campaignId||m.campaigns[0]?.id;
 add("opportunities",{opportunity_id:id,brand_id:brand.id,brand_name:brand.name,opportunity_name:a.name||brand.name+" partnership",support_type:a.supportType==="in_kind"?"in_kind":"cash",owner_id:owner,sponsor_campaign_id:campaignId,created_at:at,package_id:a.packageId});
 history(id,brand.id,"prospecting",value,0,owner);label="Opened deal for "+brand.name;break}
 case "stage":{if(!deal||!stages.includes(a.stage))throw Error("Choose a deal and a valid stage.");if(deal.stage===a.stage)throw Error("Choose a different stage.");if(a.stage==="lost")req(a.reason,"Loss reason");
 const value=a.stage==="partner_confirmed"?num(a.value,1):0;history(deal.id,deal.brandId,a.stage,deal.proposedValue,value,deal.ownerId);
 if(a.stage==="partner_confirmed"){
 const packageId=a.packageId||s.additions.opportunities?.find(o=>o.opportunity_id===deal.id)?.package_id;
 if(packageId&&!s.extras.allocations.some(r=>r.dealId===deal.id)){const pkg=packagesSeed.find(p=>p.id===packageId);if(!pkg||s.extras.allocations.filter(r=>r.packageId===pkg.id).length>=pkg.quantity)throw Error("This package is sold out.");add("allocations",{id:uid("asset"),packageId:pkg.id,dealId:deal.id})}
 if(deal.supportType==="cash"){milestones(deal.id,value);if(s.settings.invoiceAutomation!==false)cs.push(task("Send invoice to "+deal.brand,deal.brandId,deal.ownerId,i.asOf,"automation",deal.id))}
 cs.push(task("Review add-on opportunities for "+deal.brand,deal.brandId,deal.ownerId,dateAdd(i.asOf,3),"automation",deal.id));cs.push(task("Ask "+deal.brand+" for two introductions",deal.brandId,deal.ownerId,dateAdd(i.asOf,2),"automation",deal.id))}
 label=deal.brand+" moved to "+title(a.stage);break}
 case "qualification":if(!brand)throw Error("Choose a brand.");if(!["qualified","unreviewed","not_qualified","dormant","under_review","disqualified"].includes(a.status))throw Error("Invalid qualification.");add("brand_qualification_history",{history_id:uid("BQ"),brand_id:brand.id,brand_name:brand.name,qualification_status:a.status,reason:req(a.reason,"Reason"),sponsor_campaign_id:brand.campaignId,effective_at:at});label="Updated qualification for "+brand.name;break;
 case "touch":{if(!brand)throw Error("Choose a brand.");const campaign=m.campaigns.find(c=>c.id===(a.campaignId||brand.campaignId));if(!campaign)throw Error("Choose a campaign.");if(["outreach_sent","follow_up_sent"].includes(a.eventType)&&campaign.status!=="active")throw Error("Outreach is closed for this campaign.");
 if(["outreach_sent","follow_up_sent"].includes(a.eventType)&&campaign.group==="cold"){const prior=m.interactions.filter(x=>x.brand_id===brand.id&&x.sponsor_campaign_id===campaign.id&&["outreach_sent","follow_up_sent"].includes(x.event_type)&&(!a.contactId||x.contact_id===a.contactId)).length;const policy=coldFollowUpPolicy({channel:"cold",previousTouches:prior});if(policy.warning){warning=policy.warning;cs.push(note("Cold touch "+(prior+1)+" to "+brand.name+". "+policy.warning,owner,brand.id))}}add("sponsor_interactions",{interaction_id:uid("SI"),attempt_id:uid("SA"),brand_id:brand.id,sponsor_campaign_id:campaign.id,owner_id:owner,channel:campaign.channel,occurred_at:at,event_type:a.eventType||"meeting_held",outcome:a.outcome||"recorded",summary:req(a.summary,"Touch summary")});if(a.eventType==="replied"&&a.outcome==="positive")cs.push(task("Book meeting with "+brand.name,brand.id,owner,dateAdd(i.asOf,2),"automation"));label="Logged touch for "+brand.name;break}
 case "payment":{if(!invoice)throw Error("Choose an invoice.");const amount=num(a.amount,0.01,invoice.balance),received=date(a.date||i.asOf);if(received>i.asOf||received<invoice.issuedAt.slice(0,10))throw Error("Payment date must fall between invoice issue and the snapshot.");add("payments",{payment_id:uid("PAY"),invoice_id:invoice.id,amount_inr:amount,received_at:received+"T16:00:00+05:30",method:req(a.method||"Bank transfer","Method")});label="Recorded payment from "+invoice.brand;break}
 case "invoice":if(!deal||deal.stage!=="partner_confirmed"||deal.supportType!=="cash")throw Error("Select a confirmed cash deal.");if(m.invoices.filter(n=>n.dealId===deal.id).reduce((v,n)=>v+n.amount,0)+num(a.amount,1)>deal.confirmedValue)throw Error("Invoice exceeds remaining confirmed value.");add("invoices",{invoice_id:uid("INV"),opportunity_id:deal.id,milestone:req(a.milestone||"Milestone","Milestone"),amount_inr:num(a.amount,1),issued_at:at,due_at:date(a.due)+"T17:00:00+05:30",status:"sent"});label="Issued invoice for "+deal.brand;break;
 case "task":cs.push(task(req(a.title,"Task title"),a.brandId||"",owner,date(a.due||i.asOf),a.source||"manual",a.linkedId));label="Created task · "+a.title;break;
 case "taskStatus":if(!s.extras.tasks.some(t=>t.id===a.id))throw Error("Unknown task.");add("tasks",{id:a.id,status:a.done?"Done":"Open"});label=a.done?"Completed task":"Reopened task";break;
 case "campaign":{const c=m.campaigns.find(c=>c.id===a.id);if(!c)throw Error("Unknown campaign.");if(!["active","paused","stopped"].includes(a.status))throw Error("Choose a valid campaign status.");const budget=num(a.budget??c.budget??0);add("sponsor_campaigns",{sponsor_campaign_id:c.id,campaign_name:c.name,channel:c.channel,objective:c.objective,audience:c.audience,created_at:at,effective_at:at,status:a.status,budget_inr:budget,budget_provenance:"user",owner_id:owner,owner_name:m.owners.find(o=>o.id===owner)?.name,planned_start_at:a.start||c.plannedStart,planned_end_at:a.end||c.plannedEnd,updated_at:at});label="Updated "+c.name;break}
 case "settings":{const bounds:Record<string,[number,number]>={stalledDays:[0,180],qualifiedDays:[0,30],replyDays:[0,30],meetingDays:[0,30],invoiceDays:[0,30],payRate:[0,1],paymentLag:[0,90],depositPercent:[1,99],stopAttempts:[1,500],positiveThreshold:[0,1],scaleWinRate:[0,1],discountCeiling:[0,30],coldCap:[0,100],cashTarget:[1,1e9]};for(const [key,value] of Object.entries(a.values||{})){if(key in bounds)add("settings",{key,value:num(value,...bounds[key])});else if(["callsEnabled","invoiceAutomation","stalledAutomation","leakAutomation"].includes(key))add("settings",{key,value:value===true});else throw Error("Unknown setting.")}label="Updated workspace settings";break}
 case "rule":{const rules=s.extras.rules||[];
  if(a.delete){if(!rules.some(r=>r.id===a.id))throw Error("Unknown rule.");cs.push(change("rules",{id:a.id,deleted:true}));label="Deleted automation rule";break}
  if(a.id&&typeof a.enabled==="boolean"&&!a.trigger){if(!rules.some(r=>r.id===a.id))throw Error("Unknown rule.");cs.push(change("rules",{id:a.id,enabled:a.enabled}));label=(a.enabled?"Enabled":"Paused")+" automation rule";break}
  if(!RULE_TRIGGERS[a.trigger])throw Error("Choose a trigger.");if(!["","warm","cold"].includes(a.group||""))throw Error("Choose a channel group.");
  cs.push(change("rules",{id:uid("rule"),trigger:a.trigger,group:a.group||"",minValue:num(a.minValue||0,0,1e9),title:req(a.title,"Task title").slice(0,120),dueDays:num(a.dueDays??0,0,60),notify:a.notify===true||a.notify==="on",enabled:true,createdBy:i.owner||"T01"}));label="Saved automation rule";break}
 case "target":add("targets",{effective_at:at,confirmed_partnerships_goal:num(a.confirmed,1,10000),qualified_brands_goal:num(a.qualified,1,10000),target_version:"Team revision"});label="Revised partnership targets";break;
 case "read":for(const n of s.extras.notifications.filter(n=>!n.read&&n.owner===i.owner&&(!a.id||n.id===a.id)))add("notifications",{id:n.id,read:true});label="Read notifications";break;
 case "alertTasks":{const rule=m.leakage.find(r=>r.key===a.rule);const rows=a.rule==="stalled"?m.stalled:rule?.records;if(!rows)throw Error("Unknown alert rule.");for(const r of rows){const title=(rule?.label||"Follow up on stalled deal")+" · "+r.brand;if((!Array.isArray(a.ids)||a.ids.includes(r.id))&&!s.extras.tasks.some(t=>t.title===title&&t.linkedId===r.id))cs.push(task(title,r.brandId,r.ownerId,i.asOf,"alert",r.id))}label="Created alert follow-up tasks";break}

 default:throw Error("Unknown workspace action.");
 }
 const fired:{trigger:string;brandId:string;brand:string;owner:string;group:string;value:number;linkedId:string}[]=[];
 if(a.kind==="stage"&&deal){const ev={brandId:deal.brandId,brand:deal.brand,owner:deal.ownerId,group:deal.group,linkedId:deal.id};fired.push({...ev,trigger:"stage_changed",value:deal.proposedValue||0});if(a.stage==="partner_confirmed")fired.push({...ev,trigger:"deal_confirmed",value:Number(a.value)||0});if(a.stage==="lost")fired.push({...ev,trigger:"deal_lost",value:deal.proposedValue||0})}
 if(a.kind==="touch"&&brand&&a.eventType==="replied"&&a.outcome==="positive")fired.push({trigger:"positive_reply",brandId:brand.id,brand:brand.name,owner,group:m.campaigns.find(c=>c.id===(a.campaignId||brand.campaignId))?.group||"",value:0,linkedId:brand.id});
 if(a.kind==="payment"&&invoice){const d=m.deals.find(x=>x.id===invoice.dealId);fired.push({trigger:"payment_recorded",brandId:invoice.brandId,brand:d?.brand||invoice.brandId,owner:d?.ownerId||owner,group:d?.group||"",value:Number(a.amount)||0,linkedId:invoice.id})}
 for(const ev of fired)for(const r of (s.extras.rules||[]).filter(r=>r.enabled!==false&&r.trigger===ev.trigger&&(!r.group||r.group===ev.group)&&ev.value>=(r.minValue||0))){const t=String(r.title).replaceAll("{brand}",ev.brand);cs.push(task(t,ev.brandId,ev.owner,dateAdd(i.asOf,r.dueDays||0),"automation",ev.linkedId));if(r.notify)cs.push(note("Automation rule: "+t,ev.owner,ev.brandId))}
 return {label,entity:a.brandId||deal?.brandId||invoice?.brandId||a.id||"",changes:cs,warning}
}
