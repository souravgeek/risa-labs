import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {fixtureTranscript,seededTraits,localCallInsights,unverifiedQuantities,verifyInsights} from '../lib/gemini';
import {safeData} from '../lib/gemini-core';
import { DISCLOSURE, hasDisclosure,type CallBrief } from '../lib/voice-types';
import { POST } from '../app/api/calls/route';
import {entries,append} from '../lib/storage';
import {read} from '../lib/workspace';
import { BRAND_MAP } from '../lib/brand-register';

const i={season:'2025' as const,asOf:'2025-03-20'};
const temp=mkdtempSync(join(tmpdir(),'campusfest-calls-test-'));
const brief:CallBrief={purpose:'stalled deal',brand:'Evergreen Living',asOf:i.asOf};
const api=async(body:Record<string,unknown>)=>{
  const response=await POST(new Request('http://localhost/api/calls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...i,...body})}));
  return {status:response.status,...await response.json()};
};
beforeAll(()=>{vi.stubEnv('GEMINI_API_KEY','');vi.stubEnv('SUPABASE_URL','');vi.stubEnv('VERCEL','');vi.stubEnv('CAMPUSFEST_DATA_DIR',temp);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
afterAll(()=>{vi.unstubAllEnvs();rmSync(temp,{force:true,recursive:true});});

describe('call evidence and numeric grounding',()=>{
  it('extracts three directly stated traits and verifies disclosure in twenty seeded scripted calls',()=>{
    let matched=0;
    for(let n=1;n<=20;n++){
      const traits=seededTraits(n),transcript=fixtureTranscript(brief,traits),fields=localCallInsights(transcript);
      matched+=Number(fields.interest.value===traits.interest)+Number(fields.decisionMaker.value===traits.decisionMaker)+Number((fields.objections.value as string[]).includes(traits.objection));
      expect(hasDisclosure(transcript)).toBe(true);
      for(const field of Object.values(fields).filter(f=>f.value!==null))expect(transcript.some(t=>t.speaker==='sponsor' && t.text.includes(field.quote!))).toBe(true);
    }
    expect(matched).toBe(60);
  });
  it('discards invented quotes and agent-only evidence',()=>{
    const transcript=fixtureTranscript(brief,seededTraits(15));
    const result=verifyInsights([{field:'budgetMin',value:90000,quote:'We can spend ninety thousand.'},{field:'interest',value:5,quote:DISCLOSURE}],transcript);
    expect(result.budgetMin.value).toBeNull();expect(result.interest.value).toBeNull();
  });
  it('compares rounded and Indian-formatted values against actual tool output',()=>{
    expect(unverifiedQuantities('19 deals / ₹16.6L / 2.7 per week',{wins:19,amount:1660000,rate:2.7391})).toEqual([]);
    expect(unverifiedQuantities('93 confirmations, ₹10,00,000',{wins:19,amount:1660000})).toEqual(['93','10,00,000']);
    expect(JSON.stringify(safeData({mobile:'9876543210',note:'Use +91 9876543210',amount:135000}))).not.toContain('9876543210');
  });
});
describe('call service via HTTP route handler',()=>{
  function workingHours(){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-25T06:30:00Z'));}
  async function contact(name:string,brandId='A052',purpose='stalled deal'){return (await api({kind:'addContact',name,brandId,purpose,consent:true})).id;}
  it('persists a scripted call, task and dated evidence; enforces limits, ownership, consent and deletion across snapshots',async()=>{
    workingHours();const params={brandId:'A052',purpose:'stalled deal',mode:'simulated',confirm:true};
    expect((await api({kind:'start',...params,contactId:'missing'})).status).toBe(400);
    expect((await api({kind:'addContact',brandId:'A052',purpose:'stalled deal',name:'Aditi',consent:false})).status).toBe(400);
    const contactId=await contact('Maya');expect(contactId).toBeTruthy();
    expect((await api({kind:'start',...params,confirm:false,contactId})).status).toBe(400);
    expect((await api({kind:'start',...params,contactId,brandId:'A037'})).status).toBe(400);
    const preview=await api({kind:'preview',...params,contactId});expect(preview.brief.brand).toBe(BRAND_MAP.A052.name);
    const session=await api({kind:'start',...params,contactId});expect(session.status).toBe(200);expect(session.engine).toBe('fixture');
    const current=await read(i);expect(current.extras.tasks.some(t=>t.source==='call'&&t.linkedId===session.id)).toBe(true);expect(current.interactions.some(t=>t.type==='call_held'&&t.brandId==='A052')).toBe(true);
    expect((await api({kind:'review',callId:session.id,decision:'approve'})).status).toBe(200);
    expect((await api({kind:'review',callId:session.id,decision:'approve'})).status).toBe(400);
    for(let n=0;n<2;n++)expect((await api({kind:'start',...params,contactId})).status).toBe(200);
    expect((await api({kind:'start',...params,contactId})).error).toContain('daily limit');
    expect((await api({kind:'removeContact',contactId,asOf:'2025-03-21'})).status).toBe(200);
    const erased=await read(i);
    expect(erased.extras.allowlist.some(c=>c.id===contactId)).toBe(false);
    expect(erased.extras.calls.find(c=>c.id===session.id)?.transcript).toEqual([]);
    expect(JSON.stringify(await entries('2025'))).not.toContain('Maya');
  });
  it('refuses calls outside real IST hours and refuses browser mode without a server key',async()=>{
    workingHours();const contactId=await contact('Ravi','A037');const params={kind:'start',brandId:'A037',purpose:'stalled deal',contactId,confirm:true};
    expect((await api({...params,mode:'browser'})).error).toContain('GEMINI_API_KEY');
    vi.setSystemTime(new Date('2026-11-25T16:00:00Z'));expect((await api({...params,mode:'simulated'})).error).toContain('09:00');
  });
  it('checks the browser capability, deactivates consent on the sponsor opt-out, and supports idempotent chunks',async()=>{
    workingHours();const contactId=await contact('Asha','A047'),id='CALL-test-voice',sessionKey='a'.repeat(48);
    const rows=await entries('2025');
    await append({id:'test-browser-reservation',season:'2025',at:i.asOf+'T19:00:00+05:30',label:'Test session',actor:'Test',entity:'A047',changes:[{table:'calls',row:{id,mode:'browser',brandId:'A047',brand:'Evergreen Pantry',ownerId:'T01',campaignId:'C01',contactId,purpose:'stalled deal',status:'active',startedAt:new Date().toISOString(),brief,token:createHash('sha256').update(sessionKey).digest('hex'),chunks:[],transcript:[]}}]},rows.length);
    const turn={speaker:'sponsor',text:'Please stop calling me.'};const args={kind:'transcript',callId:id,sessionKey,turn,chunkId:'1'};
    expect((await api({...args,sessionKey:'b'.repeat(48)})).status).toBe(400);
    expect((await api(args)).status).toBe(200);expect((await api(args)).status).toBe(200);
    const data=await read(i);expect(data.extras.calls.find(c=>c.id===id)?.transcript).toHaveLength(1);expect(data.extras.allowlist.find(c=>c.id===contactId)?.active).toBe(false);
    expect((await api({kind:'finish',callId:id,sessionKey})).insights.fields.optOut.value).toBe(true);
    expect((await api({kind:'start',confirm:true,mode:'simulated',brandId:'A047',purpose:'stalled deal',contactId})).status).toBe(400);
  });
});
