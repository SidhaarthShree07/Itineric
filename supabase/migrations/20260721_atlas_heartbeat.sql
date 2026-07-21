-- This table supports one intentionally small daily user-database request from the Cloudflare Cron Trigger.
-- The service-role key is stored only in Worker secrets and bypasses the RLS policy below.
create table if not exists public.atlas_heartbeats (
  id bigint generated always as identity primary key,
  source text not null check (source = 'cloudflare_cron'),
  observed_at timestamptz not null default now()
);

alter table public.atlas_heartbeats enable row level security;

revoke all on table public.atlas_heartbeats from anon, authenticated;

create index if not exists atlas_heartbeats_observed_at_idx
  on public.atlas_heartbeats (observed_at desc);
