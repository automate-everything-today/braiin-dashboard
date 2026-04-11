-- Migration 001: Accounts table
-- Run in Supabase SQL editor

create type relationship_type as enum ('direct_client', 'forwarder_agent', 'supplier');
create type service_category as enum (
  'shipping_line', 'airline', 'road_haulier', 'courier', 'customs_broker',
  'warehouse', 'software', 'insurance', 'port_terminal', 'other'
);
create type financial_direction as enum ('receivable', 'payable', 'both');
create type account_status as enum ('active', 'on_hold', 'blacklisted', 'dormant');
create type account_source as enum ('cargowise', 'manual', 'enrichment');

create table accounts (
  id                    bigserial primary key,
  account_code          text unique,
  company_name          text not null,
  trading_name          text not null default '',
  domain                text not null default '',
  logo_url              text not null default '',
  relationship_types    relationship_type[] not null default array['direct_client'::relationship_type],
  service_categories    service_category[] not null default '{}',
  financial_direction   financial_direction not null default 'receivable',
  status                account_status not null default 'active',
  blacklist_reason      text,
  blacklist_incident_id bigint,
  credit_terms          text not null default '',
  payment_terms         text not null default '',
  vat_number            text not null default '',
  country               text not null default '',
  city                  text not null default '',
  address               text not null default '',
  phone                 text not null default '',
  source                account_source not null default 'manual',
  notes                 text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger accounts_updated_at
  before update on accounts
  for each row execute function update_updated_at_column();

-- Indexes
create index accounts_account_code_idx on accounts (account_code);
create index accounts_company_name_idx on accounts (company_name);
create index accounts_status_idx on accounts (status);
create index accounts_domain_idx on accounts (domain);

-- RLS
alter table accounts enable row level security;

create policy "Authenticated users can read accounts"
  on accounts for select
  to authenticated
  using (true);

create policy "Authenticated users can insert accounts"
  on accounts for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update accounts"
  on accounts for update
  to authenticated
  using (true);
