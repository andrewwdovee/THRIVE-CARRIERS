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
-- `expires_at` is how Cloudflare KV's expirationTtl survives the move.
-- The relay leans on it for the rate-limit counters and for ageing out
-- the Stripe inbox, so the store honours it rather than making every
-- call site remember. Null means keep forever, which is most rows.
create table if not exists public.kv (
  key        text primary key,
  value      text        not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists kv_expires_idx on public.kv (expires_at)
  where expires_at is not null;

-- Nothing sweeps on a timer, so expired rows are stepped over on read and
-- cleared out whenever something is written. Cheap, and it keeps the
-- table from growing without bound on rate-limit keys.
create or replace function public.kv_sweep()
returns integer
language sql
as $$
  with gone as (delete from public.kv where expires_at < now() returning 1)
  select count(*)::integer from gone;
$$;

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

-- ---------------------------------------------------------- board_rows
-- The Lead Tech board keeps its whole state in one kv row: orders,
-- products, calls, refunds, wipes (the wallet ledger) and customers,
-- all as lists inside one blob. That is how a single bad write reset
-- four screens of the portal at once, and why there was nothing to
-- query when it happened -- the rows existed only as text.
--
-- Every list is also written out here, one database row per record.
-- The point is retrieval: each list can be read in SQL, checked, and
-- put back on its own, instead of the board being all-or-nothing.
--
-- This is an ARCHIVE, not a mirror. A record removed from the board
-- stays here, because the whole purpose is to still have it after
-- something removes it by accident. Reading it back is therefore
-- "what did this list look like", not "what is on the board now".
--
-- jsonb rather than a column per field: these lists grow fields as the
-- board does, and a fixed column list would quietly drop whatever it
-- did not know about -- which is the failure this table exists to
-- prevent. The views below give the common fields names.
create table if not exists public.board_rows (
  list       text        not null,
  id         text        not null,
  at         timestamptz,
  data       jsonb       not null,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (list, id)
);

create index if not exists board_rows_list_idx on public.board_rows (list, at desc nulls last);
create index if not exists board_rows_seen_idx on public.board_rows (updated_at desc);

-- Readable names over the jsonb, so the common questions are ordinary
-- SQL. They cost nothing and cannot drift out of step with the table.
create or replace view public.board_calls as
  select id, at,
         data->>'day'                      as day,
         (data->>'billable')::numeric      as billable,
         (data->>'googleCalls')::numeric   as google_calls,
         (data->>'googleRate')::numeric    as google_rate,
         (data->>'sold35')::numeric        as sold35,
         (data->>'sold40')::numeric        as sold40,
         data, updated_at
  from public.board_rows where list = 'calls';

create or replace view public.board_wallet as
  select id, at,
         data->>'userId'              as user_id,
         data->>'name'                as name,
         (data->>'amount')::numeric   as amount,
         data, updated_at
  from public.board_rows where list = 'wipes';

create or replace view public.board_refunds as
  select id, at,
         data->>'typeId'              as type_id,
         data->>'customer'            as customer,
         data->>'note'                as note,
         data->>'source'              as source,
         (data->>'amount')::numeric   as amount,
         data, updated_at
  from public.board_rows where list = 'refunds';

create or replace view public.board_orders as
  select id, at,
         data->>'paymentId'           as payment_id,
         data->>'chargeId'            as charge_id,
         data->>'email'               as email,
         (data->>'amount')::numeric   as amount,
         data->>'status'              as status,
         data, updated_at
  from public.board_rows where list = 'orders';

-- -------------------------------------------------------- refund slips
-- What an agent submitted through the public refund form. They are
-- stored one per key rather than in a list, so no single bad write can
-- take them all, but they were only readable by fetching each key. This
-- gives them names and makes them ordinary SQL alongside everything
-- else.
create or replace view public.refund_slips as
  select
    value::jsonb->>'id'                                        as id,
    to_timestamp(((value::jsonb->>'at')::bigint) / 1000)       as submitted,
    value::jsonb->>'first'                                     as first_name,
    value::jsonb->>'last'                                      as last_name,
    value::jsonb->>'email'                                     as email,
    value::jsonb->>'day'                                       as call_day,
    value::jsonb->>'kind'                                      as kind,
    jsonb_array_length((value::jsonb)->'calls')                as calls,
    value::jsonb->>'note'                                      as note,
    (value::jsonb)->'calls'                                    as call_detail,
    updated_at
  from public.kv
  where key like 'rr:%';

-- --------------------------------------------------------------- locking
-- Nothing but the Worker's service role key gets in.
alter table public.kv                     enable row level security;
alter table public.orders                 enable row level security;
alter table public.onboarding_submissions enable row level security;
alter table public.onboarding_documents   enable row level security;
alter table public.board_rows             enable row level security;
