'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Headphones, MessageSquareText, Mic, PhoneCall, PhoneOff, Plus, Trash2, UserPlus } from 'lucide-react';
import { Button, Empty, Field, Panel, Sheet, Table, Tag } from './common';
import { useDesk, type R } from './context';
import { niceDate, rupees, title } from '@/lib/shared';
import { DISCLOSURE, type CallPurpose, type Utterance } from '@/lib/voice-types';
import { PhoneCall as PhoneCallScreen } from './phone-call';
import { audioContext } from '@/lib/phone-audio';
import './calls.css';

type Choice={id:string;name:string;purposes:CallPurpose[]};
type RequestCall=(body:R)=>Promise<R>;
function useCallApi(){
  const {season,asOf,owner}=useDesk();
  return useCallback(async(body:R)=>{
    const res=await fetch('/api/calls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,season,asOf,owner})});
    const payload=await res.json(); if(!res.ok)throw new Error(payload.error||'The call service is unavailable.');return payload;
  },[season,asOf,owner]);
}
function useEligible(api:RequestCall) {
  const [choices,setChoices]=useState<Choice[]>([]),[gemini,setGemini]=useState(false),[enabled,setEnabled]=useState(true),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let stale=false;setLoading(true);setError('');
    api({kind:'eligible'}).then(v=>{if(!stale){setChoices(v.brands);setGemini(v.gemini);setEnabled(v.enabled);}})
    .catch(e=>{if(!stale)setError(e.message);}).finally(()=>{if(!stale)setLoading(false);});
    return ()=>{stale=true;};
  },[api]);
  return {choices,gemini,enabled,error,loading};
}
const errText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong.';
function Failure({message}:{message:string}) {return message?<p className="call-error" role="alert">{message}</p>:null;}
const fieldLabels:Record<string,string>={outcome:'Outcome',interest:'Interest (1–5)',budgetMin:'Budget minimum',budgetMax:'Budget maximum',decisionMaker:'Decision-maker',objections:'Objections',nextStep:'Next step',nextStepDate:'Next step date',paymentDate:'Promised payment date',paymentAmount:'Promised amount',optOut:'Opt-out',confidence:'Confidence'};
function formatValue(k:string,v:unknown){if(v===null||v===undefined)return 'Unknown';if(['budgetMin','budgetMax','paymentAmount'].includes(k))return rupees(Number(v));if(Array.isArray(v))return v.map(title).join(', ');return typeof v==='boolean'?(v?'Yes':'No'):String(v);}
function Evidence({call}:{call:R}){
  const fields=call.insights?.fields || {};
  const rows=Object.entries(fields).filter(([,v])=>v && (v as R).value!=null) as [string,R][];
  return <><div className="call-meta"><Tag>{call.insights?.mode==='fixture'?'Scripted demo':'Gemini'}</Tag><Tag tone={call.insights?.disclosurePresent?'green':'orange'}>{call.insights?.disclosurePresent?'AI disclosure verified':'Disclosure unverified'}</Tag></div>
    {rows.length?<dl className="call-evidence">{rows.map(([k,o])=><div key={k}><dt>{fieldLabels[k]||title(k)}</dt><dd>{formatValue(k,o.value)}{o.quote&&<q>{o.quote}</q>}</dd></div>)}</dl>:<Empty text="No supported sponsor fields were extracted from this conversation."/>}
    <details className="call-transcript"><summary>Transcript · {call.transcript?.length||0} segments</summary>{(call.transcript||[]).map((turn:Utterance,idx:number)=><p key={idx}><b>{turn.speaker==='agent'?'Unmaad AI':'Sponsor'}</b>{turn.text}</p>)}</details></>;
}
function Review({call,onDone}:{call:R;onDone:()=>void}){
  const api=useCallApi(),{refresh}=useDesk();const [working,setWorking]=useState(false),[error,setError]=useState('');
  async function review(decision:string){setWorking(true);try{await api({kind:'review',callId:call.id,decision});await refresh();onDone();}catch(e){setError(errText(e));}finally{setWorking(false);}}
  const f=call.insights?.fields||{};
  const proposed: string[]=[];
  const agentPromise=[...(call.toolProposals||[])].reverse().find((x:R)=>x.name==='log_payment_promise'),follow=[...(call.toolProposals||[])].reverse().find((x:R)=>x.name==='schedule_follow_up');
  if(call.invoiceId && f.paymentDate?.value && f.paymentAmount?.value)proposed.push('Set the expected payment date to '+niceDate(f.paymentDate.value,true)+' for '+rupees(f.paymentAmount.value)+'.');
  else if(call.invoiceId && agentPromise)proposed.push('Set the expected payment date to '+niceDate(agentPromise.date,true)+' for '+rupees(agentPromise.amount)+' (agreed with the agent on the call).');
  if(follow && f.nextStepDate?.value!==follow.date)proposed.push('Create a follow-up task for '+niceDate(follow.date,true)+(follow.reason?': '+follow.reason:'')+'.');
  if(call.purpose==='inbound lead' && f.decisionMaker?.value==='yes' && Number(f.interest?.value)>=4 && f.optOut?.value!==true)proposed.push('Qualify this brand based on its stated interest and buying authority.');
  return <><Evidence call={call}/>{call.review==='pending'&&<div className="call-review"><b>{proposed.length?'Proposed updates':'Review call evidence'}</b>{proposed.map(p=><p key={p}>{p}</p>)}<p>{proposed.length?'Approving applies these changes to the workspace.':'The follow-up task and call interaction have been logged.'}</p><div className="call-actions"><Button className="btn primary" disabled={working} onClick={()=>review('approve')}><CheckCircle2 size={16}/>{proposed.length?'Approve updates':'Mark reviewed'}</Button><Button className="btn" variant="outline" disabled={working} onClick={()=>review('reject')}>Dismiss</Button></div></div>}<Failure message={error}/></>;
}
function ContactFields({choices,initialBrand,after,cancel}:{choices:Choice[];initialBrand?:string;after:(id:string,brand:string,purpose:CallPurpose)=>void;cancel?:()=>void}){
  const api=useCallApi(),{refresh}=useDesk();
  const [brandId,setBrand]=useState(choices.find(b=>b.id===initialBrand)?.id||choices[0]?.id||''),[purpose,setPurpose]=useState<CallPurpose|''>(''),[name,setName]=useState(''),[role,setRole]=useState('self'),[language,setLanguage]=useState('English'),[consent,setConsent]=useState(false),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const brand=choices.find(b=>b.id===brandId),chosen=brand?.purposes.includes(purpose as CallPurpose)?purpose:brand?.purposes[0];
  async function submit(e:React.FormEvent){e.preventDefault();if(!chosen)return;setWorking(true);try{const r=await api({kind:'addContact',name,role,language,brandId,purpose:chosen,consent});await refresh();after(r.id,brandId,chosen);}catch(e){setError(errText(e));}finally{setWorking(false);}}
  if(!choices.length)return <Empty text="No warm sponsorship records qualify for a call at this snapshot."/>;
  return <form className="call-form" onSubmit={submit}>
    <Field label="Display name or alias"><input maxLength={60} required value={name} placeholder="e.g. Priya" onChange={e=>setName(e.target.value)}/></Field>
    <div className="call-field-pair"><Field label="Demo role"><select value={role} onChange={e=>setRole(e.target.value)}>{['self','teammate','interviewer'].map(v=><option key={v} value={v}>{title(v)}</option>)}</select></Field><Field label="Language"><select value={language} onChange={e=>setLanguage(e.target.value)}><option>English</option><option>Hinglish</option></select></Field></div>
    <Field label="Representing brand"><select value={brandId} onChange={e=>setBrand(e.target.value)}>{choices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
    <Field label="Call purpose"><select value={chosen||''} onChange={e=>setPurpose(e.target.value as CallPurpose)}>{brand?.purposes.map(p=><option key={p} value={p}>{title(p)}</option>)}</select></Field>
    <label className="call-consent"><input type="checkbox" checked={consent} required onChange={e=>setConsent(e.target.checked)}/>This person agreed to participate in this AI call demo and have the transcript saved for review.</label>
    <div className="call-actions"><Button type="submit" className="btn primary" disabled={working||!consent||!name.trim()}><UserPlus size={15}/>{working?'Saving…':'Save demo contact'}</Button>{cancel&&<Button type="button" className="btn" variant="outline" disabled={working} onClick={cancel}>Cancel</Button>}</div><Failure message={error}/>
  </form>;
}

export function CallDialog({brandId:initialBrand,close}:{brandId?:string;close:()=>void}){
  const {data,refresh}=useDesk(),api=useCallApi(),available=useEligible(api);
  const [brandId,setBrand]=useState(initialBrand||''),[contactId,setContact]=useState(''),[mode,setMode]=useState('phone'),[phone,setPhone]=useState<R|null>(null),[adding,setAdding]=useState(false),[brief,setBrief]=useState<R|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[running,setRunning]=useState(false),[result,setResult]=useState<R|null>(null),[turns,setTurns]=useState<Utterance[]>([]);
  const pending=useRef<AbortController|null>(null),live=useRef<{stop:()=>void}|null>(null),finish=useRef<(()=>Promise<void>)|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;pending.current?.abort();live.current?.stop();};},[]);
  const selected=brandId||available.choices.find(b=>data.extras.allowlist.some((c:R)=>c.brandId===b.id && c.active))?.id||available.choices[0]?.id;
  const eligible=available.choices.find(b=>b.id===selected);
  const contacts=(data.extras.allowlist||[]).filter((c:R)=>c.active && c.consent && c.brandId===selected && eligible?.purposes.includes(c.purpose));
  const selectedContact=contacts.find((c:R)=>c.id===contactId)||contacts[0];
  const previewArgs={brandId:selected,contactId:selectedContact?.id,purpose:selectedContact?.purpose};
  async function preview(){setError('');setWorking(true);try{setBrief((await api({kind:'preview',...previewArgs})).brief);}catch(e){setError(errText(e));}finally{setWorking(false);}}
  async function start(){
    setWorking(true);setError('');
    if(mode==='phone')audioContext(); // unlock audio inside this click so the agent can speak
    const controller=new AbortController();pending.current=controller;
    let sessionInfo:R|undefined;
    try {
      const r=await api({kind:'start',...previewArgs,mode,confirm:true});
      sessionInfo=r;
      if(mode==='phone'){
        const auth={callId:r.id,sessionKey:r.sessionKey};let done=false;
        const end=async()=>{
          if(done)return;done=true;
          try{const completed=await api({kind:'finish',...auth});await refresh();
            if(alive.current){setRunning(false);setPhone(null);if(completed.insights)setResult({...completed,...previewArgs,transcript:[],review:'pending',brand:brief?.brand,invoiceId:previewArgs.purpose==='payment reminder'?'preview':null});else close();}
          }catch(e){if(alive.current){done=false;setError(errText(e));}}
        };
        live.current={stop:()=>{void end();}};finish.current=end;
        setPhone({...auth,opening:r.turn.text,engine:r.engine,end});setRunning(true);return;
      }
      if(mode==='simulated'){await refresh();if(alive.current)setResult({...r,...previewArgs,review:'pending',brand:brief?.brand,invoiceId:previewArgs.purpose==='payment reminder'?'preview':null});return;}
      const auth={callId:r.id,sessionKey:r.sessionKey};
      let done=false;
      const end=async()=>{
        if(done)return;done=true;
        try {const completed=await api({kind:'finish',...auth});await refresh();
          if(alive.current){setRunning(false);if(completed.insights)setResult({...completed,...previewArgs,transcript:[],review:'pending',brand:brief?.brand,invoiceId:previewArgs.purpose==='payment reminder'?'preview':null});else close();}
        }catch(e){if(alive.current){done=false;setError(errText(e));setRunning(false);}}
      };
      finish.current=end;
      const voice=await import('@/lib/voice-client');
      if(controller.signal.aborted){await end();return;}
      const connection=await voice.startBrowserVoice({credentials:r.credentials,signal:controller.signal,
        onTranscript:async turn=>{const chunkId=crypto.randomUUID();await api({kind:'transcript',...auth,turn,chunkId});if(alive.current)setTurns(prev=>[...prev,turn]);},
        onTool:async(name,args)=>(await api({kind:'tool',...auth,name,args})).output,
        onEnd:()=>{void end();},onError:msg=>{if(alive.current)setError(msg);}});
      live.current=connection;if(alive.current)setRunning(true);
    }catch(e){
      if((mode==='browser'||mode==='phone') && sessionInfo?.sessionKey)await api({kind:'finish',callId:sessionInfo.id,sessionKey:sessionInfo.sessionKey}).catch(()=>undefined);
      if(alive.current)setError(errText(e));
    } finally{if(alive.current)setWorking(false);}
  }
  const leave=()=>{if(running)live.current?.stop();else{pending.current?.abort();close();}};
  const shown=result && (data.extras.calls.find((x:R)=>x.id===result.id)||result);
  return <Sheet title={shown?'Call insights':running?(phone?'Phone call':'Browser voice'):adding?'Add demo contact':brief?'Confirm call brief':'Start a demo call'} close={leave}><div className="call-body">
    {shown?<Review call={{...shown,transcript:shown.transcript?.length?shown.transcript:turns}} onDone={close}/>:running&&phone?<PhoneCallScreen call={{callId:phone.callId,sessionKey:phone.sessionKey}} brand={brief?.brand||''} contact={selectedContact?.name||'Demo contact'} purpose={brief?.purpose||''} callDate={brief?.callDate} opening={phone.opening} gemini={available.gemini} onHangUp={phone.end}/>:running?<><div className="call-live"><Mic size={22}/><b>Connected to {brief?.brand}</b></div>{turns.slice(-4).map((t,j)=><p key={j}><b>{title(t.speaker)}</b> · {t.text}</p>)}<Button className="btn primary" onClick={()=>live.current?.stop()}><PhoneOff size={15}/>Hang up and review</Button></>:available.loading?<p>Loading eligible records…</p>:adding?<ContactFields choices={available.choices} initialBrand={selected} after={(id,brand)=>{setContact(id);setBrand(brand);setAdding(false);}} cancel={()=>setAdding(false)}/>:brief?<><div className="call-meta"><Tag>{mode==='phone'?(available.gemini?'Phone call · Gemini':'Phone call · scripted agent'):mode==='browser'?'Browser voice':available.gemini?'Gemini simulation':'Scripted demo'}</Tag><Tag>{title(brief.purpose)}</Tag></div><h3>{brief.brand}</h3><p>Demo participant · <b>{selectedContact?.name}</b></p>{brief.callDate&&<p className="call-dates">Call date <b>{niceDate(brief.callDate,true)}</b> (today) · deal records as of <b>{niceDate(brief.asOf,true)}</b></p>}<dl className="call-brief">{Object.entries(brief.facts||{}).map(([k,v])=><div key={k}><dt>{({daysInStage:'Days in stage',dueDate:'Invoice due',lastTouch:'Last touch'} as R)[k]||title(k)}</dt><dd>{['value','outstanding'].includes(k)?rupees(Number(v)):['lastTouch','dueDate'].includes(k)?niceDate(String(v),true):title(v)}</dd></div>)}</dl><p className="call-disclosure">{DISCLOSURE}</p><div className="call-actions"><Button className="btn primary" disabled={working} onClick={start}><PhoneCall size={16}/>{working?'Starting…':'Confirm and start'}</Button><Button className="btn" variant="outline" disabled={working} onClick={()=>setBrief(null)}>Back</Button></div></>:<div className="call-form">
      <Field label="Eligible brand"><select value={selected||''} onChange={e=>{setBrand(e.target.value);setContact('');}}>{initialBrand&&!available.choices.some(b=>b.id===initialBrand)&&<option value={initialBrand}>{data.brands.find((b:R)=>b.id===initialBrand)?.name||initialBrand} · ineligible</option>}{available.choices.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></Field>
      {eligible?<><Field label="Consenting demo contact"><select value={selectedContact?.id||''} onChange={e=>setContact(e.target.value)}>{!contacts.length&&<option value="">Choose a participant</option>}{contacts.map((c:R)=><option key={c.id} value={c.id}>{c.name} · {title(c.purpose)}</option>)}</select></Field><Button className="btn" variant="outline" onClick={()=>setAdding(true)}><UserPlus size={15}/>Add a participant</Button></>:<Empty text="This brand has no eligible stalled deal, inbound lead, or unpaid invoice due within seven days."/>}
      <Field label="Call mode"><select value={mode} onChange={e=>setMode(e.target.value)}><option value="phone">Phone call · you play the sponsor</option><option value="simulated">{available.gemini?'Simulated conversation · Gemini':'Simulated conversation · scripted demo'}</option><option value="browser" disabled={!available.gemini}>Browser voice{available.gemini?'':' · Gemini key required'}</option></select></Field>
      {mode==='phone'?<small>The agent pitches and you answer as the sponsor, by voice or by typing. {available.gemini?'Gemini writes every reply.':'Without a Gemini key a scripted agent asks the questions.'}</small>:!available.gemini&&<small>The scripted demo works offline. A server Gemini key enables live voice and generated conversations.</small>}
      {!available.enabled&&<p className="call-error">The call agent is turned off in Settings.</p>}
      <Button className="btn primary" disabled={working||!selectedContact||!eligible||!available.enabled} onClick={preview}>Review call brief</Button>
    </div>}<Failure message={error||available.error}/></div></Sheet>;
}

