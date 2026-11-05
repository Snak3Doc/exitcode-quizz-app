/**
 * The `.quiz.json` export file, and importing one back. SPEC 3.2, 5.4.
 *
 * Import uses the same checks as hosting, so a file that imports cleanly is a
 * quiz that can be hosted. Nothing is created if anything is wrong.
 */

import {
  MAX_IMPORT_BYTES,
  MAX_QUESTIONS_PER_QUIZ,
  MAX_TITLE_LENGTH,
  QUIZ_FILE_FORMAT,
  QUIZ_FILE_VERSION,
} from './constants';
import { checkQuestion } from './schema';
import { S } from '../strings';
import type {
  CodeLanguage,
  FullQuiz,
  Question,
  QuestionType,
  TimingMode,
} from './types';
import { CODE_LANGUAGES, QUESTION_TYPES } from './types';

export interface QuizFileQuestion {
  type: QuestionType;
  prompt: string;
  code: string | null;
  codeLanguage: CodeLanguage | null;
  timingMode: TimingMode;
  timeLimitSeconds: number | null;
  explanation: string | null;
  content: Record<string, unknown>;
}

export interface QuizFile {
  format: typeof QUIZ_FILE_FORMAT;
  version: number;
  title: string;
  questions: QuizFileQuestion[];
}

// ---------- export ----------

export function buildQuizFile(quiz: FullQuiz): QuizFile {
  return {
    format: QUIZ_FILE_FORMAT,
    version: QUIZ_FILE_VERSION,
    title: quiz.title,
    questions: quiz.questions.map((question) => ({
      type: question.type,
      prompt: question.prompt,
      code: question.code,
      codeLanguage: question.codeLanguage,
      timingMode: question.timingMode,
      timeLimitSeconds: question.timeLimitSeconds,
      explanation: question.explanation,
      content: question.content,
    })),
  };
}

/** A safe, recognisable download name: "python-basics-loops.quiz.json". */
export function quizFileName(title: string): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'quiz';
  return `${slug}.quiz.json`;
}

// ---------- import ----------

export interface ImportResult {
  ok: boolean;
  /** Each problem as a line the teacher can act on. */
  problems: string[];
  quiz?: { title: string; questions: Array<Omit<Question, 'id' | 'quizId'>> };
}

export function parseQuizFile(text: string, byteLength?: number): ImportResult {
  if ((byteLength ?? text.length) > MAX_IMPORT_BYTES) {
    return { ok: false, problems: [S.io.importTooBig] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: [S.io.importNotJson] };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: [S.io.importWrongFormat] };
  }

  const file = raw as Record<string, unknown>;

  if (file.format !== QUIZ_FILE_FORMAT) {
    return { ok: false, problems: [S.io.importWrongFormat] };
  }

  const version = file.version;
  if (typeof version !== 'number' || version > QUIZ_FILE_VERSION) {
    return { ok: false, problems: [S.io.importNewerVersion] };
  }

  const title =
    typeof file.title === 'string' && file.title.trim() !== ''
      ? file.title.trim().slice(0, MAX_TITLE_LENGTH)
      : S.quizzes.untitled;

  if (!Array.isArray(file.questions)) {
    return { ok: false, problems: [S.io.importWrongFormat] };
  }
  if (file.questions.length === 0) {
    return { ok: false, problems: [S.io.importNoQuestions] };
  }
  if (file.questions.length > MAX_QUESTIONS_PER_QUIZ) {
    return {
      ok: false,
      problems: [S.io.importTooManyQuestions(MAX_QUESTIONS_PER_QUIZ)],
    };
  }

  const problems: string[] = [];
  const questions: Array<Omit<Question, 'id' | 'quizId'>> = [];

  file.questions.forEach((entry, index) => {
    const number = index + 1;
    const say = (message: string) => problems.push(S.io.questionPrefix(number) + message);

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      say('it is not a question.');
      return;
    }
    const q = entry as Record<string, unknown>;

    const type = q.type;
    if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
      say(`unknown question type "${String(type)}".`);
      return;
    }

    const codeLanguage =
      typeof q.codeLanguage === 'string' &&
      (CODE_LANGUAGES as readonly string[]).includes(q.codeLanguage)
        ? (q.codeLanguage as CodeLanguage)
        : null;

    const code = typeof q.code === 'string' && q.code !== '' ? q.code : null;

    const timingMode: TimingMode = q.timingMode === 'timed' ? 'timed' : 'wait';

    const question: Omit<Question, 'id' | 'quizId'> = {
      position: index,
      type: type as QuestionType,
      prompt: typeof q.prompt === 'string' ? q.prompt : '',
      code,
      // A code block always needs a language; plain text is the safe default.
      codeLanguage: code ? (codeLanguage ?? 'plaintext') : null,
      timingMode,
      timeLimitSeconds:
        timingMode === 'timed' && typeof q.timeLimitSeconds === 'number'
          ? q.timeLimitSeconds
          : null,
      explanation: typeof q.explanation === 'string' ? q.explanation : null,
      content:
        typeof q.content === 'object' && q.content !== null && !Array.isArray(q.content)
          ? (q.content as Record<string, unknown>)
          : {},
      // An imported file is the teacher's own work, whatever wrote it
      // originally, so it does not arrive flagged as unreviewed. The flag is
      // for questions this app generated and nobody has looked at yet.
      generatedAt: null,
    };

    // Same checks as hosting, so an imported quiz is ready to host.
    for (const message of checkQuestion(question)) say(`${message}.`);

    questions.push(question);
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems: [], quiz: { title, questions } };
}
