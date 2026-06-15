-- First tracked Supabase migration convention for this project.
-- This migration is design-only until applied manually through the project's chosen Supabase workflow.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.listing_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  status text not null,
  title text null,
  subtitle text null,
  category_summary text null,
  thumbnail_path text null,
  final_list_price text null,
  item_intake jsonb not null default '{}'::jsonb,
  selling_brief text null,
  final_lpu_output text null,
  payload_snapshot jsonb null,
  pricing_snapshot jsonb null,
  public_web_comps_snapshot jsonb null,
  manual_comp_inputs jsonb null,
  vendoo_send_status jsonb null,
  app_version text null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  sent_to_vendoo_at timestamptz null,
  constraint listing_queue_status_check check (
    status in (
      'intake',
      'brief_generated',
      'lpu_generated',
      'payload_ready',
      'sent_to_vendoo',
      'needs_review',
      'error',
      'archived'
    )
  )
);

create table if not exists public.listing_queue_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listing_queue(id) on delete cascade,
  sort_order integer not null,
  storage_path text not null,
  image_url text null,
  file_name text null,
  mime_type text null,
  size bigint null,
  created_at timestamptz not null default now()
);

drop trigger if exists listing_queue_set_updated_at on public.listing_queue;
create trigger listing_queue_set_updated_at
before update on public.listing_queue
for each row
execute function public.set_updated_at();

create index if not exists listing_queue_status_idx
  on public.listing_queue(status);

create index if not exists listing_queue_created_at_idx
  on public.listing_queue(created_at desc);

create index if not exists listing_queue_updated_at_idx
  on public.listing_queue(updated_at desc);

create index if not exists listing_queue_archived_at_idx
  on public.listing_queue(archived_at);

create index if not exists listing_queue_photos_listing_id_idx
  on public.listing_queue_photos(listing_id);

create index if not exists listing_queue_photos_listing_id_sort_order_idx
  on public.listing_queue_photos(listing_id, sort_order);

alter table public.listing_queue enable row level security;
alter table public.listing_queue_photos enable row level security;

comment on table public.listing_queue is
  'V2 Listing Queue records. RLS is enabled, but no permissive anon policies are defined. Until a real auth/RLS ownership model is designed, queue API routes should use the server-side service role.';

comment on column public.listing_queue.user_id is
  'Nullable/deferred for future Supabase auth ownership. Current MVP has no proven auth/session model.';

comment on column public.listing_queue.payload_snapshot is
  'Sanitized extension payload snapshot. App helpers must remove dataUrl and signedUrl before durable storage.';

comment on table public.listing_queue_photos is
  'Durable ordered photo metadata for uploaded Supabase Storage objects. MVP requires upload-before-save; local-only File/dataUrl drafts are not persisted.';

comment on column public.listing_queue_photos.storage_path is
  'Required Supabase Storage path. Signed URLs are regenerated on demand and are not persisted.';
