create table if not exists public.growth_events (
  seq bigint generated always as identity primary key,
  id text not null unique,
  season text not null check (season in ('2025','2026')),
  payload jsonb not null
);
alter table public.growth_events enable row level security;
revoke all on public.growth_events from anon, authenticated;
create index if not exists growth_events_season_seq on public.growth_events(season,seq);
create or replace function public.append_growth_event(new_event jsonb,expected_count integer)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new_event->>'season'));
  if exists(select 1 from growth_events where id=new_event->>'id') then return true; end if;
  if (select count(*) from growth_events where season=new_event->>'season') <> expected_count then return false; end if;
  insert into growth_events(id,season,payload) values(new_event->>'id',new_event->>'season',new_event);
  return true;
end;
$$;
revoke all on function public.append_growth_event(jsonb,integer) from public,anon,authenticated;
grant execute on function public.append_growth_event(jsonb,integer) to service_role;
