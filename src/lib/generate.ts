/**
 * Asking the Edge Function for a quiz, and turning what comes back into one.
 *
 * The function holds the API key and nothing else; it returns the model's
 * questions untouched. Everything that decides whether a question is usable
 * happens here, through the same `checkQuestion()` that judges an imported
 * file, so generated questions are held to exactly the same standard.
 */

import { supabase } from './supabase';
import { MAX_TITLE_LENGTH } from './constants';
import { S } from '../strings';
import {
  applyRepairs,
  normaliseQuestion,
  normaliseSlots,
  repairable,
  summarise,
  type GeneratedQuestion,
  type GenerationOutcome,
  type TimingChoice,
} from './generation';
import { createQuiz, insertQuestions } from './quizzes';
import type { Question, QuestionType } from './types';

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
    case 'out_of_quota_today':
      return S.generate.outOfQuotaToday;
    case 'topic_blocked':
      return S.generate.topicBlocked;
    case 'too_long':
      return S.generate.tooLong;
    case 'server_busy':
      return S.generate.serverBusy;
    case 'not_approved':
      return S.generate.notApproved;
    case 'server_misconfigured':
      return S.generate.misconfigured;
    case 'generation_failed':
    case 'bad_request':
    case 'method_not_allowed':
      return S.generate.failed;
    case 'unauthenticated':
      return S.generate.signedOut;
    // Supabase's own, when it kills the worker rather than letting it answer.
    case 'WORKER_RESOURCE_LIMIT':
    case 'WORKER_LIMIT':
      return S.generate.tookTooLong;
    default:
      return S.generate.unreachable;
  }
}

interface FunctionReply {
  title?: unknown;
  questions?: unknown;
  error?: { code?: string; message?: string };
  /**
   * The platform puts its code here instead, outside the `error` this function
   * documents -- a killed worker never ran the code that would have nested it.
   * Reading only `error.code` is how a worker killed mid-generation came out as
   * "check your connection", which sent teachers to retry a request that was
   * always going to be killed again.
   */
  code?: string;
}

/**
 * What a teacher should be told about a non-2xx reply.
 *
 * The status is read as well as the code because a 401 can come from the
 * gateway in front of the function, which has codes of its own
 * (UNAUTHORIZED_NO_AUTH_HEADER) and no reason to use ours. Whoever says it,
 * a 401 means the same thing: sign in again.
 */
async function messageForError(error: unknown): Promise<string> {
  try {
    // supabase-js turns any non-2xx into an error and keeps the body on the
    // response, so dig the code out rather than showing a bare "failed".
    const response = (error as { context?: Response }).context;
    if (!response || typeof response.json !== 'function') return S.generate.unreachable;
    if (response.status === 401) return S.generate.signedOut;
    const body = (await response.json()) as FunctionReply;
    return messageForCode(body.error?.code ?? body.code);
  } catch {
    // Not JSON, or already read. Nothing is known, so say only that.
    return S.generate.unreachable;
  }
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
    throw new GenerationError(await messageForError(error));
  }

  const raw = Array.isArray(data?.questions) ? (data.questions as GeneratedQuestion[]) : [];
  if (raw.length === 0) throw new GenerationError(S.generate.noneUsable);

  // The model says which type each question is, so nothing here has to assume
  // it answered in the order the types were asked for.
  const types = raw.map((question) => (question as { type?: QuestionType }).type);
  const usable = types.every((type): type is QuestionType => typeof type === 'string');
  if (!usable) throw new GenerationError(S.generate.failed);

  let slots = normaliseSlots(types, raw, options.timing);

  // One repair pass, and only one. Questions come back malformed in specific,
  // fixable ways -- a missing correct answer, a gap in the blank numbering --
  // and the validator already says exactly which, in words a model can act on.
  // Dropping those would waste part of a request already paid for.
  //
  // Capped at a single retry because an uncapped loop is how a generation
  // feature turns into a drained quota, and a model that got it wrong twice is
  // not usually about to get it right on the third go.
  const failures = repairable(slots);
  if (failures.length > 0) {
    const replacements = await askForRepairs(options.topic, failures);
    if (replacements.length > 0) {
      slots = applyRepairs(slots, replacements, options.timing);
    }
  }

  const outcome = summarise(slots);
  if (outcome.kept.length === 0) throw new GenerationError(S.generate.noneUsable);

  // Saving is reported separately. By this point the request has been spent
  // and the questions exist; telling the teacher the generator was
  // unreachable would be untrue and would send them to retry for nothing.
  try {
    return await save(options, outcome, typeof data?.title === 'string' ? data.title : null);
  } catch {
    throw new GenerationError(S.generate.saveFailed);
  }
}

