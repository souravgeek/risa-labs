"use client";
import React,{useState} from "react";
import {Plus,Trash2} from "lucide-react";
import {useDesk,type R} from "./context";
import {Panel,Tag,Field} from "./common";
import {RULE_TRIGGERS,rupees} from "@/lib/shared";

/** Trigger → condition → action rules. Each rule runs after a matching save and creates a task. */
export function RuleBuilder(){
 const {data,act,busy}=useDesk();const rules:R[]=data.extras.rules||[];
 const [adding,setAdding]=useState(false);
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));if(await act({kind:"rule",...f,notify:f.notify==="on"}))setAdding(false)}
 return <Panel title="Rule builder" kicker="Automations" action={!adding&&<button className="btn" disabled={busy} onClick={()=>setAdding(true)}><Plus size={14}/>New rule</button>}>
  <div className="padded">
   {adding&&<form onSubmit={save} className="rule-form">
    <div className="form-grid">
     <Field label="When"><select name="trigger" required defaultValue="deal_confirmed">{Object.entries(RULE_TRIGGERS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
     <Field label="Only for channel group"><select name="group" defaultValue=""><option value="">Any</option><option value="warm">Warm</option><option value="cold">Cold</option></select></Field>
     <Field label="Minimum value (₹)"><input name="minValue" type="number" min="0" step="1000" defaultValue="0"/></Field>
     <Field label="Due in (days)"><input name="dueDays" type="number" min="0" max="60" defaultValue="2" required/></Field>
    </div>
    <Field label="Create task titled ({brand} is replaced)"><input name="title" required maxLength={120} defaultValue="Send a thank-you note to {brand}"/></Field>
    <label className="switch-row"><span>Also notify the record owner</span><input type="checkbox" name="notify"/></label>
    <div className="tools"><button className="btn primary" disabled={busy}>Save rule</button><button type="button" className="btn" onClick={()=>setAdding(false)}>Cancel</button></div>
   </form>}
   {rules.length===0&&!adding&&<p className="hint">No custom rules yet. Rules run after each save and assign the task to the record's owner.</p>}
   {rules.map(r=><div className="switch-row" key={r.id}>
    <span><b>{RULE_TRIGGERS[r.trigger]||r.trigger}</b>{r.group?" · "+r.group:""}{r.minValue?" · ≥ "+rupees(r.minValue):""} → “{r.title}” in {r.dueDays}d{r.notify?" + notify":""} {r.enabled===false&&<Tag>Paused</Tag>}</span>
    <span className="tools"><input type="checkbox" aria-label="Rule enabled" checked={r.enabled!==false} disabled={busy} onChange={e=>act({kind:"rule",id:r.id,enabled:e.target.checked})}/><button className="btn" aria-label="Delete rule" disabled={busy} onClick={()=>act({kind:"rule",id:r.id,delete:true})}><Trash2 size={14}/></button></span>
   </div>)}
  </div>
 </Panel>
}
