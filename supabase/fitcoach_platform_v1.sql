-- FitCoach account/sync platform v1.
-- Apply only to the reviewed Supabase project after taking a schema backup.
-- User state is application-encrypted by the API before these columns receive it.

create extension if not exists pgcrypto;

create table if not exists public.fitcoach_subjects (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fitcoach_consents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.fitcoach_subjects (id) on delete cascade,
  policy text not null check (length(policy) between 1 and 80),
  policy_version text not null check (length(policy_version) between 1 and 80),
  status text not null check (status in ('accepted', 'revoked')),
  decided_at timestamptz not null default now()
);

create index if not exists fitcoach_consents_subject_policy_idx
  on public.fitcoach_consents (subject_id, policy, decided_at desc);

create table if not exists public.fitcoach_sync_documents (
  subject_id uuid not null references public.fitcoach_subjects (id) on delete cascade,
  document_type text not null check (document_type = 'state'),
  revision bigint not null check (revision > 0),
  schema_version integer not null check (schema_version between 1 and 100),
  algorithm text not null check (algorithm = 'AES-256-GCM'),
  key_version text not null check (length(key_version) between 1 and 40),
  nonce_b64 text not null,
  ciphertext_b64 text not null,
  auth_tag_b64 text not null,
  plaintext_digest text not null check (plaintext_digest ~ '^[0-9a-f]{64}$'),
  plaintext_bytes integer not null check (plaintext_bytes between 1 and 1500000),
  last_device_id text not null check (length(last_device_id) between 8 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject_id, document_type)
);

create table if not exists public.fitcoach_entitlements (
  subject_id uuid not null references public.fitcoach_subjects (id) on delete cascade,
  source text not null check (source in ('app_store', 'play_store', 'web')),
  product_id text not null check (length(product_id) between 1 and 160),
  status text not null check (status in ('active', 'grace', 'paused', 'expired', 'revoked')),
  provider_reference_digest text not null check (provider_reference_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject_id, source, product_id)
);

create table if not exists public.fitcoach_subscription_events (
  event_id text primary key check (length(event_id) between 16 and 180),
  source text not null check (source in ('app_store', 'play_store', 'web')),
  event_type text not null check (length(event_type) between 1 and 100),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  processed_at timestamptz not null default now()
);

create table if not exists public.fitcoach_deletion_tombstones (
  subject_digest text primary key check (subject_digest ~ '^[0-9a-f]{64}$'),
  request_id text not null unique check (request_id ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.fitcoach_subjects enable row level security;
alter table public.fitcoach_consents enable row level security;
alter table public.fitcoach_sync_documents enable row level security;
alter table public.fitcoach_entitlements enable row level security;
alter table public.fitcoach_subscription_events enable row level security;
alter table public.fitcoach_deletion_tombstones enable row level security;

drop policy if exists fitcoach_subject_read_own on public.fitcoach_subjects;
create policy fitcoach_subject_read_own on public.fitcoach_subjects
  for select to authenticated using (id = auth.uid());

drop policy if exists fitcoach_consent_read_own on public.fitcoach_consents;
create policy fitcoach_consent_read_own on public.fitcoach_consents
  for select to authenticated using (subject_id = auth.uid());

drop policy if exists fitcoach_sync_read_own on public.fitcoach_sync_documents;
create policy fitcoach_sync_read_own on public.fitcoach_sync_documents
  for select to authenticated using (subject_id = auth.uid());

drop policy if exists fitcoach_entitlement_read_own on public.fitcoach_entitlements;
create policy fitcoach_entitlement_read_own on public.fitcoach_entitlements
  for select to authenticated using (subject_id = auth.uid());

revoke all on public.fitcoach_subjects from anon, authenticated;
revoke all on public.fitcoach_consents from anon, authenticated;
revoke all on public.fitcoach_sync_documents from anon, authenticated;
revoke all on public.fitcoach_entitlements from anon, authenticated;
revoke all on public.fitcoach_subscription_events from anon, authenticated;
revoke all on public.fitcoach_deletion_tombstones from anon, authenticated;

-- Authenticated clients use the bounded API and receive decrypted portable
-- state only after token validation. Direct table reads remain revoked so
-- ciphertext, consent history, and billing metadata cannot be scraped.
grant all on public.fitcoach_subjects to service_role;
grant all on public.fitcoach_consents to service_role;
grant all on public.fitcoach_sync_documents to service_role;
grant all on public.fitcoach_entitlements to service_role;
grant all on public.fitcoach_subscription_events to service_role;
grant all on public.fitcoach_deletion_tombstones to service_role;

create or replace function public.fitcoach_record_consent(
  p_subject_id uuid,
  p_policy text,
  p_policy_version text,
  p_status text
)
returns table (policy text, policy_version text, status text, decided_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_policy <> 'sync_processing'
     or p_policy_version !~ '^\d{4}-\d{2}-\d{2}(\.\d+)?$'
     or p_status not in ('accepted', 'revoked') then
    raise exception using errcode = '22023', message = 'FITCOACH_INVALID_CONSENT';
  end if;

  if exists (
    select 1 from public.fitcoach_deletion_tombstones
    where subject_digest = encode(digest(p_subject_id::text, 'sha256'), 'hex')
  ) then
    raise exception using errcode = 'P0001', message = 'FITCOACH_ACCOUNT_DELETED';
  end if;

  insert into public.fitcoach_subjects (id)
  values (p_subject_id)
  on conflict (id) do update set updated_at = now();

  return query
  insert into public.fitcoach_consents (subject_id, policy, policy_version, status)
  values (p_subject_id, p_policy, p_policy_version, p_status)
  returning fitcoach_consents.policy,
            fitcoach_consents.policy_version,
            fitcoach_consents.status,
            fitcoach_consents.decided_at;

  if p_status = 'revoked' then
    delete from public.fitcoach_sync_documents where subject_id = p_subject_id;
  end if;
end;
$$;

create or replace function public.fitcoach_put_sync_document(
  p_subject_id uuid,
  p_document_type text,
  p_base_revision bigint,
  p_device_id text,
  p_consent_version text,
  p_schema_version integer,
  p_algorithm text,
  p_key_version text,
  p_nonce_b64 text,
  p_ciphertext_b64 text,
  p_auth_tag_b64 text,
  p_plaintext_digest text,
  p_plaintext_bytes integer
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer := 0;
begin
  if p_document_type <> 'state'
     or p_base_revision < 0
     or length(p_device_id) not between 8 and 120
     or p_schema_version not between 1 and 100
     or p_algorithm <> 'AES-256-GCM'
     or p_plaintext_bytes not between 1 and 1500000 then
    raise exception using errcode = '22023', message = 'FITCOACH_INVALID_SYNC_DOCUMENT';
  end if;

  if exists (
    select 1 from public.fitcoach_deletion_tombstones
    where subject_digest = encode(digest(p_subject_id::text, 'sha256'), 'hex')
  ) then
    raise exception using errcode = 'P0001', message = 'FITCOACH_ACCOUNT_DELETED';
  end if;

  if not exists (
    select 1
    from public.fitcoach_consents c
    where c.subject_id = p_subject_id
      and c.policy = 'sync_processing'
      and c.policy_version = p_consent_version
      and c.status = 'accepted'
      and not exists (
        select 1 from public.fitcoach_consents newer
        where newer.subject_id = c.subject_id
          and newer.policy = c.policy
          and newer.decided_at > c.decided_at
      )
  ) then
    raise exception using errcode = 'P0001', message = 'FITCOACH_SYNC_CONSENT_REQUIRED';
  end if;

  if p_base_revision = 0 then
    insert into public.fitcoach_sync_documents (
      subject_id, document_type, revision, schema_version, algorithm, key_version,
      nonce_b64, ciphertext_b64, auth_tag_b64, plaintext_digest, plaintext_bytes,
      last_device_id
    ) values (
      p_subject_id, p_document_type, 1, p_schema_version, p_algorithm, p_key_version,
      p_nonce_b64, p_ciphertext_b64, p_auth_tag_b64, p_plaintext_digest,
      p_plaintext_bytes, p_device_id
    ) on conflict (subject_id, document_type) do nothing;
  else
    update public.fitcoach_sync_documents d
    set revision = d.revision + 1,
        schema_version = p_schema_version,
        algorithm = p_algorithm,
        key_version = p_key_version,
        nonce_b64 = p_nonce_b64,
        ciphertext_b64 = p_ciphertext_b64,
        auth_tag_b64 = p_auth_tag_b64,
        plaintext_digest = p_plaintext_digest,
        plaintext_bytes = p_plaintext_bytes,
        last_device_id = p_device_id,
        updated_at = now()
    where d.subject_id = p_subject_id
      and d.document_type = p_document_type
      and d.revision = p_base_revision;
  end if;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using errcode = 'P0001', message = 'FITCOACH_SYNC_CONFLICT';
  end if;

  return query
    select d.revision, d.updated_at
    from public.fitcoach_sync_documents d
    where d.subject_id = p_subject_id and d.document_type = p_document_type;
end;
$$;

create or replace function public.fitcoach_apply_verified_entitlement(
  p_subject_id uuid,
  p_event_id text,
  p_source text,
  p_event_type text,
  p_product_id text,
  p_status text,
  p_provider_reference_digest text,
  p_payload_digest text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted integer := 0;
begin
  if p_source not in ('app_store', 'play_store', 'web')
     or p_status not in ('active', 'grace', 'paused', 'expired', 'revoked')
     or p_event_id !~ '^[0-9a-f]{64}$'
     or length(p_event_type) not between 1 and 100
     or length(p_product_id) not between 3 and 160
     or p_provider_reference_digest !~ '^[0-9a-f]{64}$'
     or p_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'FITCOACH_INVALID_ENTITLEMENT_EVENT';
  end if;

  if exists (
    select 1 from public.fitcoach_deletion_tombstones
    where subject_digest = encode(digest(p_subject_id::text, 'sha256'), 'hex')
  ) then
    raise exception using errcode = 'P0001', message = 'FITCOACH_ACCOUNT_DELETED';
  end if;

  insert into public.fitcoach_subscription_events (event_id, source, event_type, payload_digest)
  values (p_event_id, p_source, p_event_type, p_payload_digest)
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    if not exists (
      select 1 from public.fitcoach_subscription_events e
      where e.event_id = p_event_id
        and e.source = p_source
        and e.payload_digest = p_payload_digest
    ) then
      raise exception using errcode = 'P0001', message = 'FITCOACH_SUBSCRIPTION_REPLAY_MISMATCH';
    end if;
    return false;
  end if;

  insert into public.fitcoach_subjects (id)
  values (p_subject_id)
  on conflict (id) do update set updated_at = now();

  insert into public.fitcoach_entitlements (
    subject_id, source, product_id, status, provider_reference_digest, expires_at
  ) values (
    p_subject_id, p_source, p_product_id, p_status, p_provider_reference_digest, p_expires_at
  )
  on conflict (subject_id, source, product_id)
  do update set status = excluded.status,
                provider_reference_digest = excluded.provider_reference_digest,
                expires_at = excluded.expires_at,
                updated_at = now();
  return true;
end;
$$;

create or replace function public.fitcoach_request_account_deletion(
  p_subject_id uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  digest_value text := encode(digest(p_subject_id::text, 'sha256'), 'hex');
begin
  if p_request_id !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'FITCOACH_INVALID_DELETION_REQUEST';
  end if;
  insert into public.fitcoach_deletion_tombstones (subject_digest, request_id)
  values (digest_value, p_request_id)
  on conflict (subject_digest) do nothing;

  delete from public.fitcoach_subjects where id = p_subject_id;
  update public.fitcoach_deletion_tombstones
  set completed_at = now()
  where subject_digest = digest_value;
  return true;
end;
$$;

revoke all on function public.fitcoach_record_consent(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fitcoach_put_sync_document(uuid, text, bigint, text, text, integer, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fitcoach_apply_verified_entitlement(uuid, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fitcoach_request_account_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.fitcoach_record_consent(uuid, text, text, text) to service_role;
grant execute on function public.fitcoach_put_sync_document(uuid, text, bigint, text, text, integer, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.fitcoach_apply_verified_entitlement(uuid, text, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.fitcoach_request_account_deletion(uuid, text) to service_role;
