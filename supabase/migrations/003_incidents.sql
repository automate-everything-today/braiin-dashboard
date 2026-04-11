-- Migration 003: Incidents table
-- Run in Supabase SQL editor

create type incident_severity as enum ('amber', 'red', 'black');
create type incident_category as enum (
  'delay', 'failed_collection', 'rolled', 'short_shipped', 'documentation_error',
  'customs_hold', 'damage', 'lost_cargo', 'failed_to_fly', 'temperature_breach',
  'contamination', 'claim', 'demurrage', 'theft', 'bankruptcy', 'failure_to_pay',
  'staff_misconduct', 'regulatory_breach', 'hse', 'fraud', 'other'
);
create type incident_status as enum ('open', 'investigating', 'resolved', 'escalated');
create type incident_source as enum ('manual', 'email_ai', 'deal', 'message');

create table incidents (
  id                     bigserial primary key,
  severity               incident_severity not null,
  title                  text not null,
  description            text not null default '',
  category               incident_category not null,
  account_code           text,
  supplier_account_code  text,
  job_reference          text,
  status                 incident_status not null default 'open',
  raised_by_email        text not null,
  raised_by_name         text not null default '',
  assigned_to            text,
  branch                 text not null default '',
  resolution_notes       text,
  resolved_at            timestamptz,
  resolved_by            text,
  financial_impact       numeric,
  source                 incident_source not null default 'manual',
  source_id              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger incidents_updated_at
  before update on incidents
  for each row execute function update_updated_at_column();

-- Indexes
create index incidents_severity_idx on incidents (severity);
create index incidents_status_idx on incidents (status);
create index incidents_account_code_idx on incidents (account_code);
create index incidents_raised_by_email_idx on incidents (raised_by_email);
create index incidents_created_at_idx on incidents (created_at desc);
create index incidents_category_idx on incidents (category);

-- RLS
alter table incidents enable row level security;

create policy "Authenticated users can read incidents"
  on incidents for select
  to authenticated
  using (true);

create policy "Authenticated users can insert incidents"
  on incidents for insert
  to authenticated
  with check (auth.email() = raised_by_email);

create policy "Authenticated users can update incidents"
  on incidents for update
  to authenticated
  using (true);
