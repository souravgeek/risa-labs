import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mirrorSeason,supabaseHeaders,type Entry,type Season } from './storage';

const erasedCall={contactId:null,transcript:[],insights:null,brief:null,toolProposals:[],token:null,chunks:[],status:'removed',review:'removed'};
const erasedContact={name:'Removed',active:false,consent:false,deleted:true};
/** The contact's deletion also applies to earlier snapshots and already archived transcripts. */
export async function eraseDemoContact(season:Season,contactId:string) {
  const url=process.env.SUPABASE_SERVICE_ROLE_KEY?process.env.SUPABASE_URL?.replace(/\/$/,''):undefined;
  if(url) {
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!key)throw new Error('Configure the Supabase service role for contact removal.');
    const r=await fetch(url+'/rest/v1/rpc/erase_call_contact',{method:'POST',headers:supabaseHeaders(key),body:JSON.stringify({p_season:season,p_contact:contactId})});
    if(!r.ok)throw new Error('Could not erase this contact. Check that the call privacy migration is installed.');
    await mirrorSeason(season); // the local mirror must lose the transcripts too
    return;
  }
  const store=new DatabaseSync(path.join(process.env.CAMPUSFEST_DATA_DIR || path.join(process.cwd(),'.local'),'growth.sqlite'));
  try{
    store.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const records=store.prepare('SELECT payload FROM events WHERE season=? ORDER BY seq').all(season).map(v=>JSON.parse(String(v.payload)) as Entry);
    const callIds=new Set(records.flatMap(e=>e.changes.filter(c=>c.table==='calls' && c.row.contactId===contactId).map(c=>c.row.id)));
    const update=store.prepare('UPDATE events SET payload=? WHERE id=?');
    for(const event of records){
      let touched=false;
      event.changes=event.changes.map(item=>{
        if(item.table==='allowlist' && item.row.id===contactId){touched=true;return {table:item.table,row:{id:contactId,...erasedContact}};}
        if(item.table==='calls' && callIds.has(item.row.id)){touched=true;return {table:item.table,row:{...item.row,...erasedCall}};}
        return item;
      });
      if(touched) update.run(JSON.stringify(event),event.id);
    }
    const receipt:Entry={id:'erase-'+randomUUID(),season,at:new Date().toISOString(),label:'Erased a demo contact and call transcripts',actor:'Team',entity:contactId,changes:[]};
    store.prepare('INSERT INTO events(id,season,payload) VALUES(?,?,?)').run(receipt.id,season,JSON.stringify(receipt));
    store.exec('COMMIT');
  }catch(e){try{store.exec('ROLLBACK');}catch{}throw e;}finally{store.close();}
}
