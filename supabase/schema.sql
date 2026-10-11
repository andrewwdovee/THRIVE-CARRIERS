-- The Thrive / Lead Tech relay, on Postgres.
--
-- Every portal -- the LOA desk, Thrive Command, the Lead Tech fulfillment
-- board, the onboarding pages -- already reads and writes through one
-- Worker, thrive-relay, and nothing else touches the store. So moving to
-- Supabase is a change behind that Worker: no portal changes, no new keys
-- in any page, nothing to redeploy on the front end.
--
-- Run this once in the Supabase SQL editor. It is safe to re-run: every
-- statement is IF NOT EXISTS or CREATE OR REPLACE.
--
-- Row Level Security is ON with no policies anywhere, which denies the
-- anon and authenticated roles outright. Only the service role key -- held
-- by the Worker as a secret, never shipped to a browser -- can read or
-- write. That is deliberate: these tables hold a real book of business.

-- ---------------------------------------------------------------- kv
-- What the portals store today, carried over as-is. The board keeps its
-- whole state in one row here, which is how it already works; this table
-- is what lets the migration happen without touching a single page.
create table if not exists public.kv (
  key        text primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- orders
-- A payment, as Stripe pushed it. Several events describe one payment --
-- the checkout, the charge, the invoice -- and they arrive out of order,
-- so a row is merged into rather than replaced.
--
-- The typed columns are the ones worth querying. `raw` holds the whole
-- merged record, because the shape grows as events arrive and a fixed
-- column list would quietly drop whatever it did not know about.
create table if not exists public.orders (
  id             text primary key,
  received_at    timestamptz not null,
  amount         integer,
  currency       text,
  status         text,
  payment_status text,
  customer       text,
  email          text,
  product_name   text,
  receipt_url    text,
  refunded       boolean     not null default false,
  raw            jsonb       not null,
  updated_at     timestamptz not null default now()
);

create index if not exists orders_received_at_idx on public.orders (received_at desc);
create index if not exists orders_email_idx       on public.orders (lower(email));
create index if not exists orders_status_idx      on public.orders (payment_status, received_at desc);

-- ------------------------------------------------- onboarding submissions
-- A signed agreement. Split in two exactly as the Worker splits it today:
-- the row the board lists, and the images, which are base64 data URLs and
-- run to megabytes. Listing the board must not drag those along.
create table if not exists public.onboarding_submissions (
  id                 text primary key,
  signed_at          timestamptz not null,
  legal_name         text        not null,
  business           text,
  email              text        not null,
  phone              text,
  npn                text,
  referrer           text,
  start_time         text,
  signed_name        text,
  signed_date        text,
  thrive_signed_name text,
  thrive_signed_date text,
  agreement_version  text,
  steps              jsonb       not null default '{}'::jsonb,
  reviewed           boolean     not null default false,
  raw                jsonb       not null,
  created_at         timestamptz not null default now()
);

create index if not exists onboarding_signed_at_idx on public.onboarding_submissions (signed_at desc);
create index if not exists onboarding_email_idx     on public.onboarding_submissions (lower(email));

-- The signatures and the headshot. One row per submission, fetched only
-- when somebody opens that submission or downloads its PDF.
create table if not exists public.onboarding_documents (
  id               text primary key
                     references public.onboarding_submissions (id) on delete cascade,
  signature        text,
  thrive_signature text,
  photo            text,
  created_at       timestamptz not null default now()
);

-- -------------------------------------------------------- rate limiting
-- Cloudflare KV expired these for us. Postgres does not, so the row
-- carries its own expiry and stale ones are swept on write.
create table if not exists public.rate_limits (
  bucket     text primary key,
  count      integer     not null default 0,
  expires_at timestamptz not null
);

create index if not exists rate_limits_expires_idx on public.rate_limits (expires_at);

-- Count one hit against a bucket and return the count BEFORE it, which is
-- what the Worker compares against its ceiling. Doing it in one statement
-- closes the read-then-write gap that let two requests past the limit
-- together on KV.
create or replace function public.bump_rate(p_bucket text, p_ttl_seconds integer)
returns integer
language plpgsql
as $$
declare
  seen integer;
begin
  delete from public.rate_limits where expires_at < now();

  select count into seen from public.rate_limits where bucket = p_bucket;

  insert into public.rate_limits (bucket, count, expires_at)
  values (p_bucket, 1, now() + make_interval(secs => p_ttl_seconds))
  on conflict (bucket) do update
    set count = public.rate_limits.count + 1;

  return coalesce(seen, 0);
end;
$$;

-- --------------------------------------------------------------- locking
-- Nothing but the Worker's service role key gets in.
alter table public.kv                     enable row level security;
alter table public.orders                 enable row level security;
alter table public.onboarding_submissions enable row level security;
alter table public.onboarding_documents   enable row level security;
alter table public.rate_limits            enable row level security;
