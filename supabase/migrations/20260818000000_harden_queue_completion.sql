-- Queue idempotency and terminal Vendoo-completion receipt support.
-- This migration is intentionally unapplied until the reviewed release workflow runs it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

alter table public.listing_queue
  add column if not exists environment text null,
  add column if not exists create_operation_id text null,
  add column if not exists create_request_sha256 text null,
  add column if not exists agent_item_fingerprint text null;

alter table public.listing_queue
  drop constraint if exists listing_queue_environment_check,
  drop constraint if exists listing_queue_create_idempotency_pair_check,
  drop constraint if exists listing_queue_create_idempotency_bundle_check,
  drop constraint if exists listing_queue_create_operation_id_format_check,
  drop constraint if exists listing_queue_create_request_sha256_format_check,
  drop constraint if exists listing_queue_agent_item_fingerprint_format_check;

alter table public.listing_queue
  add constraint listing_queue_environment_check
    check (environment is null or environment = 'staging'),
  add constraint listing_queue_create_idempotency_bundle_check
    check (
      (
        create_operation_id is null
        and create_request_sha256 is null
        and agent_item_fingerprint is null
      )
      or
      (
        create_operation_id is not null
        and create_request_sha256 is not null
        and agent_item_fingerprint is not null
      )
    ),
  add constraint listing_queue_create_operation_id_format_check
    check (
      create_operation_id is null
      or create_operation_id ~ '^[A-Za-z0-9._:-]{8,128}$'
    ),
  add constraint listing_queue_create_request_sha256_format_check
    check (
      create_request_sha256 is null
      or create_request_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint listing_queue_agent_item_fingerprint_format_check
    check (
      agent_item_fingerprint is null
      or agent_item_fingerprint ~ '^[0-9a-f]{64}$'
    );

create unique index if not exists listing_queue_create_operation_id_uidx
  on public.listing_queue(create_operation_id)
  where create_operation_id is not null;

create unique index if not exists listing_queue_staging_storage_path_uidx
  on public.listing_queue_photos(storage_path)
  where storage_path like 'lpu/staging/%';

comment on column public.listing_queue.create_operation_id is
  'Optional authenticated client operation identity. Universal agent Queue creates must set it; exact retries reuse the one logical row.';

comment on column public.listing_queue.create_request_sha256 is
  'SHA-256 of canonical compact JSON business request content, excluding both create idempotency fields.';

comment on column public.listing_queue.agent_item_fingerprint is
  'Autonomous-agent item identity bound into the Queue-create request hash and required for verified terminal completion.';

create or replace function public.complete_listing_queue_vendoo(
  p_queue_id uuid,
  p_expected_status text,
  p_expected_environment text,
  p_transformed_lpu_sha256 text,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  queue_row public.listing_queue%rowtype;
  calculated_lpu_sha256 text;
  server_completed_at timestamptz;
begin
  select *
    into queue_row
    from public.listing_queue
   where id = p_queue_id
   for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;

  if p_receipt is null
     or pg_catalog.jsonb_typeof(p_receipt) is distinct from 'object'
     or p_receipt ->> 'schemaVersion' is distinct from '1'
     or p_receipt ->> 'kind' is distinct from 'vendoo_completion'
     or p_receipt ->> 'queueId' is distinct from p_queue_id::text
     or p_receipt ->> 'expectedStatus' is distinct from p_expected_status
     or p_receipt ->> 'transformedLpuSha256' is distinct from p_transformed_lpu_sha256
     or p_expected_environment not in ('staging', 'production')
     or (
       p_expected_environment = 'staging'
       and queue_row.environment is distinct from 'staging'
     )
     or (
       p_expected_environment = 'production'
       and queue_row.environment is not null
     )
     or p_receipt ->> 'itemFingerprint' is distinct from queue_row.agent_item_fingerprint
     or not coalesce((p_receipt ->> 'itemFingerprint') ~ '^[0-9a-f]{64}$', false)
     or not coalesce((p_receipt ->> 'vendooDraftIdentitySha256') ~ '^[0-9a-f]{64}$', false)
     or not coalesce((p_receipt ->> 'fieldLedgerSha256') ~ '^[0-9a-f]{64}$', false)
     or not coalesce((p_receipt ->> 'finalManifestSha256') ~ '^[0-9a-f]{64}$', false)
     or not coalesce((p_receipt ->> 'seoReviewSha256') ~ '^[0-9a-f]{64}$', false)
     or coalesce(p_receipt ->> 'completedAt', '') = ''
     or p_receipt - 'schemaVersion' - 'kind' - 'queueId' - 'expectedStatus'
          - 'itemFingerprint' - 'transformedLpuSha256'
          - 'vendooDraftIdentitySha256' - 'verifiedMarketplaces'
          - 'fieldLedgerSha256' - 'finalManifestSha256' - 'seoReviewSha256'
          - 'completedAt'
          <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_receipt -> 'verifiedMarketplaces') is distinct from 'array' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'current_status', queue_row.status
    );
  end if;

  if pg_catalog.jsonb_array_length(p_receipt -> 'verifiedMarketplaces') is distinct from 5
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(
           p_receipt -> 'verifiedMarketplaces'
         ) as marketplace_receipt
        where pg_catalog.jsonb_typeof(marketplace_receipt) is distinct from 'object'
           or marketplace_receipt - 'marketplace' - 'status' <> '{}'::jsonb
     )
     or not (
       p_receipt -> 'verifiedMarketplaces' @>
       '[
         {"marketplace":"ebay","status":"verified"},
         {"marketplace":"etsy","status":"verified"},
         {"marketplace":"poshmark","status":"verified"},
         {"marketplace":"mercari","status":"verified"},
         {"marketplace":"depop","status":"verified"}
       ]'::jsonb
     ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'current_status', queue_row.status
    );
  end if;

  if queue_row.status = 'sent_to_vendoo' then
    if queue_row.vendoo_send_status = p_receipt
       and queue_row.sent_to_vendoo_at is not null then
      return pg_catalog.jsonb_build_object(
        'outcome', 'replay',
        'sent_to_vendoo_at', queue_row.sent_to_vendoo_at
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'current_status', queue_row.status
    );
  end if;

  if p_expected_status <> 'lpu_generated'
     or queue_row.status <> p_expected_status
     or queue_row.vendoo_send_status is not null
     or queue_row.sent_to_vendoo_at is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'current_status', queue_row.status
    );
  end if;

  calculated_lpu_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(coalesce(queue_row.final_lpu_output, ''), 'UTF8')
    ),
    'hex'
  );
  if calculated_lpu_sha256 <> p_transformed_lpu_sha256 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'conflict',
      'current_status', queue_row.status
    );
  end if;

  server_completed_at := pg_catalog.clock_timestamp();
  update public.listing_queue
     set status = 'sent_to_vendoo',
         vendoo_send_status = p_receipt,
         sent_to_vendoo_at = server_completed_at
   where id = p_queue_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'sent_to_vendoo_at', server_completed_at
  );
end;
$$;

revoke all on function public.complete_listing_queue_vendoo(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_listing_queue_vendoo(uuid, text, text, text, jsonb)
  to service_role;

comment on function public.complete_listing_queue_vendoo(uuid, text, text, text, jsonb) is
  'Service-role-only, row-locked, idempotent terminal Queue completion transition. Generated listing content is never updated.';
