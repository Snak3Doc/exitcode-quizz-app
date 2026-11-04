-- ===== Allowed teachers (managed by hand in the Supabase dashboard) =====
create table public.allowed_teachers (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.allowed_teachers enable row level security;
-- No policies on purpose: nobody can read or write this table through the API.
revoke all on public.allowed_teachers from anon, authenticated;

create or replace function public.is_allowed_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_teachers
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed_teacher() from public, anon;
grant execute on function public.is_allowed_teacher() to authenticated;

-- ===== updated_at helper =====
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== Quizzes =====
create table public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'Untitled quiz' check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quizzes_owner_idx on public.quizzes (owner_id, updated_at desc);
create trigger quizzes_updated_at before update on public.quizzes
  for each row execute function public.set_updated_at();

alter table public.quizzes enable row level security;
revoke all on public.quizzes from anon;

create policy quizzes_select_own on public.quizzes for select to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_insert_own on public.quizzes for insert to authenticated
  with check (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_update_own on public.quizzes for update to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher())
  with check (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_delete_own on public.quizzes for delete to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher());

-- The project is created with "Automatically expose new tables" OFF, so access is granted explicitly.
-- Row-level security above still decides which rows each teacher can see.
grant select, insert, update, delete on public.quizzes to authenticated;

-- ===== Questions =====
create table public.questions (
  id                 uuid primary key default gen_random_uuid(),
  quiz_id            uuid not null references public.quizzes(id) on delete cascade,
  position           integer not null check (position >= 0),
  type               text not null check (type in
                       ('mc_single','mc_multi','true_false','short_text','fill_blank','order_lines')),
  prompt             text not null default '' check (char_length(prompt) <= 2000),
  code               text check (code is null or char_length(code) <= 4000),
  code_language      text check (code_language in ('python','javascript','html','css','plaintext')),
  timing_mode        text not null default 'wait' check (timing_mode in ('wait','timed')),
  time_limit_seconds integer check (time_limit_seconds between 5 and 300),
  explanation        text check (explanation is null or char_length(explanation) <= 2000),
  content            jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((code is null) = (code_language is null)),
  check ((timing_mode = 'timed') = (time_limit_seconds is not null))
);
create index questions_quiz_idx on public.questions (quiz_id, position);
create trigger questions_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

alter table public.questions enable row level security;
revoke all on public.questions from anon;

create policy questions_select_own on public.questions for select to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_insert_own on public.questions for insert to authenticated
  with check (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_update_own on public.questions for update to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()))
  with check (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_delete_own on public.questions for delete to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));

grant select, insert, update, delete on public.questions to authenticated;
