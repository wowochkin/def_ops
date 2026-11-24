create table exercise_readiness_confirmations (
  organization_id text not null,
  exercise_id uuid not null,
  revision_id uuid not null,
  area text not null,
  id uuid not null,
  user_id text not null,
  role text not null,
  confirmed_at timestamptz not null,
  subject_hash character(64) not null,
  depends_on jsonb not null,
  primary key (organization_id, revision_id, area),
  unique (organization_id, revision_id, id)
);
create index exercise_confirmations_revision on exercise_readiness_confirmations(revision_id, area);

create table exercise_approved_maps (
  organization_id text not null,
  exercise_id uuid not null,
  revision_id uuid not null,
  map jsonb not null,
  primary key (organization_id, revision_id)
);
create index exercise_approved_maps_revision on exercise_approved_maps(revision_id);
