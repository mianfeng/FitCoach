create table if not exists coach_state (
  id text primary key,
  profile jsonb not null,
  persona jsonb not null,
  active_plan jsonb not null,
  workout_templates jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists daily_briefs (
  id text primary key,
  brief jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists session_reports (
  id text primary key,
  report jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists plan_adjustments (
  id text primary key,
  proposal jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists memory_summaries (
  id text primary key,
  summary jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists chat_messages (
  id text primary key,
  message jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists knowledge_docs (
  id text primary key,
  title text not null,
  source_path text not null,
  markdown text not null,
  imported_at timestamptz not null default timezone('utc', now())
);

create table if not exists knowledge_chunks (
  id text primary key,
  doc_id text not null references knowledge_docs(id) on delete cascade,
  title text not null,
  content text not null,
  anchor text not null,
  tags text[] not null default '{}'
);

create index if not exists idx_daily_briefs_created_at on daily_briefs (created_at desc);
create index if not exists idx_session_reports_created_at on session_reports (created_at desc);
create index if not exists idx_plan_adjustments_created_at on plan_adjustments (created_at desc);
create index if not exists idx_memory_summaries_created_at on memory_summaries (created_at desc);
create index if not exists idx_chat_messages_created_at on chat_messages (created_at desc);
create index if not exists idx_knowledge_chunks_title on knowledge_chunks using gin (to_tsvector('simple', title || ' ' || content));
