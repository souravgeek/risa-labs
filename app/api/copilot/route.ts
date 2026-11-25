import {assistant} from "@/lib/assistant";
import {input} from "@/lib/workspace";
export const maxDuration=120;
export async function POST(r:Request){try{if(r.headers.get("origin")&&new URL(r.headers.get("origin")!).host!==(r.headers.get("host")||new URL(r.url).host))throw Error("Origin mismatch.");const b=await r.json();return Response.json(await assistant(input(b),b))}catch(e){return Response.json({error:(e as Error).message},{status:400})}}
