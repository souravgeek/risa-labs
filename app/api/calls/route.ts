import { input } from '../../../lib/workspace';
import { handleCall } from '../../../lib/voice-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function POST(request:Request) {
  try {
    const origin=request.headers.get('origin');
    if(origin && new URL(origin).host!==(request.headers.get('host')||new URL(request.url).host))return Response.json({error:'Cross-origin call request rejected.'},{status:403});
    const body=await request.json();
    if(!body || typeof body!=='object')throw new Error('Invalid call request.');
    return Response.json(await handleCall(input(body),body),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const message=error instanceof Error ? error.message:'Call service is unavailable.';
    const safe=message.length>350 || /api.?key=|auth_tokens\/|generativelanguage.googleapis/i.test(message)?'Gemini could not complete the request. Check the server configuration and quota.':message;
    return Response.json({error:safe},{status:message.includes('Refresh and try again')?409:400,headers:{'Cache-Control':'no-store'}});
  }
}
