alter table events add column schema_version integer not null default 1;
alter table events add column wall_clock_at text not null default '1970-01-01T00:00:00.000Z';
alter table events add column operational_at jsonb not null default '{"normalizedAt":"1970-01-01T00:00:00.000Z","originalAt":"1970-01-01T00:00:00Z","zone":"UTC","offset":"+00:00"}';
alter table events add column actor jsonb not null default '{"id":"legacy","kind":"SYSTEM"}';
alter table events add column cause_ids jsonb not null default '[]';
alter table events add column versions jsonb not null default '{}';
alter table events add column reducer_version integer not null default 1;
alter table events add column hash_version integer not null default 1;
alter table events alter column hash_version drop default;
alter table events add constraint events_hash_version check (hash_version in (1,2));
alter table events add constraint events_schema_version check (schema_version >= 1);
alter table events add constraint events_reducer_version check (reducer_version >= 1);
alter table jobs add column error text;

create table outbox_deliveries (
  id uuid not null primary key,
  event_id uuid not null references events(event_id),
  consumer text not null,
  attempt integer not null check (attempt >= 1),
  idempotency_key text not null,
  status text not null check (status in ('delivering','published','failed')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (event_id, consumer, attempt)
);
create index outbox_deliveries_event on outbox_deliveries(event_id, consumer, attempt);

update outbox set payload = (
  select jsonb_build_object(
    'eventId', e.event_id,
    'organizationId', e.organization_id,
    'instanceId', e.instance_id,
    'branchId', e.branch_id,
    'sequence', e.sequence,
    'type', e.type,
    'schemaVersion', e.schema_version,
    'wallClockAt', e.wall_clock_at,
    'operationalAt', e.operational_at,
    'actor', e.actor,
    'causeIds', e.cause_ids,
    'versions', e.versions,
    'reducerVersion', e.reducer_version,
    'payload', e.payload,
    'prevHash', e.prev_hash,
    'hash', e.hash,
    'hashVersion', e.hash_version
  ) from events e where e.event_id = outbox.event_id
);

create or replace function reject_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Записи журнала неизменяемы';
end;
$$;
drop trigger if exists kshvi_event_mutate on events;
create trigger kshvi_event_mutate before update or delete on events
for each row execute function reject_event_mutation();
create trigger kshvi_event_truncate before truncate on events
for each statement execute function reject_event_mutation();
create trigger kshvi_snapshot_mutate before update or delete on snapshots
for each row execute function reject_event_mutation();
create trigger kshvi_snapshot_truncate before truncate on snapshots
for each statement execute function reject_event_mutation();
create trigger kshvi_command_mutate before update or delete on commands
for each row execute function reject_event_mutation();
create trigger kshvi_command_truncate before truncate on commands
for each statement execute function reject_event_mutation();
