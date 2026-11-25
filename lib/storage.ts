import { DatabaseSync } from "node:sqlite";
import {mkdirSync} from "node:fs";
import path from "node:path";
export type Season="2025"|"2026";
export type Row=Record<string,any>;
export type Change={table:string;row:Row};
export type Entry={id:string;season:Season;at:string;label:string;actor:string;entity:string;changes:Change[]};
let local:DatabaseSync|undefined;
/** Supabase is used only when both the URL and the server key are set; otherwise local SQLite (or an error on Vercel). */
const url=()=>process.env.SUPABASE_SERVICE_ROLE_KEY?process.env.SUPABASE_URL?.replace(/\/$/,""):undefined;
function db(){
  if(local)return local;
  if(process.env.VERCEL)throw Error("Configure Supabase to persist this deployment.");
  const dir=process.env.CAMPUSFEST_DATA_DIR||path.join(process.cwd(),".local");mkdirSync(dir,{recursive:true});
  local=new DatabaseSync(path.join(dir,"growth.sqlite"));local.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,season TEXT NOT NULL, payload TEXT NOT NULL);");return local;
}
/** Server-only Supabase headers. A legacy service_role JWT also goes in Authorization; a new sb_secret_ key goes in apikey only (the gateway rejects it as a Bearer token). */
export function supabaseHeaders(key=process.env.SUPABASE_SERVICE_ROLE_KEY):Record<string,string>{if(!key)throw Error("Missing Supabase service role configuration.");return key.startsWith("eyJ")?{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"}:{apikey:key,"Content-Type":"application/json"}}
const headers=()=>supabaseHeaders();
export async function entries(season:Season):Promise<Entry[]>{
  if(url()){
    const result:Entry[]=[];let offset=0;
    for(;;){const r=await fetch(url()+"/rest/v1/growth_events?season=eq."+season+"&select=payload&order=seq.asc&limit=500&offset="+offset,{headers:headers(),cache:"no-store"});if(!r.ok)throw Error("Could not read the Supabase event store.");const rows=await r.json();result.push(...rows.map((v:{payload:Entry})=>v.payload));if(rows.length<500)return result;offset+=500}
  }
  return db().prepare("SELECT payload FROM events WHERE season=? ORDER BY seq").all(season).map(x=>JSON.parse(x.payload as string));
}
/** With Supabase as the store, local runs keep .local/growth.sqlite as an exact mirror (off on Vercel, or with SUPABASE_MIRROR_LOCAL=0). */
const mirroring=()=>Boolean(url())&&!process.env.VERCEL&&process.env.SUPABASE_MIRROR_LOCAL!=="0";
function mirrorAppend(entry:Entry){try{db().prepare("INSERT OR IGNORE INTO events(id,season,payload) VALUES(?,?,?)").run(entry.id,entry.season,JSON.stringify(entry))}catch(e){console.warn("Local mirror skipped:",(e as Error).message)}}
/** Replaces the local copy of a season with Supabase's, in order. Used after erasures, which rewrite earlier events. */
export async function mirrorSeason(season:Season){
  if(!mirroring())return;
  try{const list=await entries(season),store=db();store.exec("BEGIN IMMEDIATE");try{store.prepare("DELETE FROM events WHERE season=?").run(season);const ins=store.prepare("INSERT INTO events(id,season,payload) VALUES(?,?,?)");for(const e of list)ins.run(e.id,season,JSON.stringify(e));store.exec("COMMIT")}catch(e){store.exec("ROLLBACK");throw e}}
  catch(e){console.warn("Local mirror skipped:",(e as Error).message)}
}
export async function append(entry:Entry,expected:number){
  if(url()){const r=await fetch(url()+"/rest/v1/rpc/append_growth_event",{method:"POST",headers:headers(),body:JSON.stringify({new_event:entry,expected_count:expected})});if(!r.ok)throw Error("Could not save the Supabase change.");if(!await r.json())throw new Error("The workspace changed. Refresh and try again.");if(mirroring())mirrorAppend(entry);return}
  const store=db();store.exec("BEGIN IMMEDIATE");try{
    if(!store.prepare("SELECT 1 FROM events WHERE id=?").get(entry.id)){
      const row=store.prepare("SELECT COUNT(*) AS n FROM events WHERE season=?").get(entry.season)!;
      if(row.n!==expected)throw Error("The workspace changed. Refresh and try again.");
      store.prepare("INSERT INTO events(id,season,payload) VALUES(?,?,?)").run(entry.id,entry.season,JSON.stringify(entry));
    }
    store.exec("COMMIT");
  }catch(error){store.exec("ROLLBACK");throw error}
}
