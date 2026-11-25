// Linked filters: which campaign, channel, owner and industry values still have records under the other choices.
export type Dim="campaign"|"channel"|"owner"|"industry";
type Row=Record<string,any>;
export type FacetRecord={brand:string;campaign:string;group:string;channel:string;owner:string;industry:string};
export const filterDims:[Dim,string][]=[["campaign","Campaign"],["channel","Channel group"],["owner","Owner"],["industry","Industry"]];

/** True when a record matches one filter value. Mirrors the metrics engine: channel matches the warm/cold group or the channel name. */
export function hit(r:FacetRecord,dim:Dim,v:string){
  if(dim==="channel")return v===r.group||v===r.channel;
  return r[dim]===v;
}
/** Distinct brands matching every selected filter except `skip`, optionally with `skip` set to `value`. */
export function facetCount(recs:FacetRecord[],filters:Record<string,string>,skip?:Dim,value?:string){
  const active=filterDims.map(([d])=>d).filter(d=>d!==skip&&filters[d]);
  const ids=new Set<string>();
  for(const r of recs)if(active.every(d=>hit(r,d,filters[d]))&&(!skip||hit(r,skip,value!)))ids.add(r.brand);
  return ids.size;
}
/** Brands and deals as filterable records. Deals count for their own owner, who often differs from the brand owner. */
export function filterRecords(opts:Row):FacetRecord[]{
  const channel=new Map<string,string>((opts.campaigns||[]).map((c:Row)=>[c.id,c.channel]));
  const rec=(brand:string,campaign:string,group:string,owner:string,industry:string)=>({brand,campaign:campaign||"",group:group||"",channel:channel.get(campaign)||"",owner:owner||"",industry:industry||""});
  return [...(opts.brands||[]).map((b:Row)=>rec(b.id,b.campaignId,b.group,b.ownerId,b.industry)),...(opts.deals||[]).map((d:Row)=>rec(d.brandId,d.campaignId,d.group,d.ownerId,d.industry))];
}

