-- Install after schema.sql. Erasure deliberately overrides historical demo-contact visibility.
create or replace function public.erase_call_contact(p_season text,p_contact text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  call_ids text[];
  receipt_id text := 'erase-' || gen_random_uuid()::text;
begin
  perform pg_advisory_xact_lock(hashtext(p_season));
  select coalesce(array_agg(distinct c->'row'->>'id'),'{}'::text[]) into call_ids
  from growth_events e cross join lateral jsonb_array_elements(e.payload->'changes') c
  where e.season=p_season and c->>'table'='calls' and c->'row'->>'contactId'=p_contact;
  update growth_events e set payload=jsonb_set(e.payload,'{changes}',(
    select jsonb_agg(case
      when c->>'table'='allowlist' and c->'row'->>'id'=p_contact then
        jsonb_build_object('table','allowlist','row',jsonb_build_object('id',p_contact,'name','Removed','active',false,'consent',false,'deleted',true))
      when c->>'table'='calls' and c->'row'->>'id'=any(call_ids) then
        jsonb_set(c,'{row}',(c->'row') || '{"contactId":null,"transcript":[],"insights":null,"brief":null,"toolProposals":[],"token":null,"chunks":[],"status":"removed","review":"removed"}'::jsonb)
      else c end order by ord)
    from jsonb_array_elements(e.payload->'changes') with ordinality as elems(c,ord)
  )) where e.season=p_season and exists(select 1 from jsonb_array_elements(e.payload->'changes') c
    where (c->>'table'='allowlist' and c->'row'->>'id'=p_contact) or (c->>'table'='calls' and c->'row'->>'id'=any(call_ids)));
  insert into growth_events(id,season,payload) values(receipt_id,p_season,jsonb_build_object(
    'id',receipt_id,'season',p_season,'at',now(),'label','Erased a demo contact and call transcripts','actor','Team','entity',p_contact,'changes','[]'::jsonb));
end;
$$;
revoke all on function public.erase_call_contact(text,text) from public,anon,authenticated;
grant execute on function public.erase_call_contact(text,text) to service_role;
