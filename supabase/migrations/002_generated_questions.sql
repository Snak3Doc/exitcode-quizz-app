-- ===== Marking questions that came from the generator =====
--
-- A generated question has not been read by a person yet. Nothing in the app
-- can check that a generated code snippet really prints what its answer says,
-- so the teacher has to look -- and a week later they need to know which ones
-- they already looked at.
--
-- Set when the generator writes the question, cleared the first time a person
-- edits it. Null therefore means "a person has had a hand in this", which is
-- also true of every question that existed before this migration.
--
-- This tracks whether someone looked, not whether the question is right.

alter table public.questions
  add column generated_at timestamptz;

comment on column public.questions.generated_at is
  'When the generator produced this question. Cleared on the first manual edit. Null means a person has edited or written it.';

-- Only the unreviewed ones are ever looked up, and they are a minority of a
-- teacher's questions, so index just those.
create index questions_generated_idx
  on public.questions (quiz_id)
  where generated_at is not null;

-- No policy changes: questions are already covered by the quiz-owner policies
-- in 001_init.sql, and this column rides along with them.
