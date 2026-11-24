create table accounts (
  user_id text not null primary key,
  username text not null unique,
  password_hash text not null,
  organization_id text not null,
  roles jsonb not null,
  state text not null check (state in ('ACTIVE', 'BLOCKED', 'ARCHIVED')),
  created_at timestamptz not null default now()
);
create table sessions (
  id text not null primary key,
  user_id text not null references accounts(user_id),
  token_hash text not null unique,
  csrf_hash text not null,
  active_role_id text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions(user_id);
