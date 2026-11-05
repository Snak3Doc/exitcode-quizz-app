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
    return await save(options, outcome);
  } catch {
    throw new GenerationError(S.generate.saveFailed);
  }
}

async function save(
  options: GenerateOptions,
  outcome: GenerationOutcome,
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
    let code: string | undefined;
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        code = ((await response.json()) as FunctionReply).error?.code;
      }
    } catch {
      // Keep the generic message.
    }
    throw new GenerationError(messageForCode(code));
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
export function titleFor(topic: string): string {
  const clean = topic.trim().replace(/\s+/g, ' ');
  if (clean === '') return S.quizzes.untitled;
  // Long enough to tell two quizzes apart, short enough for the list.
  const cut = clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
