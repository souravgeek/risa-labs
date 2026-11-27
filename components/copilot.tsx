"use client";
import React,{useEffect,useRef,useState} from "react";
import {ArrowUp,Sparkles,Plus,Check,Copy,ChevronRight,CircleAlert,ListChecks,TrendingDown,CalendarCheck,Info} from "lucide-react";
import {useDesk,type R} from "./context";
import {Sheet,Tag} from "./common";
import {niceDate} from "@/lib/shared";

const STARTERS=[
 {q:"Why are we behind on partnerships?",hint:"Pacing, stalled deals and leakage",icon:TrendingDown},
 {q:"What should we do this week?",hint:"Priorities drawn from the records",icon:CalendarCheck},
 {q:"Preview the action plan",hint:"Review it before anything changes",icon:ListChecks},
];
type Step={label:string;at:number};

/** Reads the copilot's NDJSON stream: progress steps first, then one result (or an error). */
async function readStream(body:ReadableStream<Uint8Array>,onStep:(label:string)=>void):Promise<R>{
 const reader=body.getReader(),decoder=new TextDecoder();let buffer="",result:R|undefined;
 for(;;){
  const {done,value}=await reader.read();
  if(value)buffer+=decoder.decode(value,{stream:true});
  let end:number;
  while((end=buffer.indexOf("\n"))>=0){
   const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;
   const event=JSON.parse(line);
   if(event.type==="step")onStep(event.label);else if(event.type==="error")throw Error(event.error);else if(event.type==="result")result=event;
  }
  if(done)break;
 }
 if(!result)throw Error("The connection closed before an answer arrived. Try again.");
 return result;
}

function Mark({active=false,large=false}:{active?:boolean;large?:boolean}){
 return <span className={"bot-mark"+(active?" active":"")+(large?" lg":"")} aria-hidden>{active&&<i className="bot-ring"/>}<Sparkles size={large?22:14}/></span>;
}

/** Shown while the copilot works: real progress steps from the server, an elapsed timer and a placeholder answer. */
function Thinking({steps,started}:{steps:Step[];started:number}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(t)},[]);
 const secs=Math.max(0,Math.floor((now-started)/1000)),done=steps.slice(0,-1).slice(-4),current=steps.at(-1)?.label||"Thinking";
 return <article className="msg bot" aria-live="polite" aria-busy="true"><Mark active/><div className="msg-body"><div className="bubble thinking">
  {done.length>0&&<ol className="think-steps">{done.map(s=><li key={s.at+s.label}><Check size={12}/>{s.label}</li>)}</ol>}
  <div className="think-head"><span className="dots"><i/><i/><i/></span><span className="think-label" key={current}>{current}</span>{secs>=2&&<span className="think-time">{secs}s</span>}</div>
  <div className="skeleton" aria-hidden><i/><i/><i/></div>
  {secs>=15&&<p className="think-note">Thank you for your patience. On the trial plan, replies can take a little longer when Gemini is busy.</p>}
 </div></div></article>;
}

function CopyButton({text}:{text:string}){
 const [done,setDone]=useState(false);
 return <button type="button" className="msg-action" aria-label="Copy answer" onClick={()=>{navigator.clipboard?.writeText(text).then(()=>{setDone(true);setTimeout(()=>setDone(false),1400)}).catch(()=>{})}}>{done?<Check size={13}/>:<Copy size={13}/>}{done?"Copied":"Copy"}</button>;
}

function Answer({m,proposal,busy,decide}:{m:R;proposal?:R;busy:boolean;decide:(b:R)=>void}){
 const r=m.reply||{},evidence:R[]=r.evidence||[],assumptions:string[]=r.assumptions||[],unverified:string[]=r.unverifiedNumbers||[];
 return <article className="msg bot"><Mark/><div className="msg-body"><div className="bubble">
  <p className="answer">{m.content}</p>
  {r.missingData?.length>0&&<p className="note"><Info size={14}/><span><b>Not in the records.</b> {r.missingData.join(" ")}</span></p>}
  {proposal&&<div className="proposal-card"><b>{proposal.actions.length} proposed actions</b><ul>{proposal.actions.map((a:R,j:number)=><li key={j}>{a.description}</li>)}</ul>
   {proposal.status==="proposed"?<div className="proposal-actions"><button disabled={busy} className="btn primary" onClick={()=>decide({decision:"confirm",proposalId:proposal.id,asOf:proposal.asOf})}><Check size={14}/>Confirm actions</button><button disabled={busy} className="btn" onClick={()=>decide({decision:"reject",proposalId:proposal.id,asOf:proposal.asOf})}>Reject</button></div>:<Tag tone={proposal.status==="confirmed"?"green":"muted"}>{proposal.status}</Tag>}</div>}
  {(evidence.length>0||assumptions.length>0||unverified.length>0)&&<details className="evidence"><summary><ChevronRight size={13}/>Evidence{evidence.length?" · "+evidence.length:""}{assumptions.length?" and assumptions":""}</summary>
   {evidence.length>0&&<dl>{evidence.map((e,j)=><div key={j}><dt>{e.metric}</dt><dd>{e.value}</dd></div>)}</dl>}
   {assumptions.map(a=><p key={a}>{a}</p>)}
   {unverified.length>0&&<p className="warn">Unverified quantities: {unverified.join(", ")}</p>}
  </details>}
 </div><div className="msg-meta"><span>{r.engine||"Copilot"}{r.asOf?" · as of "+niceDate(r.asOf,true):""}</span><CopyButton text={m.content}/></div></div></article>;
}

