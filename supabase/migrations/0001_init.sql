-- Agent Trust Layer: initial schema. Amounts are smallest token units (numeric(78,0) fits uint256).
-- NOTE: not yet applied to a live Supabase project.

create table jobs (
  id            text primary key,
  buyer         text not null,
  provider      text not null,
  spec          jsonb not null,
  spec_hash     text not null,
  max_price     numeric(78,0) not null,
  status        text not null check (status in ('created','submitted','verified','released','slashed','rejected')),
  settlement    jsonb,                       -- { action, txHash, at }
  created_at    timestamptz not null default now()
);
create index jobs_provider_idx on jobs (lower(provider));

create table submissions (
  job_id        text primary key references jobs(id),
  provider      text not null,
  payload       jsonb not null,
  payload_hash  text not null,
  submitted_at  timestamptz not null default now()
);

create table verification_reports (
  job_id        text primary key references jobs(id),
  report_hash   text not null unique,
  body          jsonb not null,
  signature     text not null,
  verifier      text not null,
  verdict       text not null check (verdict in ('pass','fail')),
  created_at    timestamptz not null default now()
);

-- One event per settled job; the unique constraint makes double-counting impossible.
create table reputation_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  job_id        text not null unique references jobs(id),
  outcome       text not null check (outcome in ('pass','fail')),
  amount        numeric(78,0) not null,
  report_hash   text not null references verification_reports(report_hash),
  occurred_at   timestamptz not null default now()
);
create index reputation_events_provider_idx on reputation_events (lower(provider), occurred_at desc);

create table audit_log (
  id            bigint generated always as identity primary key,
  job_id        text not null references jobs(id),
  kind          text not null,
  data          jsonb not null,
  at            timestamptz not null default now()
);
create index audit_log_job_idx on audit_log (job_id, id);

-- Backend uses the service role (bypasses RLS). The dashboard reads with the anon key: read-only, testnet data only.
alter table jobs                 enable row level security;
alter table submissions          enable row level security;
alter table verification_reports enable row level security;
alter table reputation_events    enable row level security;
alter table audit_log            enable row level security;

create policy anon_read_jobs     on jobs                 for select to anon using (true);
create policy anon_read_reports  on verification_reports for select to anon using (true);
create policy anon_read_events   on reputation_events   for select to anon using (true);
create policy anon_read_audit    on audit_log            for select to anon using (true);
-- submissions intentionally have no anon policy: payloads may hold buyer data.
