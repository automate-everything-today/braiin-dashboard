-- Migration 002: Platform messages and read receipts
-- Run in Supabase SQL editor

create type context_type as enum ('email', 'deal', 'account', 'incident', 'general');

create table platform_messages (
  id               bigserial primary key,
  author_email     text not null,
  author_name      text not null default '',
  content          text not null,
  context_type     context_type not null,
  context_id       text,
  context_summary  text,
  context_url      text,
  parent_id        bigint references platform_messages (id) on delete set null,
  mentions         text[] not null default '{}',
  created_at       timestamptz not null default now()
);

create table message_read_receipts (
  id          bigserial primary key,
  message_id  bigint not null references platform_messages (id) on delete cascade,
  user_email  text not null,
  read_at     timestamptz not null default now(),
  unique (message_id, user_email)
);

-- Indexes
create index platform_messages_author_email_idx on platform_messages (author_email);
create index platform_messages_context_idx on platform_messages (context_type, context_id);
create index platform_messages_parent_id_idx on platform_messages (parent_id);
create index platform_messages_created_at_idx on platform_messages (created_at desc);
create index message_read_receipts_user_email_idx on message_read_receipts (user_email);

-- RLS
alter table platform_messages enable row level security;
alter table message_read_receipts enable row level security;

create policy "Authenticated users can read messages"
  on platform_messages for select
  to authenticated
  using (true);

create policy "Authenticated users can insert messages"
  on platform_messages for insert
  to authenticated
  with check (auth.email() = author_email);

create policy "Authenticated users can read receipts"
  on message_read_receipts for select
  to authenticated
  using (true);

create policy "Authenticated users can insert own receipts"
  on message_read_receipts for insert
  to authenticated
  with check (auth.email() = user_email);