export function Copilot({close}:{close:()=>void}){
 const x=useDesk();
 const [id,setId]=useState(x.data.extras.threads.at(-1)?.id||""),[q,set]=useState(""),[busy,wait]=useState(false),[error,err]=useState("");
 const [local,setLocal]=useState<{id:string;messages:R[];proposal?:R}|null>(null),[pending,setPending]=useState(""),[steps,setSteps]=useState<Step[]>([]),[started,setStarted]=useState(0);
 const scroller=useRef<HTMLDivElement>(null),box=useRef<HTMLTextAreaElement>(null);
 const t=x.data.extras.threads.find((v:R)=>v.id===id);
 // Until the background refresh brings the saved thread, show the reply we already have.
 const messages:R[]=local&&local.id===id&&(t?.messages?.length||0)<local.messages.length?local.messages:t?.messages||[];
 const empty=!messages.length&&!pending;
 const lastReply=[...messages].reverse().find(m=>m.role==="assistant")?.reply;
 const chips:string[]=(lastReply?.followUps?.length?lastReply.followUps:STARTERS.map(s=>s.q)).slice(0,3);

 useEffect(()=>{const el=scroller.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:"smooth"})},[messages.length,pending,steps.length,error]);
 useEffect(()=>{const el=box.current;if(!el)return;el.style.height="auto";el.style.height=Math.min(el.scrollHeight,150)+"px"},[q]);
 useEffect(()=>{box.current?.focus()},[]);

 async function run(b:R){
  if(busy)return;wait(true);err("");
  if(b.question){setPending(b.question);set("");setSteps([]);setStarted(Date.now())}
  try{
   const r=await fetch("/api/copilot",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/x-ndjson"},body:JSON.stringify({season:x.season,asOf:x.asOf,page:x.page,filters:x.filters,owner:x.owner,threadId:id,...b})});
   let v:R;
   if((r.headers.get("content-type")||"").includes("ndjson")&&r.body)v=await readStream(r.body,label=>setSteps(s=>[...s,{label,at:Date.now()}]));
   else{v=await r.json();if(!r.ok)throw Error(v.error)}
   if(v.reply){setLocal({id:v.threadId,messages:[...(v.threadId===id?messages:[]),{role:"user",content:b.question},{role:"assistant",content:v.reply.answer,reply:v.reply}],proposal:v.proposal});setId(v.threadId);x.refresh()}
   else await x.refresh();
  }catch(e){err((e as Error).message);if(b.question)set(b.question)}
  finally{wait(false);setPending("");box.current?.focus()}
 }
 const ask=(text:string)=>{if(text.trim())run({question:text.trim()})};

 return <Sheet title="Sponsorship copilot" close={close} side className="copilot-sheet"><div className="copilot">
  <div className="copilot-bar"><span><i className="live-dot"/>Records as of {niceDate(x.asOf,true)}</span><button className="btn" disabled={busy||empty} onClick={()=>{setId("");setLocal(null);set("");err("")}}><Plus size={14}/>New thread</button></div>
  <div className="copilot-scroll" ref={scroller}>
   {empty&&<div className="copilot-empty"><Mark large/><h2>Ask about sponsorships</h2><p>Answers come from this workspace's records, with the evidence attached. Action plans wait for your confirmation.</p>
    <div className="trial-note"><Info size={15}/><div><b>A quick note: you're on a trial plan</b><p>This copilot currently runs on a free, trial-tier Gemini API, so its capacity is a little limited. Now and then a reply may take a few extra seconds, come from a lighter backup model, or briefly hiccup in between. If that happens, please try again in a moment. Your answers are always drawn from your own records. Thank you for your patience!</p></div></div>
    <div className="starters">{STARTERS.map(s=><button key={s.q} className="starter" disabled={busy} onClick={()=>ask(s.q)}><span className="icon-tile muted"><s.icon size={16}/></span><span className="starter-text"><b>{s.q}</b><small>{s.hint}</small></span><ChevronRight size={15}/></button>)}</div></div>}
   {messages.map((m:R,j:number)=>{
    if(m.role==="user")return <article className="msg user" key={j}><p className="bubble">{m.content}</p></article>;
    const p=x.data.extras.proposals.find((v:R)=>v.id===m.reply?.proposalId)||(local?.proposal?.id&&local.proposal.id===m.reply?.proposalId?local.proposal:undefined);
    return <Answer key={j} m={m} proposal={p} busy={busy} decide={run}/>;
   })}
   {pending&&<><article className="msg user"><p className="bubble">{pending}</p></article><Thinking steps={steps} started={started}/></>}
   {error&&<div className="copilot-error" role="alert"><CircleAlert size={15}/><span>{error}<small>Sorry about that. The copilot is on a trial plan, so it can occasionally be briefly unavailable. Your question is still in the box below, so please try again in a moment.</small></span></div>}
  </div>
  <form className="composer" onSubmit={e=>{e.preventDefault();ask(q)}}>
   {!empty&&!busy&&<div className="followups">{chips.map(c=><button type="button" className="chip" key={c} onClick={()=>ask(c)}>{c}</button>)}</div>}
   <div className="composer-box"><textarea ref={box} rows={1} aria-label="Question" value={q} onChange={e=>set(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();ask(q)}}} placeholder={busy?"Working on it…":"Ask about this workspace…"}/>
    <button className={"send"+(busy?" busy":"")} disabled={busy||!q.trim()} aria-label={busy?"Copilot is working":"Ask copilot"}>{busy?<span className="send-spin"/>:<ArrowUp size={17}/>}</button></div>
   <small className="composer-hint"><span className="trial-pill">Trial plan</span>Replies may occasionally take a little longer</small>
  </form>
 </div></Sheet>;
}
