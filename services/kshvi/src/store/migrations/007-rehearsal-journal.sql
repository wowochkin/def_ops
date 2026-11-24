create table exercise_rehearsal_events (
  event_log_id text not null,
  sequence integer not null,
  event_id text not null,
  area text not null,
  event_type text not null,
  payload jsonb not null,
  sha256 character(64) not null,
  primary key (event_log_id, sequence),
  unique (event_log_id, event_id),
  check (sequence > 0)
);
create index exercise_rehearsal_events_log on exercise_rehearsal_events(event_log_id, sequence);
