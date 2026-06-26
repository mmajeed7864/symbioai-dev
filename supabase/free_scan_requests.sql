create extension if not exists pgcrypto;

create table if not exists public.free_scan_requests (
  id text primary key,
  idempotency_key text not null unique,
  name text not null default '',
  business text not null default '',
  email text not null default '',
  phone text not null default '',
  link text not null default '',
  need text not null default '',
  budget text not null default '',
  goal text not null default '',
  problem text not null default '',
  source_url text not null default '',
  status text not null default 'new',
  priority text not null default 'P0 - inbound free scan (reply first)',
  score text not null default '100/100 inbound',
  client_ip text not null default '',
  user_agent text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists free_scan_requests_created_at_idx
  on public.free_scan_requests (created_at desc);

create index if not exists free_scan_requests_status_idx
  on public.free_scan_requests (status);

create or replace function public.set_free_scan_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists free_scan_requests_set_updated_at on public.free_scan_requests;

create trigger free_scan_requests_set_updated_at
before update on public.free_scan_requests
for each row
execute function public.set_free_scan_updated_at();
