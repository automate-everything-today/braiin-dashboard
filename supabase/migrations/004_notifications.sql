-- Migration 004: Notifications table
-- Run in Supabase SQL editor

create type notification_type as enum ('mention', 'incident', 'reply', 'escalation', 'system');

create table notifications (
  id           bigserial primary key,
  user_email   text not null,
  type         notification_type not null,
  title        text not null,
  body         text not null default '',
  severity     incident_severity,
  source_type  text,
  source_id    text,
  link         text,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Indexes
create index notifications_user_email_idx on notifications (user_email);
create index notifications_is_read_idx on notifications (user_email, is_read) where is_read = false;
create index notifications_created_at_idx on notifications (created_at desc);
create index notifications_type_idx on notifications (type);

-- RLS
alter table notifications enable row level security;

create policy "Users can read own notifications"
  on notifications for select
  to authenticated
  using (auth.email() = user_email);

create policy "System can insert notifications"
  on notifications for insert
  to authenticated
  with check (true);

create policy "Users can update own notifications"
  on notifications for update
  to authenticated
  using (auth.email() = user_email);
