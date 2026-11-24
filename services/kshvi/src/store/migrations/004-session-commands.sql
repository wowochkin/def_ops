create table exercise_session_commands (
  organization_id text not null,
  exercise_id uuid not null,
  session_id uuid not null,
  idempotency_key text not null,
  command text not null check (command in ('PAUSE', 'RESUME', 'PRIVATE_STOP', 'GENERAL_STOP', 'JUMP', 'COMPLETE', 'ABORT')),
  expected_revision bigint not null check (expected_revision >= 0),
  confirmed_revision bigint not null check (confirmed_revision > 0),
  result jsonb not null,
  created_at timestamptz not null,
  primary key (organization_id, session_id, idempotency_key),
  foreign key (organization_id, exercise_id, session_id)
    references exercise_sessions(organization_id, exercise_id, id)
);
create index exercise_session_commands_replay on exercise_session_commands(organization_id, session_id, confirmed_revision);
