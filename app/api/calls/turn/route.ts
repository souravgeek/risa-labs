import { input } from '../../../../lib/workspace';
import { phoneTurn, phoneOpening, type PhoneEvent } from '../../../../lib/voice-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Streams one phone-call turn as newline-delimited JSON: sentence → audio … → done.
export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin && new URL(origin).host!==(request.headers.get('host')||new URL(request.url).host))return Response.json({error:'Cross-origin call request rejected.'},{status:403});
  let body:Record<string,unknown>;
  try{body=await request.json();}catch{return Response.json({error:'Invalid call request.'},{status:400});}
  const encoder=new TextEncoder();
  const stream=new ReadableStream({async start(controller){
    let open=true;
    const emit=(e:PhoneEvent)=>{if(open)controller.enqueue(encoder.encode(JSON.stringify(e)+'\n'));};
    request.signal.addEventListener('abort',()=>{open=false;});
    try{await (body.opening===true?phoneOpening:phoneTurn)(input(body),body,emit);}
    catch(error){const m=error instanceof Error?error.message:'The call agent could not reply.';emit({type:'error',error:m.length>300||/api.?key|googleapis/i.test(m)?'Gemini could not reply. Check the server key and quota.':m});}
    finally{if(open)controller.close();}
  }});
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
