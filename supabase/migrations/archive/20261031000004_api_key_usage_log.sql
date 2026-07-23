-- Usage analytics for API keys
create table if not exists api_key_usage_log (
  id bigint generated always as identity primary key,
  key_id uuid not null references api_keys(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  endpoint text not null,
  method text not null default 'POST',
  status_code smallint not null,
  response_time_ms integer not null,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index idx_api_key_usage_log_key_id on api_key_usage_log(key_id);
create index idx_api_key_usage_log_org_id on api_key_usage_log(organization_id);
create index idx_api_key_usage_log_created_at on api_key_usage_log(created_at desc);

alter table api_key_usage_log enable row level security;

create policy "service_role_only" on api_key_usage_log
  for all using (false);

comment on table api_key_usage_log is 'Tracks API key usage per request for analytics and auditing';
