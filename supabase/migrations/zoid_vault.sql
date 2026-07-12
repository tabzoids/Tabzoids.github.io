-- Zoid-Vault: master pull-tab catalog (reference data, brand-agnostic)
-- Source: Notion "Bubly Water" database schema, cleaned + generalized.
-- Not user data. Public read of published rows; admin-only writes.

create table if not exists public.zoid_vault (
  id                       uuid primary key default gen_random_uuid(),

  -- identity / SEO
  title                    text not null,
  slug                     text unique,

  -- brand
  brand                    text,
  brand_id                 text,
  brand_website            text,
  manufacturer             text,
  series                   text,

  -- specimen attributes
  flavor                   text,
  color_type               text,
  color_variant            text,     -- Notion: color_varient
  variation                text,
  mark_type                text,
  mark_media               text,
  tab_type                 text,
  notch                    text,
  material                 text,
  era                      text,
  rarity                   text,
  misprint                 text,     -- Notion: missprint
  country                  text,

  -- release
  release_date             date,
  release_number           numeric,

  -- images: full + thumbnail public URLs (hosted on Cloudflare R2).
  -- DB stores URLs only; storage backend is decoupled and swappable.
  image_front              text,
  image_front_thumb        text,
  image_back               text,
  image_back_thumb         text,
  image_can_top            text,   -- optional, for later
  image_can_top_thumb      text,

  -- inventory
  tab_inventory            integer,
  intact_inventory         integer,

  -- bounty
  bounty_status            text not null default 'none',
  bounty_reward            numeric(10,2),
  bounty_publishing_status text not null default 'none',

  -- SEO / patent / notes
  seo_title                text,
  seo_alt_text             text,     -- Notion: seo_alt_txt
  patent_number            text,
  patent_url               text,
  note                     text,

  -- publishing
  publishing_status        text not null default 'Not Set',

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- helpful lookup indexes
create index if not exists zoid_vault_brand_idx             on public.zoid_vault (brand);
create index if not exists zoid_vault_series_idx            on public.zoid_vault (series);
create index if not exists zoid_vault_rarity_idx            on public.zoid_vault (rarity);
create index if not exists zoid_vault_publishing_status_idx on public.zoid_vault (publishing_status);
create index if not exists zoid_vault_release_number_idx    on public.zoid_vault (release_number);

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists zoid_vault_set_updated_at on public.zoid_vault;
create trigger zoid_vault_set_updated_at
  before update on public.zoid_vault
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
alter table public.zoid_vault enable row level security;

-- Anyone (anon + logged in) can read ONLY published specimens.
-- This is what search engines / early visitors crawl.
drop policy if exists "public read published" on public.zoid_vault;
create policy "public read published"
  on public.zoid_vault
  for select
  using (publishing_status = 'Published');

-- Admins (profiles.is_admin) can read everything and write.
drop policy if exists "admin full access" on public.zoid_vault;
create policy "admin full access"
  on public.zoid_vault
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );
