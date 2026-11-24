create table commands (
  organization_id text not null,
  instance_id text not null,
  idempotency_key text not null,
  request_hash text not null,
  event_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, instance_id, idempotency_key)
);
create table events (
  organization_id text not null,
  instance_id text not null,
  branch_id text not null,
  sequence bigint not null,
  event_id uuid not null unique,
  type text not null,
  payload jsonb not null,
  prev_hash text,
  hash text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, instance_id, branch_id, sequence)
);
create table aggregates (
  organization_id text not null,
  instance_id text not null,
  branch_id text not null,
  revision bigint not null,
  primary key (organization_id, instance_id, branch_id)
);
create table outbox (
  id uuid not null primary key,
  organization_id text not null,
  instance_id text not null,
  event_id uuid not null unique references events(event_id),
  payload jsonb not null,
  status text not null check (status in ('pending', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create table snapshots (
  organization_id text not null,
  instance_id text not null,
  branch_id text not null,
  sequence bigint not null,
  state jsonb not null,
  state_hash text not null,
  environment jsonb not null,
  reducer_version integer not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, instance_id, branch_id, sequence)
);
create table jobs (
  id uuid not null primary key,
  organization_id text not null,
  kind text not null,
  key text not null,
  payload jsonb not null,
  request_hash text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind, key)
);
create function reject_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'События журнала неизменяемы';
end;
$$;
create trigger kshvi_event_mutate
before update or delete on events
for each row execute function reject_event_mutation();
