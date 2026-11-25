import {commit,change,task,note,type Input} from "./workspace";
import type {Change} from "./storage";
import {dateAdd,rupees} from "./shared";
export function istDate(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(now)}
export async function runAutomations(i:Input,morning=false){
 if(i.season!=="2026"||i.asOf!==istDate())throw Error("Scheduled rules run on the current live-season date.");
 await commit(i,s=>{const m=s.snap,changes:Change[]=[],keys=new Set(s.extras.tasks.map(t=>t.ruleKey));function add(key:string,title:string,brand:string,owner:string,linked:string,notify=false){if(keys.has(key))return;const t=task(title,brand,owner,i.asOf,"automation",linked);t.row.ruleKey=key;changes.push(t);if(notify)changes.push(note(title,owner,brand));keys.add(key)}
 if(s.settings.stalledAutomation!==false)for(const d of m.stalled)add("stall/"+d.id+"/"+d.stage,"Follow up with "+d.brand,d.brandId,d.ownerId,d.id,true);
 if(s.settings.leakAutomation!==false)for(const b of m.leakage[0].records)add("leak/"+b.id,"Create deal for "+b.brand,b.brandId,b.ownerId,b.id);
 for(const n of m.invoices.filter(n=>n.balance>0&&n.dueAt.slice(0,10)<=dateAdd(i.asOf,3)))add("due/"+n.id,"Remind "+n.brand+" about "+n.milestone,n.brandId,n.ownerId,n.id);
 if(morning)for(const o of m.owners){const key="brief/"+i.asOf+"/"+o.id;if(s.extras.notifications.some(n=>n.key===key))continue;const opp=m.moneyList.find(r=>r.ownerId===o.id);changes.push(change("notifications",{id:key,key,owner:o.id,read:false,message:o.open+" open deals · "+o.stalled+" stalled. "+(opp?"Prioritize "+opp.brand+" ("+rupees(opp.expectedCash)+" expected).":"Review upcoming invoices.")}))}
 return {changes,label:morning?"Delivered morning briefs and checked follow-ups":"Checked live-season follow-ups"}
 },"Automation")
}
