-- Additive staging metadata. Existing production records remain unmarked.

alter table public.listing_queue
  add column if not exists environment text null,
  add column if not exists test_run_id uuid null,
  add column if not exists expires_at timestamptz null;

alter table public.listing_queue
  drop constraint if exists listing_queue_environment_check;

alter table public.listing_queue
  add constraint listing_queue_environment_check
  check (environment is null or environment in ('staging'));

create index if not exists listing_queue_staging_expiry_idx
  on public.listing_queue(expires_at)
  where environment = 'staging' and expires_at is not null;

comment on column public.listing_queue.environment is
  'Set only by the staging server runtime. Null is the existing production behavior.';

comment on column public.listing_queue.test_run_id is
  'Staging-only UUID that groups a test run for auditable cleanup.';

comment on column public.listing_queue.expires_at is
  'Staging-only cleanup eligibility timestamp. No database schedule is created by this migration.';