async function save(
  options: GenerateOptions,
  outcome: GenerationOutcome,
  suggested: string | null,
): Promise<GenerateOutcome> {
  const quizId = await createQuiz(quizTitle(suggested, options.topic));
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
 * Ask for replacements for the questions that failed.
 *
 * A failed repair is not an error the teacher needs to see. The first pass
 * already produced usable questions; this was an attempt to rescue the rest,
 * and if it does not work they are reported as dropped exactly as they would
 * have been. So anything that goes wrong here returns nothing and the original
 * failures stand.
 */
async function askForRepairs(
  topic: string,
  failures: ReturnType<typeof repairable>,
): Promise<GeneratedQuestion[]> {
  try {
    const { data, error } = await supabase.functions.invoke<FunctionReply>('generate-quiz', {
      body: {
        topic: topic.trim(),
        repair: failures.map((failure) => ({
          type: failure.type,
          problems: failure.problems,
          question: failure.raw ?? undefined,
        })),
      },
    });
    if (error || !Array.isArray(data?.questions)) return [];
    return data.questions as GeneratedQuestion[];
  } catch {
    return [];
  }
}

/**
 * Write one question again, because the teacher did not like it.
 *
 * The same endpoint the repair pass uses: a replacement is a replacement,
 * whether the validator rejected the question or a person did. The only
 * difference is what is given as the reason, so nothing on the server changes.
 *
 * The teacher's note is worth asking for. "Write a different question" gets
 * something equally arbitrary back; "make it harder" or "use a list instead of
 * a loop" gets what they actually wanted.
 */
export async function regenerateQuestion(options: {
  /** What the quiz is about. The title is the best description we have. */
  topic: string;
  question: Question;
  note?: string;
}): Promise<Question> {
  const { question, note } = options;

  const reason =
    note && note.trim() !== ''
      ? note.trim()
      : 'the teacher asked for a different question on the same topic';

  const { data, error } = await supabase.functions.invoke<FunctionReply>('generate-quiz', {
    body: {
      topic: options.topic.trim() || S.quizzes.untitled,
      repair: [
        {
          type: question.type,
          problems: [reason],
          // What they have now, so the model writes something different rather
          // than handing back the same question in other words.
          question: {
            prompt: question.prompt,
            code: question.code ?? undefined,
            codeLanguage: question.codeLanguage ?? undefined,
            explanation: question.explanation ?? undefined,
            content: question.content,
          },
        },
      ],
    },
  });

  if (error) {
    throw new GenerationError(await messageForError(error));
  }

  const raw = Array.isArray(data?.questions) ? (data.questions as GeneratedQuestion[]) : [];
  if (raw.length === 0) throw new GenerationError(S.generate.failed);

  const { question: replacement, problems } = normaliseQuestion(
    question.type,
    raw[0],
    question.timingMode === 'timed'
      ? { mode: 'timed', seconds: question.timeLimitSeconds ?? undefined }
      : { mode: 'wait' },
  );

  // Unlike the repair pass, there is nothing to fall back on here: the teacher
  // asked for this one and is waiting. Say it did not work rather than quietly
  // leaving the old question in place.
  if (problems.length > 0) throw new GenerationError(S.generate.failed);

  return {
    ...question,
    type: replacement.type,
    prompt: replacement.prompt,
    code: replacement.code,
    codeLanguage: replacement.codeLanguage,
    explanation: replacement.explanation,
    content: replacement.content,
    // A fresh question nobody has read, so the badge comes back.
    generatedAt: new Date().toISOString(),
  };
}

/**
 * A title from the teacher's topic, so the quiz list is readable without
 * anyone having to rename everything by hand.
 */
/**
 * What to call a generated quiz.
 *
 * The teacher's topic is a brief, not a name. "Python for loops using lists
 * and enumerate() for intermediate students" says exactly what they wanted
 * and is a poor thing to read in a list, so the model is asked for a short
 * name and that is used when it gives one.
 *
 * The topic stays as the fallback, cut as before. A quiz with no name is
 * worse than a quiz with a long one.
 */
export function quizTitle(suggested: string | null, topic: string): string {
  const clean = (suggested ?? '').trim().replace(/\s+/g, ' ');
  // A "short name" long enough to be cut is not a name the model understood
  // the request for, so fall back rather than truncate it into nonsense.
  if (clean !== '' && clean.length <= MAX_GENERATED_TITLE) {
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return titleFor(topic);
}

/** Comfortably past "a few words", so only a runaway name is rejected. */
const MAX_GENERATED_TITLE = 60;

export function titleFor(topic: string): string {
  const clean = topic.trim().replace(/\s+/g, ' ');
  if (clean === '') return S.quizzes.untitled;
  // Cut only at what the column will hold, not at what the list looks good
  // at. This used to stop at 60 and save the ellipsis, so the rest of the
  // teacher's words were gone for good and no amount of hovering brought
  // them back. The list truncates for display and has the full text in a
  // tooltip, which is where that decision belongs.
  const cut =
    clean.length > MAX_TITLE_LENGTH
      ? `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
      : clean;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
