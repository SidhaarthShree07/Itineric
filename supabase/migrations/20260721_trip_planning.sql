-- Project Atlas durable planning data.
-- The browser never reads these tables directly: the Worker owns access and keeps
-- the raw workspace credential client-side while the database stores only its hash.

create extension if not exists pgcrypto;

create table if not exists public.planner_workspaces (
  id uuid primary key default gen_random_uuid(),
  token_hash char(64) not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.planner_workspaces(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  destination text not null check (char_length(destination) between 2 and 160),
  title text not null check (char_length(title) between 1 and 160),
  start_date date,
  end_date date,
  days smallint not null check (days between 1 and 21),
  currency char(3) not null,
  total_budget numeric(12,2) not null check (total_budget > 0),
  travel_input jsonb not null,
  latest_version integer not null default 1 check (latest_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (workspace_id is not null or owner_id is not null),
  check (end_date is null or start_date is null or end_date > start_date)
);

create table if not exists public.trip_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  version integer not null check (version >= 1),
  generation_reason text not null check (generation_reason in ('initial', 'replan', 'chat_replan')),
  change_summary text,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  unique (trip_id, version)
);

create table if not exists public.trip_chat_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists trips_workspace_updated_idx
  on public.trips (workspace_id, updated_at desc)
  where workspace_id is not null;
create index if not exists trips_owner_updated_idx
  on public.trips (owner_id, updated_at desc)
  where owner_id is not null;
create index if not exists trip_versions_trip_version_idx
  on public.trip_versions (trip_id, version desc);
create index if not exists trip_chat_messages_trip_created_idx
  on public.trip_chat_messages (trip_id, created_at asc);
create index if not exists planner_workspaces_expiry_idx
  on public.planner_workspaces (expires_at);

create or replace function public.atlas_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
before update on public.trips
for each row execute function public.atlas_set_updated_at();

alter table public.planner_workspaces enable row level security;
alter table public.trips enable row level security;
alter table public.trip_versions enable row level security;
alter table public.trip_chat_messages enable row level security;

-- The public schema can be exposed by the Data API. These tables are Worker-only,
-- so do not grant anon/authenticated access or create permissive policies.
revoke all on table public.planner_workspaces from anon, authenticated;
revoke all on table public.trips from anon, authenticated;
revoke all on table public.trip_versions from anon, authenticated;
revoke all on table public.trip_chat_messages from anon, authenticated;
revoke execute on function public.atlas_set_updated_at() from public;
