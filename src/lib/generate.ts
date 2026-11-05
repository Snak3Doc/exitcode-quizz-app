/**
 * Asking the Edge Function for a quiz, and turning what comes back into one.
 *
 * The function holds the API key and nothing else; it returns the model's
 * questions untouched. Everything that decides whether a question is usable
 * happens here, through the same `checkQuestion()` that judges an imported
 * file, so generated questions are held to exactly the same standard.
 */

import { supabase } from './supabase';
import { S } from '../strings';
import { normaliseBatch, type GeneratedQuestion, type TimingChoice } from './generation';
import { createQuiz, insertQuestions } from './quizzes';
import type { QuestionType } from './types';

export interface GenerateOptions {
  topic: string;
  count: number;
  types: QuestionType[];
  timing: TimingChoice;
}

export interface GenerateOutcome {
  quizId: string;
  kept: number;
  /** Questions the model returned that could not be used. */
  dropped: { number: number; problems: string[] }[];
}

/** A failure worth showing a teacher, already in words they can act on. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

/** Map the function's error code to something a teacher can read. */
function messageForCode(code: string | undefined): string {
  switch (code) {
    case 'quota_exhausted':
      return S.generate.unavailable;
    case 'not_approved':
      return S.generate.notApproved;
    case 'server_misconfigured':
      return S.generate.misconfigured;
    case 'generation_failed':
    case 'bad_request':
      return S.generate.failed;
    default:
      return S.generate.unreachable;
  }
}

interface FunctionReply {
  questions?: unknown;
  error?: { code?: string; message?: string };
}

/**
 * Generate a quiz and save it, returning what was kept and what was not.
 *
 * Unlike importing a file, this keeps the questions that are usable rather
 * than refusing the lot. Throwing away eight good questions because two came
 * back malformed helps nobody, and on a free tier the requests spent on them
 * are not coming back.
 */
export async function generateQuiz(options: GenerateOptions): Promise<GenerateOutcome> {
  const { data, error } = await supabase.functions.invoke<FunctionReply>('generate-quiz', {
    body: {
      topic: options.topic.trim(),
      count: options.count,
      types: options.types,
    },
  });

  if (error) {
    // supabase-js turns any non-2xx into an error and keeps the body on the
    // response, so dig the code out rather than showing a bare "failed".
    let code: string | undefined;
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        const body = (await response.json()) as FunctionReply;
        code = body.error?.code;
      }
    } catch {
      // Keep the generic message below.
    }
    throw new GenerationError(messageForCode(code));
  }

  const raw = Array.isArray(data?.questions) ? (data.questions as GeneratedQuestion[]) : [];
  if (raw.length === 0) throw new GenerationError(S.generate.noneUsable);

  // The model says which type each question is, so nothing here has to assume
  // it answered in the order the types were asked for.
  const types = raw.map((question) => (question as { type?: QuestionType }).type);
  const usable = types.every((type): type is QuestionType => typeof type === 'string');
  if (!usable) throw new GenerationError(S.generate.failed);

  const outcome = normaliseBatch(types, raw, options.timing);
  if (outcome.kept.length === 0) throw new GenerationError(S.generate.noneUsable);

  // Saving is reported separately. By this point the request has been spent
  // and the questions exist; telling the teacher the generator was
  // unreachable would be untrue and would send them to retry for nothing.
  try {
    return await save(options, outcome);
  } catch {
    throw new GenerationError(S.generate.saveFailed);
  }
}

async function save(
  options: GenerateOptions,
  outcome: ReturnType<typeof normaliseBatch>,
): Promise<GenerateOutcome> {
  const quizId = await createQuiz(titleFor(options.topic));
  await insertQuestions(
    quizId,
    outcome.kept.map((question, index) => ({
      quizId,
      position: index,
      type: question.type,
      prompt: question.prompt,
      code: question.code,
      codeLanguage: question.codeLanguage,
      timingMode: question.timingMode,
      timeLimitSeconds: question.timeLimitSeconds,
      explanation: question.explanation,
      content: question.content,
      // Nobody has read these yet, and nothing here can check that a generated
      // snippet prints what its answer claims.
      generatedAt: new Date().toISOString(),
    })),
  );

  return { quizId, kept: outcome.kept.length, dropped: outcome.dropped };
}

/**
 * A title from the teacher's topic, so the quiz list is readable without
 * anyone having to rename everything by hand.
 */
export function titleFor(topic: string): string {
  const clean = topic.trim().replace(/\s+/g, ' ');
  if (clean === '') return S.quizzes.untitled;
  // Long enough to tell two quizzes apart, short enough for the list.
  const cut = clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
