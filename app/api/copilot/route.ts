import {assistant} from "@/lib/assistant";
import {input} from "@/lib/workspace";
export const maxDuration=120;
/** Plain JSON by default. With `Accept: application/x-ndjson`, streams progress lines ({type:"step"}) and then the {type:"result"}. */
export async function POST(r:Request){
 try{
  if(r.headers.get("origin")&&new URL(r.headers.get("origin")!).host!==(r.headers.get("host")||new URL(r.url).host))throw Error("Origin mismatch.");
  const b=await r.json(),i=input(b);
  if(b.decision||!(r.headers.get("accept")||"").includes("application/x-ndjson"))return Response.json(await assistant(i,b));
  const enc=new TextEncoder();
  const stream=new ReadableStream({async start(c){
   const send=(o:Record<string,unknown>)=>c.enqueue(enc.encode(JSON.stringify(o)+"\n"));
   // Safari holds back a stream until 1 KB arrives, so the first line is padded.
   send({type:"open",pad:" ".repeat(1024)});
   try{const v=await assistant(i,b,label=>send({type:"step",label}));send({type:"result",...v})}
   catch(e){send({type:"error",error:(e as Error).message})}
   finally{c.close()}
  }});
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"}});
 }catch(e){return Response.json({error:(e as Error).message},{status:400})}
}