export function CallsPage(){
  const {data,refresh}=useDesk(),api=useCallApi(),available=useEligible(api);
  const [start,setStart]=useState(false),[add,setAdd]=useState(false),[review,setReview]=useState(''),[remove,setRemove]=useState<R|null>(null),[deleting,setDeleting]=useState(false),[error,setError]=useState('');
  const calls:R[]=(data.extras.calls||[]).slice().reverse(),contacts:R[]=data.extras.allowlist||[];
  const completed=calls.filter(c=>c.status==='completed'),pending=completed.filter(c=>c.review==='pending');
  const found=calls.find(c=>c.id===review);
  const outcomes=new Map<string,number>(),objections=new Map<string,number>(),purposes=new Map<string,number>();
  let dated=0,kept=0,promised=0;
  for(const c of completed){const f=c.insights?.fields||{},outcome=String(f.outcome?.value||'Unknown');
    outcomes.set(outcome,(outcomes.get(outcome)||0)+1);purposes.set(c.purpose,(purposes.get(c.purpose)||0)+1);
    if(f.nextStepDate?.value)dated++;
    for(const o of (Array.isArray(f.objections?.value)?f.objections.value:[]))objections.set(o,(objections.get(o)||0)+1);
    if(c.review==='approved' && c.invoiceId && typeof f.paymentDate?.value==='string' && Number(f.paymentAmount?.value)>0) {
      promised++;const paid=data.payments.filter((p:R)=>p.invoiceId===c.invoiceId && p.receivedAt?.slice(0,10)>=c.brief.asOf && p.receivedAt?.slice(0,10)<=f.paymentDate.value).reduce((sum:number,p:R)=>sum+Number(p.amount||0),0);
      if(paid>=Number(f.paymentAmount.value))kept++;
    }
  }
  return <div className="call-page">
    <div className="call-summary"><div><Headphones size={20}/><b>{completed.length}</b><span>Completed calls</span></div><div><MessageSquareText size={20}/><b>{pending.length}</b><span>Awaiting review</span></div><div><CheckCircle2 size={20}/><b>{completed.length?Math.round(100*dated/completed.length)+'%':'—'}</b><span>Dated next steps</span></div><div><PhoneCall size={20}/><b>{kept} / {promised}</b><span>Payment promises kept</span></div></div>
    <Panel title="Call history" action={<Button className="btn primary" disabled={!available.enabled} onClick={()=>setStart(true)}><PhoneCall size={16}/>Start a call</Button>}>
      {calls.length?<Table rows={calls} onRow={r=>setReview(r.id)} columns={[{key:'brand',label:'Brand'},{key:'purpose',label:'Purpose',render:r=>title(r.purpose)},{key:'mode',label:'Mode',render:r=>r.mode==='browser'?'Browser voice':r.mode==='phone'?'Phone call':'Simulated text'},{key:'status',label:'Status',render:r=><Tag tone={r.review==='pending'?'orange':'muted'}>{r.review==='pending'?'Needs review':title(r.status)}</Tag>},{key:'startedAt',label:'Started',render:r=>niceDate(r.startedAt,true)}]}/>:<Empty text="Start a consented demo call to see its transcript, evidence, and follow-up here."/>}
    </Panel>
    <Panel title="Demo contacts" action={<Button className="btn" variant="outline" onClick={()=>setAdd(true)}><Plus size={16}/>Add contact</Button>}>
      {contacts.length?<Table rows={contacts} search={false} columns={[{key:'name',label:'Participant'},{key:'brandId',label:'Brand',render:c=>data.brands.find((b:R)=>b.id===c.brandId)?.name||c.brandId},{key:'purpose',label:'Agreed purpose',render:c=>title(c.purpose)},{key:'active',label:'Consent',render:c=><Tag tone={c.active?'green':'muted'}>{c.active?'Active':'Opted out'}</Tag>},{key:'id',label:'Manage',render:c=><button className="iconbtn" aria-label={'Delete '+c.name} onClick={()=>{setError('');setRemove(c);}}><Trash2 size={16}/></button>}]}/>:<Empty text="Add yourself or a teammate who has agreed to play a sponsor. Calls are limited to 09:00–20:00 IST."/>}
    </Panel>
    {completed.length>0&&<Panel title="Conversation patterns" action={completed.length<10?<Tag>Directional</Tag>:undefined}><div className="call-breakdown">{[['Purpose',purposes],['Outcome',outcomes],['Objection',objections]].map(([label,map])=><div key={String(label)}><h3>{String(label)}</h3>{Array.from((map as Map<string,number>).entries()).sort((a,b)=>b[1]-a[1]).map(([key,val])=><p key={key}><span>{title(key)}</span><b>{val}</b></p>)}</div>)}</div></Panel>}
    {start&&<CallDialog close={()=>setStart(false)}/>}
    {add&&<Sheet title="Add demo contact" close={()=>setAdd(false)}><div className="call-body">{available.loading?<p>Loading eligible brands…</p>:<ContactFields choices={available.choices} after={()=>setAdd(false)}/>}<Failure message={available.error}/></div></Sheet>}
    {found&&<Sheet title={found.brand+' · call review'} close={()=>setReview('')}><div className="call-body">{found.insights?<Review call={found} onDone={()=>setReview('')}/>:<Empty text={'Call status: '+title(found.status)+'. There are no reviewable insights.'}/>}</div></Sheet>}
    {remove&&<Sheet title="Delete demo contact" close={()=>setRemove(null)}><div className="call-body"><p>Delete {remove.name} and erase their saved call transcripts and insights from every snapshot?</p><div className="call-actions"><Button className="btn primary" disabled={deleting} onClick={async()=>{setDeleting(true);try{await api({kind:'removeContact',contactId:remove.id});await refresh();setRemove(null);}catch(e){setError(errText(e));}finally{setDeleting(false);}}}>Delete contact and transcripts</Button><Button variant="outline" className="btn" onClick={()=>setRemove(null)}>Cancel</Button></div><Failure message={error}/></div></Sheet>}
  </div>;
}
