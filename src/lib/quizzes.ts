/**
 * Reading and writing quizzes and questions. Row-level security means every
 * query here already only sees the signed-in teacher's own rows. SPEC 5.
 */

import { supabase } from './supabase';
import type {
  CodeLanguage,
  FullQuiz,
  Question,
  QuestionRow,
  QuestionType,
  QuizRow,
  QuizSummary,
} from './types';
import { MAX_QUESTIONS_PER_QUIZ } from './constants';
import { S } from '../strings';

// ---------- row <-> model ----------

export function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    quizId: row.quiz_id,
    position: row.position,
    type: row.type,
    prompt: row.prompt ?? '',
    code: row.code,
    codeLanguage: row.code_language,
    timingMode: row.timing_mode,
    timeLimitSeconds: row.time_limit_seconds,
    explanation: row.explanation,
    content: (row.content ?? {}) as Record<string, unknown>,
    generatedAt: row.generated_at ?? null,
  };
}

/** The columns a question write sends. `id` and `quiz_id` are added by callers. */
export function toQuestionFields(question: Question) {
  return {
    position: question.position,
    type: question.type,
    prompt: question.prompt,
    code: question.code,
    code_language: question.code ? (question.codeLanguage ?? 'plaintext') : null,
    timing_mode: question.timingMode,
    time_limit_seconds:
      question.timingMode === 'timed' ? (question.timeLimitSeconds ?? 30) : null,
    explanation: question.explanation,
    content: question.content,
    generated_at: question.generatedAt,
  };
}

/** A brand-new question, as "+ Add question" creates it. */
export function blankQuestion(quizId: string, position: number): Omit<Question, 'id'> {
  return {
    quizId,
    position,
    type: 'mc_single',
    prompt: '',
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content: defaultContent('mc_single'),
    // A person is writing this one by hand, so it is reviewed by definition.
    generatedAt: null,
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

/** The empty answer area for a type, used on add and on type change. */
export function defaultContent(type: QuestionType): Record<string, unknown> {
  switch (type) {
    case 'mc_single':
    case 'mc_multi':
      return {
        options: [
          { id: newId(), kind: 'text', text: '', correct: false },
          { id: newId(), kind: 'text', text: '', correct: false },
        ],
      };
    case 'true_false':
      return { correct: true };
    case 'short_text':
      return { accepted: [''], caseSensitive: false };
    case 'fill_blank':
      return {
        language: 'python' as CodeLanguage,
        snippet: '',
        wordBank: [],
        answers: {},
      };
    case 'order_lines':
      return {
        language: 'python' as CodeLanguage,
        lines: [
          { id: newId(), text: '' },
          { id: newId(), text: '' },
        ],
      };
  }
}

// ---------- quizzes ----------

export async function listQuizzes(): Promise<QuizSummary[]> {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, updated_at, questions(count)')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const counts = row.questions as unknown as Array<{ count: number }> | null;
    return {
      id: row.id as string,
      title: row.title as string,
      updatedAt: row.updated_at as string,
      questionCount: counts?.[0]?.count ?? 0,
    };
  });
}

export async function createQuiz(title: string = S.quizzes.untitled): Promise<string> {
  const { data, error } = await supabase
    .from('quizzes')
    .insert({ title })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function renameQuiz(quizId: string, title: string): Promise<void> {
  const { error } = await supabase.from('quizzes').update({ title }).eq('id', quizId);
  if (error) throw error;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw error;
}

export async function loadQuiz(quizId: string): Promise<FullQuiz | null> {
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select('id, title, created_at, updated_at')
    .eq('id', quizId)
    .maybeSingle();

  if (error) throw error;
  if (!quiz) return null;

  const row = quiz as Pick<QuizRow, 'id' | 'title' | 'created_at' | 'updated_at'>;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questions: await loadQuestions(quizId),
  };
}

export async function loadQuestions(quizId: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as QuestionRow[]).map(toQuestion);
}

// ---------- questions ----------

export async function insertQuestion(
  question: Omit<Question, 'id'>,
): Promise<Question> {
  const { data, error } = await supabase
    .from('questions')
    .insert({
      quiz_id: question.quizId,
      ...toQuestionFields({ ...question, id: '' }),
    })
    .select('*')
    .single();
  if (error) throw error;
  return toQuestion(data as QuestionRow);
}

export async function updateQuestion(question: Question): Promise<void> {
  const { error } = await supabase
    .from('questions')
    .update({
      ...toQuestionFields(question),
      // A person has edited this one, so it is no longer unreviewed. Reordering
      // does not come through here -- savePositions writes `position` alone --
      // so moving a question about does not count as having read it.
      generated_at: null,
    })
    .eq('id', question.id);
  if (error) throw error;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().eq('id', questionId);
  if (error) throw error;
}

/** Rewrite positions 0..n-1 for a whole quiz after a reorder, add or delete. */
export async function savePositions(questions: Question[]): Promise<void> {
  await Promise.all(
    questions.map((question, index) =>
      supabase.from('questions').update({ position: index }).eq('id', question.id),
    ),
  );
}

/** Insert several questions at once, for Duplicate and Import. */
export async function insertQuestions(
  quizId: string,
  questions: Array<Omit<Question, 'id' | 'quizId'>>,
): Promise<void> {
  if (questions.length === 0) return;
  const rows = questions.map((question, index) => ({
    quiz_id: quizId,
    ...toQuestionFields({ ...question, id: '', quizId, position: index }),
  }));
  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;
}

// ---------- duplicate ----------

export async function duplicateQuiz(quizId: string): Promise<string> {
  const original = await loadQuiz(quizId);
  if (!original) throw new Error(S.errors.quizNotFound);

  const title = S.quizzes.copyOf(original.title).slice(0, 100);
  const newQuizId = await createQuiz(title);
  await insertQuestions(newQuizId, original.questions);
  return newQuizId;
}

export { MAX_QUESTIONS_PER_QUIZ };

// ---------- how long ago ----------

export function describeWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return then.toLocaleDateString();
}
