create table exercises (
  organization_id text not null,
  id uuid not null,
  title text not null,
  purpose text not null check (purpose in ('planned', 'special', 'inspection', 'research', 'exposition', 'custom')),
  scale text not null check (scale in ('tactical', 'operational', 'strategic', 'custom')),
  state text not null check (state in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'CANCELLED', 'ARCHIVED')),
  revision integer not null check (revision > 0),
  owner_id text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  readiness integer not null default 0 check (readiness between 0 and 100),
  validation text not null check (validation in ('NOT_RUN', 'OK', 'WARNING', 'ERROR')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  primary key (organization_id, id),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check ((state = 'ARCHIVED') = (archived_at is not null))
);
create index exercises_library on exercises(organization_id, updated_at desc, id);
create index exercises_owner on exercises(organization_id, owner_id);

create table exercise_revisions (
  organization_id text not null,
  id uuid not null,
  exercise_id uuid not null,
  revision integer not null check (revision > 0),
  payload jsonb not null,
  sha256 character(64) not null,
  state text not null check (state in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'CANCELLED')),
  created_by text not null,
  created_at timestamptz not null,
  supersedes_id uuid,
  primary key (organization_id, id),
  unique (organization_id, exercise_id, revision),
  unique (organization_id, exercise_id, id),
  foreign key (organization_id, exercise_id) references exercises(organization_id, id)
);
create index exercise_revisions_history on exercise_revisions(organization_id, exercise_id, revision);

create table exercise_sessions (
  organization_id text not null,
  id uuid not null,
  exercise_id uuid not null,
  scenario_revision_id uuid not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED', 'ARCHIVED')),
  mode text not null check (mode = 'NETWORK'),
  authority text not null check (authority = 'SERVER'),
  confirmed_revision bigint not null default 0 check (confirmed_revision >= 0),
  created_by text not null,
  created_at timestamptz not null,
  primary key (organization_id, id),
  unique (organization_id, exercise_id, id),
  foreign key (organization_id, exercise_id) references exercises(organization_id, id),
  foreign key (organization_id, exercise_id, scenario_revision_id)
    references exercise_revisions(organization_id, exercise_id, id)
);
create index exercise_sessions_latest on exercise_sessions(organization_id, exercise_id, created_at, id);
