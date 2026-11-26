import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Row, entries, type Entry, type Change } from './storage';
import { change, uid, task, note, commit, state, type State, type Input } from './workspace';
import { dateAdd, packagesSeed } from './shared';
import { analyzeCall, createVoiceToken, simulateCall, geminiConfigured, scriptedTurn, type CallBrief, type GeminiLogEntry } from './gemini';
import { openingLine, streamAgentTurn, streamSpeech, SentenceSplitter, type PhoneAgentAction } from './phone-stream';
import { cleanText } from './gemini-core';
import { MAX_CALL_MS, istToday, type CallPurpose, type Transcript, type Utterance } from './voice-types';
import { eraseDemoContact } from './voice-privacy';

const purposes: CallPurpose[]=['payment reminder','stalled deal','inbound lead'];
const calendar = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
const requireValue=(condition:unknown,message:string)=>{if(!condition)throw new Error(message)};
const sha=(key:string)=>createHash('sha256').update(key).digest('hex');
const hasOptOut=(s:string)=>/\b(stop (?:calling|contacting)(?: me| us)?|do(?:n['’]t| not) (?:call|contact)(?: me| us)?|remove me from (?:the|your) list|no more calls)\b/i.test(s);
const dateValue=(v:unknown)=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
const redact=(s:string,name:string)=>name ? cleanText(s).replaceAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'[demo contact]') : cleanText(s);
const logs=(items:GeminiLogEntry[])=>items.map(row=>change('llm_calls',{...row,id:uid('llm')}));
const current=async(i:Input)=>state(await entries(i.season),{...i,filters:{}});
const snapshotCall=(s:State,id:string)=>{const call=s.extras.calls.find(c=>c.id===id);if(!call) throw new Error('Call not found at this snapshot.');return call;};

export function availablePurposes(s:State,brandId:string,asOf:string):CallPurpose[]{
  const b=s.snap.brands.find(b=>b.id===brandId);
  if(!b || b.doNotContact) return [];
  const result:CallPurpose[]=[];
  if(s.snap.invoices.some(inv=>inv.brandId===brandId && inv.balance>0 && inv.dueAt.slice(0,10)<=dateAdd(asOf,7))) result.push('payment reminder');
  if(s.snap.stalled.some(d=>d.brandId===brandId)) result.push('stalled deal');
  if(s.snap.interactions.some(t=>t.brandId===brandId && ['introduction_received','web_inbound'].includes(t.type)) && !s.snap.deals.some(d=>d.brandId===brandId && d.stage==='partner_confirmed')) result.push('inbound lead');
  return result;
}
function prepare(s:State,i:Input,a:Row) {
  const contact=s.extras.allowlist.find(c=>c.id===a.contactId && c.active && c.consent);
  if(!contact) throw new Error('Choose an active demo contact with explicit consent.');
  requireValue(a.brandId===contact.brandId && a.purpose===contact.purpose,'Choose the brand and purpose covered by this consent.');
  const brand=s.snap.brands.find(b=>b.id===a.brandId);
  if(!brand || !availablePurposes(s,brand.id,i.asOf).includes(a.purpose)) throw new Error('This brand is not eligible for that purpose at this snapshot.');
  const invoice=s.snap.invoices.filter(v=>v.brandId===brand.id && v.balance>0 && v.dueAt.slice(0,10)<=dateAdd(i.asOf,7)).sort((a,b)=>a.dueAt.localeCompare(b.dueAt))[0];
  const deal=a.purpose==='payment reminder' ? s.snap.deals.find(d=>d.id===invoice?.dealId) : s.snap.stalled.find(d=>d.brandId===brand.id);
  const facts:Record<string,string|number>={qualification:brand.qualification,industry:brand.industry,language:contact.language || 'English'};
  if(deal) Object.assign(facts,{stage:deal.stage,value:deal.value,daysInStage:deal.daysInStage});
  if(invoice && a.purpose==='payment reminder') Object.assign(facts,{outstanding:invoice.balance,dueDate:invoice.dueAt.slice(0,10)});
  const last=s.snap.interactions.filter(x=>x.brandId===brand.id).at(-1);
  if(last) facts.lastTouch=last.date.slice(0,10);
  // The conversation happens today, in real time; the deal facts are records as of the workspace date.
  const brief:CallBrief={brand:brand.name,purpose:a.purpose,facts,asOf:i.asOf,callDate:istToday(),discountCeiling:s.settings.discountCeiling??10,packages:packagesSeed.filter(p=>s.extras.allocations.filter(v=>v.packageId===p.id).length<p.quantity).map(({name,price})=>({name,price}))};
  return {contact,brand,deal,invoice,brief};
}
// Consent, kill switch and daily limits follow real time, including when a caller selects a past snapshot.
function permission(history:Entry[],contactId:string,brandId:string) {
  let active=false,enabled=true,optedOut=false;
  const recent=new Set<string>();
  const today=calendar.format(new Date());
  for(const event of history) for(const {table,row} of event.changes) {
    if(table==='allowlist' && row.id===contactId && ('active' in row || 'consent' in row)) active=row.active!==false && row.consent!==false && !row.deleted;
    if(table==='settings' && row.key==='callsEnabled') enabled=row.value===true;
    if(table==='sponsor_interactions' && row.brand_id===brandId && row.event_type==='opt_out') optedOut=true;
    if(table==='calls' && row.contactId===contactId && row.startedAt && calendar.format(new Date(row.startedAt))===today) recent.add(row.id);
  }
  requireValue(enabled,'The call agent is turned off in Settings.');
  requireValue(active && !optedOut,'This demo contact has been removed or opted out.');
  requireValue(recent.size<3,'This contact has reached the daily limit of three calls.');
}
function interaction(i:Input,brandId:string,ownerId:string,campaignId:string,event_type:string,summary:string){
  return change('sponsor_interactions',{interaction_id:uid('SI'),attempt_id:uid('SA'),brand_id:brandId,owner_id:ownerId,sponsor_campaign_id:campaignId,
    channel:'call_agent',event_type,summary,outcome:'recorded',occurred_at:i.asOf+'T23:59:56+05:30',origin:'call_agent',provenance:'user'});
}
function optOut(s:State,i:Input,c:Row) {
  const rows=s.extras.allowlist.filter(a=>a.brandId===c.brandId && a.active).map(a=>change('allowlist',{id:a.id,active:false,consent:false,optedOutAt:new Date().toISOString()}));
  if(!s.snap.brands.some(b=>b.id===c.brandId && b.doNotContact)) rows.push(interaction(i,c.brandId,c.ownerId,c.campaignId,'opt_out','Sponsor requested no further calls.'));
  return rows;
}
function liveSession(s:State,a:Row,allowExpired=false){
  const c=snapshotCall(s,a.callId);
  requireValue(['browser','phone'].includes(c.mode) && typeof a.sessionKey==='string' && a.sessionKey.length===48 && typeof c.token==='string' && timingSafeEqual(Buffer.from(c.token,'hex'),Buffer.from(sha(a.sessionKey),'hex')),'This browser session does not own the call.');
  if(!allowExpired) {
    requireValue(c.status==='active' && Date.now()-Date.parse(c.startedAt)<MAX_CALL_MS,'The voice session has ended.');
    requireValue(s.settings.callsEnabled!==false,'The call agent was turned off.');
  }
  return c;
}
function assemble(raw:unknown,name:string):Transcript{
  requireValue(Array.isArray(raw) && raw.length<=400,'Invalid call transcript.');
  return (raw as Utterance[]).map(turn=>{
    requireValue(turn && ['agent','sponsor'].includes(turn.speaker) && typeof turn.text==='string' && turn.text.length<=16000,'Invalid transcript segment.');
    return {speaker:turn.speaker,text:redact(turn.text.trim(),name)};
  }).filter(v=>v.text);
}
function completion(s:State,i:Input,c:Row,transcript:Transcript,insights:Awaited<ReturnType<typeof analyzeCall>>){
  const f=insights.fields, endedAt=new Date().toISOString(), step=f.nextStep.value, nextDate=f.nextStepDate.value;
  const changes:Change[]=[change('calls',{id:c.id,status:'completed',endedAt,insights,transcript,review:'pending',disclosurePresent:insights.disclosurePresent}),
    interaction(i,c.brandId,c.ownerId,c.campaignId,'call_held',c.brief.purpose+' · '+(f.outcome.value||'Outcome unknown')),
    task(typeof step==='string' ? step:'Review call with '+c.brand,c.brandId,c.ownerId,typeof nextDate==='string'?nextDate:dateAdd(i.asOf,1),'call',c.id)];
  if(f.optOut.value===true) changes.push(...optOut(s,i,c));
  if(Number(f.interest.value)>=4 || f.paymentDate.value || /proposal/i.test(String(step||''))) changes.push(note('Review the '+c.purpose+' with '+c.brand,c.ownerId,c.brandId));
  return changes;
}
export async function handleCall(i:Input,a:Row):Promise<Row> {
  const kind=a.kind;
  if(kind==='capabilities')return {gemini:geminiConfigured()};
  if(kind==='eligible'){
    const s=await current(i);
    return {gemini:geminiConfigured(),enabled:s.settings.callsEnabled!==false,brands:s.snap.brands.map(b=>({id:b.id,name:b.name,purposes:availablePurposes(s,b.id,i.asOf)})).filter(b=>b.purposes.length).sort((a,b)=>a.name.localeCompare(b.name))};
  }
  if(kind==='addContact'){
    const id=uid('DC');
    await commit(i,s=>{
      requireValue(a.consent===true && typeof a.name==='string' && a.name.trim().length>=1 && a.name.trim().length<=60,'Add a display name and confirm explicit consent.');
      requireValue(!/[\d@]/.test(a.name),'Use a name or alias without contact details.');
      requireValue(purposes.includes(a.purpose) && availablePurposes(s,a.brandId,i.asOf).includes(a.purpose),'Select a brand with a matching warm call purpose.');
      requireValue(!s.extras.allowlist.some(c=>c.active && c.brandId===a.brandId && c.purpose===a.purpose && c.name.toLowerCase()===a.name.trim().toLowerCase()),'This demo contact is already on the allowlist.');
      return {label:'Added consenting demo contact',entity:a.brandId,changes:[change('allowlist',{id,name:a.name.trim(),brandId:a.brandId,purpose:a.purpose,language:a.language==='Hinglish'?'Hinglish':'English',role:['self','teammate','interviewer'].includes(a.role)?a.role:'self',consent:true,active:true,consentAt:new Date().toISOString()})]};
    });return {id};
  }
  if(kind==='removeContact'){
    const s=await current(i); requireValue(s.extras.allowlist.some(c=>c.id===a.contactId),'Demo contact not found.');
    await eraseDemoContact(i.season,a.contactId);return {removed:true};
  }
  if(kind==='preview'){const plan=prepare(await current(i),i,a);return {brief:plan.brief,available:geminiConfigured()};}
  if(kind==='start'){
    requireValue(['simulated','browser','phone'].includes(a.mode),'Choose simulated text, a phone call or browser voice.');
    requireValue(a.confirm===true,'Review and confirm the call brief first.');
    if(a.mode==='browser')requireValue(geminiConfigured(),'Browser voice needs GEMINI_API_KEY on the server.');
    const asHistory=await entries(i.season);
    permission(asHistory,a.contactId,a.brandId);
    const id=uid('CALL'),sessionKey=randomBytes(24).toString('hex');
    const queued=prepare(state(asHistory,{...i,filters:{}}),i,a);
    const startedAt=new Date().toISOString();
    // Reserve atomically against the same ledger version that was checked for rate limiting.
    const {append}=await import('./storage');
    const call={id,mode:a.mode,brandId:queued.brand.id,brand:queued.brand.name,campaignId:queued.brand.campaignId,ownerId:queued.deal?.ownerId||queued.brand.ownerId,dealId:queued.deal?.id||null,invoiceId:a.purpose==='payment reminder'?queued.invoice?.id:null,
      contactId:queued.contact.id,purpose:a.purpose,startedAt,brief:queued.brief,transcript:[],status:'active',token:sha(sessionKey),chunks:[]};
    await append({id:uid('evt'),at:i.asOf+'T23:59:58+05:30',season:i.season,label:'Started '+a.purpose+' with '+queued.brand.name,actor:'Call agent',entity:queued.brand.id,changes:[change('calls',call)]},asHistory.length);
    const llm:GeminiLogEntry[]=[];
    try{
      if(a.mode==='browser') return {id,sessionKey,credentials:await createVoiceToken(queued.brief)};
      if(a.mode==='phone'){
        const turn={speaker:'agent' as const,text:redact(openingLine(queued.brief),queued.contact.name)};
        await commit(i,s=>{const c=snapshotCall(s,id);requireValue(c.status==='active','The call ended before it connected.');return {label:'Phone call connected with '+c.brand,entity:c.brandId,changes:[change('calls',{id,transcript:[turn],engine:geminiConfigured()?'gemini':'scripted',metrics:[]})]};},'Call agent');
        return {id,sessionKey,turn,engine:geminiConfigured()?'gemini':'scripted'};
      }
      const seed=Number.parseInt(sha(id).slice(0,8),16);
      const sim=await simulateCall(queued.brief,seed,e=>llm.push(e));
      const transcript=assemble(sim.transcript,queued.contact.name);
      const insights=await analyzeCall(transcript,e=>llm.push(e));
      await commit(i,s=>{
        const c=snapshotCall(s,id);requireValue(c.status==='active' && c.contactId,'Demo contact was removed during this call.');
        return {label:'Completed simulated call with '+c.brand,entity:c.brandId,changes:[...completion(s,i,c,transcript,insights),change('calls',{id,engine:sim.mode,seed}),...logs(llm)]};
      },'Call agent');return {id,engine:sim.mode,transcript,insights};
    }catch(error){
      await commit(i,()=>({label:'Call could not start or finish',entity:queued.brand.id,changes:[change('calls',{id,status:'failed',endedAt:new Date().toISOString()}),...logs(llm)]}),'Call agent');
      throw error;
    }
  }
  if(kind==='transcript'){
    await commit(i,s=>{
      const c=liveSession(s,a),contact=s.extras.allowlist.find(x=>x.id===c.contactId);
      requireValue(contact && typeof a.chunkId==='string' && a.chunkId.length<=80,'Unknown transcript chunk.');
      if(c.chunks.includes(a.chunkId)) return {label:'',changes:[]};
      const [turn]=assemble([a.turn],contact!.name);
      if(!turn) return {label:'',changes:[]};
      const transcript=[...c.transcript,turn];requireValue(transcript.length<=400,'Transcript is full.');
      const changes=[change('calls',{id:c.id,transcript,chunks:[...c.chunks,a.chunkId]})];
      if(turn.speaker==='sponsor' && hasOptOut(transcript.filter(t=>t.speaker==='sponsor').slice(-2).map(t=>t.text).join(' ')))changes.push(...optOut(s,i,c));
      return {label:'Saved call transcript segment',entity:c.brandId,changes};
    },'Call agent');return {saved:true};
  }
  if(kind==='reply'){
    let done:Row={};
    await phoneTurn(i,{...a,voice:'none'},e=>{if(e.type==='done')done=e;});
    return done;
  }
  if(kind==='tool'){
    let output:unknown;
    await commit(i,s=>{
      const c=liveSession(s,a),args=a.args||{};let changes:Change[]=[];
      if(a.name==='get_package_options') output=c.brief.packages;
      else if(a.name==='mark_opt_out'){changes=optOut(s,i,c);output='Opt-out applied.';}
      else if(a.name==='end_call')output='Call ending.';
      else if(a.name==='log_payment_promise'||a.name==='schedule_follow_up'){
        requireValue(dateValue(args.date) && args.date>=(c.brief.callDate||i.asOf),'Choose a valid future date.');
        if(a.name==='log_payment_promise')requireValue(c.invoiceId && Number.isFinite(args.amount) && args.amount>0 && args.amount<=c.brief.facts.outstanding,'Payment promise exceeds the current invoice.');
        changes=[change('calls',{id:c.id,toolProposals:[...(c.toolProposals||[]).slice(-12),{name:a.name,date:args.date,...(a.name==='log_payment_promise'?{amount:args.amount}:{})}]})];output='Preview recorded for human review.';
      }else throw new Error('Unknown call tool.');
      return {label:'Call tool · '+a.name,entity:c.brandId,changes};
    },'Call agent');return {output};
  }
  if(kind==='finish'){
    const s=await current(i),c=liveSession(s,a,true);
    if(c.status==='completed')return {id:c.id,insights:c.insights};
    requireValue(c.status==='active' && c.contactId,'This call is closed.');
    const llm:GeminiLogEntry[]=[];
    if(!c.transcript?.length) {
      await commit(i,()=>({label:'Ended voice session without a conversation',entity:c.brandId,changes:[change('calls',{id:c.id,status:'cancelled',endedAt:new Date().toISOString()})]}),'Call agent');
      return {id:c.id};
    }
    const insights=await analyzeCall(c.transcript,e=>llm.push(e),c.brief.callDate||c.brief.asOf);
    await commit(i,latest=>{
      const record=liveSession(latest,a,true);
      if(record.status==='completed')return {label:'',changes:[]};
      requireValue(record.status==='active' && record.contactId && record.chunks.length===c.chunks.length,'Call changed during analysis. Try finishing again.');
      return {label:'Completed '+(c.mode==='phone'?'phone':'browser')+' call with '+c.brand,entity:c.brandId,changes:[...completion(latest,i,c,c.transcript,insights),...logs(llm)]};
    },'Call agent');return {id:c.id,insights};
  }
  if(kind==='review'){
    await commit(i,s=>{
      const c=snapshotCall(s,a.callId);
      requireValue(c.status==='completed' && c.review==='pending' && c.contactId,'This call has already been reviewed or removed.');
      const approve=a.decision==='approve';requireValue(approve||a.decision==='reject','Choose approve or reject.');
      const changes=[change('calls',{id:c.id,review:approve?'approved':'rejected'})];
      const f=c.insights.fields;
      const promise=reviewPromise(c);
      if(approve && c.invoiceId && promise){
        const inv=s.snap.invoices.find(x=>x.id===c.invoiceId);
        requireValue(inv && inv.balance>=promise.amount && promise.date>=i.asOf,'The promised payment no longer matches this invoice.');
        changes.push(change('invoices',{invoice_id:inv!.id,opportunity_id:inv!.dealId,amount_inr:inv!.amount,milestone:inv!.milestone,
          issued_at:inv!.issuedAt,due_at:inv!.dueAt,expected_payment_at:promise.date+'T17:00:00+05:30',effective_at:i.asOf+'T23:59:57+05:30',status:'sent',origin:'call_agent',provenance:'user'}));
      }
      const follow=[...(c.toolProposals||[])].reverse().find((x:Row)=>x.name==='schedule_follow_up');
      if(approve && follow && !(typeof f.nextStepDate.value==='string' && f.nextStepDate.value===follow.date))changes.push(task('Follow-up agreed on the call'+(follow.reason?': '+String(follow.reason).slice(0,120):' with '+c.brand),c.brandId,c.ownerId,follow.date,'call',c.id));
      if(approve && c.purpose==='inbound lead' && f.decisionMaker.value==='yes' && Number(f.interest.value)>=4 && f.optOut.value!==true) {
        changes.push(change('brand_qualification_history',{history_id:uid('BQ'),brand_id:c.brandId,effective_at:i.asOf+'T23:59:57+05:30',qualification_status:'qualified',reason:'Owner approved evidence from '+c.id,sponsor_campaign_id:c.campaignId,origin:'call_agent',provenance:'user'}));
      }
      return {label:(approve?'Approved':'Rejected')+' call findings for '+c.brand,entity:c.brandId,changes};
    });return {saved:true};
  }
  throw new Error('Unknown call action.');
}

export type PhoneEvent=Row&{type:'sentence'|'audio'|'audio-end'|'speak-fallback'|'done'|'error'};
/**
 * One streamed turn of an in-app phone call. Emits each agent sentence as soon as it is complete and,
 * with Gemini voice, its audio as streamed PCM, then saves the turn. The sponsor's words are saved
 * while the agent is still thinking, so a dropped connection loses nothing they said.
 */
export async function phoneTurn(i:Input,a:Row,emit:(e:PhoneEvent)=>void|Promise<void>){
  const t0=Date.now();
  const text=typeof a.text==='string'?a.text.trim().slice(0,1000):'';requireValue(text,'Say something to the agent first.');
  const s=await current(i),c=liveSession(s,a);requireValue(c.mode==='phone','Replies are only for in-app phone calls.');
  const contact=s.extras.allowlist.find(x=>x.id===c.contactId);requireValue(contact,'This demo contact has been removed.');
  const name=contact!.name,[turn]=assemble([{speaker:'sponsor',text}],name);
  const transcript:Transcript=[...c.transcript,turn],llm:GeminiLogEntry[]=[];
  const savedSponsor=commit(i,latest=>{const cur=liveSession(latest,a);requireValue(cur.transcript.length===c.transcript.length,'The call changed while you were speaking. Try again.');return {label:'Phone call · sponsor spoke',entity:c.brandId,changes:[change('calls',{id:c.id,transcript})]};},'Call agent');
  savedSponsor.catch(()=>undefined);
  const optedOut=hasOptOut(text),closing=Date.now()-Date.parse(c.startedAt)>MAX_CALL_MS-45_000||transcript.filter(t=>t.speaker==='agent').length>=12;
  const voice=a.voice==='gemini'&&geminiConfigured();
  let audio=Promise.resolve(),firstAudioMs=0,firstSentenceAt=0;
  const later:{index:number;text:string}[]=[];
  // Voice requests are chained so audio always arrives in order. If TTS is unavailable or rate-limited,
  // the browser speaks that text instead, so the call never goes silent.
  let voiceFailed=false;
  const voiceOut=(text:string,index:number)=>{audio=audio.then(async()=>{if(voiceFailed){await emit({type:'speak-fallback',index,text});return;}const ok=await streamSpeech(text,(pcm,rate)=>{if(!firstAudioMs)firstAudioMs=Date.now()-t0;return emit({type:'audio',index,pcm,rate});},e=>{llm.push(e);});if(!ok)voiceFailed=true;await emit(ok?{type:'audio-end',index}:{type:'speak-fallback',index,text});});};
  const sentence=async(raw:string,index:number)=>{
    const said=redact(raw,name);if(!firstSentenceAt)firstSentenceAt=Date.now()-t0;
    await emit({type:'sentence',index,text:said});
    // The first sentence is voiced on its own for a fast start; the rest of the turn goes in one request to save quota.
    if(voice){if(index===0)voiceOut(said,0);else later.push({index,text:said});}
  };
  const speakAll=async(say:string)=>{const sp=new SentenceSplitter();let n=0;for(const p of [...sp.push(say+' '),...sp.end()])await sentence(p,n++);};
  let say:string,action:PhoneAgentAction,model='rule',engine:string=c.engine||'scripted',hedged=false,firstTokenMs=0;
  if(optedOut){say='Understood. We will not contact you again. Thank you for your time, goodbye.';action={action:'end_call'};await speakAll(say);}
  else if(!geminiConfigured()){const st=scriptedTurn(c.brief,transcript,closing);say=st.say;action={action:st.action};engine='scripted';await speakAll(say);}
  else{const r=await streamAgentTurn(c.brief,transcript,{closing},{onSentence:sentence},e=>{llm.push(e);});say=r.say;action=r.action;model=r.metrics.model;hedged=r.metrics.hedged;firstTokenMs=r.metrics.firstTokenMs;engine='gemini';}
  if(voice&&later.length)voiceOut(later.map(v=>v.text).join(' '),later[0].index);
  await audio;await savedSponsor;
  const reply={speaker:'agent' as const,text:redact(say,name)};
  // A dated next step or payment promise becomes a proposal for a person to approve, like the voice tools.
  const today=c.brief.callDate||i.asOf;
  let proposal:Row|undefined;
  if(action.action==='schedule_follow_up' && dateValue(action.date) && action.date!>=today)proposal={name:'schedule_follow_up',date:action.date,reason:action.reason||''};
  if(action.action==='log_payment_promise' && c.invoiceId && dateValue(action.date) && action.date!>=today && Number(action.amount)>0 && Number(action.amount)<=Number(c.brief.facts?.outstanding))proposal={name:'log_payment_promise',date:action.date,amount:Number(action.amount)};
  const metrics={turn:transcript.filter(t=>t.speaker==='agent').length,model,engine,hedged,firstTokenMs,firstSentenceMs:firstSentenceAt,firstAudioMs,serverMs:Date.now()-t0,voice:voice?'gemini':'browser',endpointMs:Number(a.endpointMs)||0};
  await commit(i,latest=>{
    const cur=liveSession(latest,a,true);
    if(proposal&&(cur.toolProposals||[]).some((x:Row)=>x.name===proposal!.name&&x.date===proposal!.date))proposal=undefined;
    return {label:'Phone call turn with '+c.brand,entity:c.brandId,changes:[change('calls',{id:c.id,transcript:[...cur.transcript,reply],metrics:[...(cur.metrics||[]),metrics].slice(-40),...(proposal?{toolProposals:[...(cur.toolProposals||[]).slice(-12),proposal]}:{})}),...(optedOut?optOut(latest,i,cur):[]),...logs(llm)]};
  },'Call agent');
  const goodbye=/\b(good ?bye|bye for now)\b/i.test(say);
  await emit({type:'done',turn:reply,end:optedOut||closing||goodbye||action.action==='end_call',action:action.action,optedOut,engine,metrics});
}
/** Gemini voice for the opening line, so the voice doesn't change after pickup. Falls back to the browser voice. */
export async function phoneOpening(i:Input,a:Row,emit:(e:PhoneEvent)=>void|Promise<void>){
  const s=await current(i),c=liveSession(s,a);requireValue(c.mode==='phone','Only in-app phone calls have an opening line.');
  const text=c.transcript.find((t:Utterance)=>t.speaker==='agent')?.text;requireValue(text,'This call has no opening line.');
  const ok=geminiConfigured()&&await streamSpeech(text,(pcm,rate)=>emit({type:'audio',index:0,pcm,rate}));
  await emit(ok?{type:'audio-end',index:0}:{type:'speak-fallback',index:0,text});
  await emit({type:'done',opening:true});
}
/** The payment promise to approve: the sponsor's own quoted words first, else the one the agent recorded on the call. */
export function reviewPromise(c:Row):{date:string;amount:number;source:'quote'|'agent'}|null{
  const f=c.insights?.fields||{};
  if(typeof f.paymentDate?.value==='string' && Number(f.paymentAmount?.value)>0)return {date:f.paymentDate.value,amount:Number(f.paymentAmount.value),source:'quote'};
  const p=[...(c.toolProposals||[])].reverse().find((x:Row)=>x.name==='log_payment_promise' && dateValue(x.date) && Number(x.amount)>0);
  return p?{date:p.date,amount:Number(p.amount),source:'agent'}:null;
}
