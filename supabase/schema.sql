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

alter table if exists session_reports add column if not exists report_version integer;
alter table if exists session_reports add column if not exists report_date text;
alter table if exists session_reports add column if not exists performed_day text;
alter table if exists session_reports add column if not exists body_weight_kg numeric;
alter table if exists session_reports add column if not exists sleep_hours numeric;
alter table if exists session_reports add column if not exists fatigue integer;
alter table if exists session_reports add column if not exists completed boolean;
alter table if exists session_reports add column if not exists training_readiness text;
alter table if exists session_reports add column if not exists estimated_kcal numeric;
alter table if exists session_reports add column if not exists estimated_protein_g numeric;
alter table if exists session_reports add column if not exists estimated_carbs_g numeric;
alter table if exists session_reports add column if not exists estimated_fats_g numeric;
alter table if exists session_reports add column if not exists nutrition_warnings text[] not null default '{}';

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

create table if not exists plan_snapshots (
  id text primary key,
  snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists chat_messages (
  id text primary key,
  message jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists session_report_exercises (
  id text primary key,
  report_id text not null references session_reports(id) on delete cascade,
  sort_order integer not null,
  exercise_name text not null,
  performed boolean not null default true,
  target_sets integer not null,
  target_reps text not null,
  actual_sets integer not null,
  actual_reps text not null,
  top_set_weight_kg numeric,
  rpe numeric not null,
  dropped_sets boolean not null default false,
  notes text
);

create table if not exists session_report_meals (
  id text primary key,
  report_id text not null references session_reports(id) on delete cascade,
  sort_order integer not null,
  slot text not null,
  content text not null default '',
  adherence text not null,
  deviation_note text,
  post_workout_source text
);

alter table if exists session_report_meals add column if not exists parsed_items jsonb not null default '[]'::jsonb;
alter table if exists session_report_meals add column if not exists estimated_kcal numeric;
alter table if exists session_report_meals add column if not exists estimated_protein_g numeric;
alter table if exists session_report_meals add column if not exists estimated_carbs_g numeric;
alter table if exists session_report_meals add column if not exists estimated_fats_g numeric;
alter table if exists session_report_meals add column if not exists analysis_warnings text[] not null default '{}';

create table if not exists nutrition_dishes (
  id text primary key,
  name text not null,
  aliases text[] not null default '{}',
  macros jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
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
create index if not exists idx_session_reports_report_date on session_reports (report_date desc);
create index if not exists idx_plan_adjustments_created_at on plan_adjustments (created_at desc);
create index if not exists idx_memory_summaries_created_at on memory_summaries (created_at desc);
create index if not exists idx_plan_snapshots_created_at on plan_snapshots (created_at desc);
create index if not exists idx_chat_messages_created_at on chat_messages (created_at desc);
create index if not exists idx_session_report_exercises_report_id on session_report_exercises (report_id, sort_order);
create index if not exists idx_session_report_meals_report_id on session_report_meals (report_id, sort_order);
create index if not exists idx_nutrition_dishes_name on nutrition_dishes (name);
create index if not exists idx_plan_snapshots_date on plan_snapshots ((snapshot->>'date'));
create index if not exists idx_knowledge_chunks_title on knowledge_chunks using gin (to_tsvector('simple', title || ' ' || content));

alter table if exists public.coach_state enable row level security;
alter table if exists public.daily_briefs enable row level security;
alter table if exists public.session_reports enable row level security;
alter table if exists public.session_report_exercises enable row level security;
alter table if exists public.session_report_meals enable row level security;
alter table if exists public.nutrition_dishes enable row level security;
alter table if exists public.plan_adjustments enable row level security;
alter table if exists public.memory_summaries enable row level security;
alter table if exists public.plan_snapshots enable row level security;
alter table if exists public.chat_messages enable row level security;
alter table if exists public.knowledge_docs enable row level security;
alter table if exists public.knowledge_chunks enable row level security;
