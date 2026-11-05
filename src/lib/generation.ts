/**
 * Turning what the model returns into questions the app can store.
 *
 * This runs in the browser, not in the Edge Function. The function's job is to
 * hold the API key and call Gemini; it has no reason to understand quizzes.
 * Keeping the conversion here means the existing `checkQuestion()` validates
 * generated questions and imported ones with the same code, and all of it
 * stays in the test suite rather than in a Deno file nothing exercises.
 *
 * The model is asked for a shape that is not quite the stored shape — no ids,
 * and fill-in-the-blank answers as a list rather than a map. The reasons are
 * in `supabase/functions/generate-quiz/schema.ts`. This closes that gap.
 */

import { DEFAULT_TIME_LIMIT_SECONDS } from './constants';
import { checkQuestion } from './schema';
import type { CodeLanguage, QuestionType, TimingMode } from './types';
import type { QuizFileQuestion } from './quiz-file';

/** What the model returns for one question, before anything is done to it. */
export interface GeneratedQuestion {
  prompt?: unknown;
  code?: unknown;
  codeLanguage?: unknown;
  explanation?: unknown;
  content?: unknown;
}

/** The timing the teacher chose in the form, applied to every question. */
export interface TimingChoice {
  mode: TimingMode;
  seconds?: number;
}

export interface NormalisedQuestion {
  question: QuizFileQuestion;
  /** Empty when the question is ready to store. */
  problems: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A trimmed string, or null when there is nothing worth keeping. */
function optionalText(value: unknown): string | null {
  const out = text(value).trim();
  return out === '' ? null : out;
}

function id(): string {
  return crypto.randomUUID();
}

/**
 * Convert one generated `content` into the stored shape.
 *
 * Deliberately forgiving: anything missing or the wrong type is left as-is for
 * `checkQuestion()` to report. Guessing at a repair here would turn a question
 * the teacher could have been told about into one that is quietly wrong.
 */
export function normaliseContent(
  type: QuestionType,
  raw: unknown,
): Record<string, unknown> {
  const content = (raw ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = Array.isArray(content.options) ? content.options : [];
      return {
        options: options.map((option) => {
          const o = (option ?? {}) as Record<string, unknown>;
          const kind = o.kind === 'code' ? 'code' : 'text';
          return {
            id: id(),
            kind,
            // The language only belongs on a code option; carrying it on a
            // text one would show up as a stray field in the editor.
            ...(kind === 'code' && typeof o.language === 'string'
              ? { language: o.language as CodeLanguage }
              : {}),
            text: text(o.text),
            correct: o.correct === true,
          };
        }),
      };
    }

    case 'true_false':
      return { correct: content.correct === true };

    case 'short_text':
      return {
        accepted: Array.isArray(content.accepted)
          ? content.accepted.map(text).filter((a) => a.trim() !== '')
          : [],
        caseSensitive: content.caseSensitive === true,
      };

    case 'fill_blank': {
      // [{blank, word}] -> {"1": word}. A map cannot be expressed in the
      // schema dialect, so the model sends a list and we rebuild the map.
      const answers: Record<string, string> = {};
      if (Array.isArray(content.answers)) {
        for (const entry of content.answers) {
          const e = (entry ?? {}) as Record<string, unknown>;
          if (typeof e.blank === 'number' && Number.isInteger(e.blank)) {
            answers[String(e.blank)] = text(e.word);
          }
        }
      }
      return {
        language: content.language,
        snippet: text(content.snippet),
        wordBank: Array.isArray(content.wordBank) ? content.wordBank.map(text) : [],
        answers,
      };
    }

    case 'order_lines':
      return {
        language: content.language,
        // The model sends plain strings; the app stores {id, text}. Order is
        // preserved exactly — these are the lines in their correct order and
        // the app shuffles them for students at run time.
        lines: Array.isArray(content.lines)
          ? content.lines.map((line) => ({ id: id(), text: text(line) }))
          : [],
      };
  }
}

/** Convert one generated question, and say what is wrong with it. */
export function normaliseQuestion(
  type: QuestionType,
  raw: GeneratedQuestion,
  timing: TimingChoice,
): NormalisedQuestion {
  const code = optionalText(raw.code);

  const question: QuizFileQuestion = {
    type,
    prompt: text(raw.prompt).trim(),
    code,
    // The database insists these two are both set or both null, so a code
    // block with no language, or a language with no code, cannot be stored.
    codeLanguage: code === null ? null : ((optionalText(raw.codeLanguage) ?? 'plaintext') as CodeLanguage),
    timingMode: timing.mode,
    timeLimitSeconds:
      timing.mode === 'timed' ? (timing.seconds ?? DEFAULT_TIME_LIMIT_SECONDS) : null,
    explanation: optionalText(raw.explanation),
    content: normaliseContent(type, raw.content),
  };

  return { question, problems: checkQuestion(question) };
}

/**
 * One question's worth of result, in the position it was asked for.
 *
 * The position matters because a repair pass puts a replacement back where the
 * original was. The model is told to order a quiz so it builds up — easier
 * first — and appending every repaired question at the end would throw that
 * away for no reason.
 */
export type Slot =
  | { ok: true; question: QuizFileQuestion }
  | {
      ok: false;
      /** Null when the model returned nothing for this slot at all. */
      type: QuestionType | null;
      raw: GeneratedQuestion | null;
      problems: string[];
    };

/** Convert a batch, keeping each result where it belongs. */
export function normaliseSlots(
  types: readonly (QuestionType | undefined)[],
  raw: readonly GeneratedQuestion[],
  timing: TimingChoice,
): Slot[] {
  const slots: Slot[] = [];
  // Walk the longer of the two: a model can return fewer questions than were
  // asked for as easily as more, and a teacher who asked for ten and silently
  // got seven has no way to tell, having already spent the quota for ten.
  const count = Math.max(types.length, raw.length);

  for (let index = 0; index < count; index += 1) {
    const type = types[index];
    const item = raw[index];

    if (type === undefined) {
      slots.push({ ok: false, type: null, raw: null, problems: ['unexpected extra question'] });
      continue;
    }
    if (item === undefined) {
      slots.push({
        ok: false,
        type,
        raw: null,
        problems: ['the model did not return this question'],
      });
      continue;
    }

    const { question, problems } = normaliseQuestion(type, item, timing);
    if (problems.length === 0) slots.push({ ok: true, question });
    else slots.push({ ok: false, type, raw: item, problems });
  }

  return slots;
}

export interface GenerationOutcome {
  /** Questions that are ready to store, in the order they were generated. */
  kept: QuizFileQuestion[];
  /** One entry per question that had to be dropped, for telling the teacher. */
  dropped: { number: number; problems: string[] }[];
}

/** Flatten slots into what the teacher is told. */
export function summarise(slots: readonly Slot[]): GenerationOutcome {
  const kept: QuizFileQuestion[] = [];
  const dropped: GenerationOutcome['dropped'] = [];

  slots.forEach((slot, index) => {
    if (slot.ok) kept.push(slot.question);
    else dropped.push({ number: index + 1, problems: slot.problems });
  });

  return { kept, dropped };
}

/**
 * Normalise a whole batch, keeping what is usable.
 *
 * This is where generation parts company with importing a file. `parseQuizFile`
 * creates nothing if any question is bad, which is right for a file the teacher
 * wrote: silently dropping two of their questions would be worse than refusing
 * the lot. Generation has the opposite contract — throwing away eight good
 * questions because two came back malformed helps nobody, and on a free tier it
 * also spends quota the teacher cannot get back.
 *
 * So: keep what passes, and say plainly what did not.
 *
 * `types[i]` describes `raw[i]`, and nothing checks that. The model is not
 * asked which type each question is — the schema fixes one type per request —
 * so the pairing is only sound when each question was generated on its own, or
 * when the response is known to come back in the order it was asked for. If a
 * single whole-quiz response ever reorders its questions, every one of them is
 * validated against the wrong type and the whole batch is dropped. Which of
 * those two shapes we use is still open (plan §1), so this stays a documented
 * constraint on the caller rather than a guess at a fix.
 */
export function normaliseBatch(
  types: QuestionType[],
  raw: GeneratedQuestion[],
  timing: TimingChoice,
): GenerationOutcome {
  return summarise(normaliseSlots(types, raw, timing));
}

/**
 * Put repaired questions back where their originals were.
 *
 * The replacements arrive in the order the failures were sent, and each one is
 * validated against the type its slot asked for. A replacement that is still
 * wrong leaves the slot alone, carrying the problems from the second attempt
 * rather than the first — those are the ones worth telling the teacher about.
 */
export function applyRepairs(
  slots: readonly Slot[],
  repaired: readonly GeneratedQuestion[],
  timing: TimingChoice,
): Slot[] {
  const out = [...slots];
  // Only slots that know their type can be repaired; one with no type is a
  // question the model invented, and there is nothing to ask for again.
  const repairable = out
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => !entry.slot.ok && entry.slot.type !== null);

  repairable.forEach((entry, position) => {
    const replacement = repaired[position];
    if (replacement === undefined) return;

    const slot = entry.slot as Extract<Slot, { ok: false }>;
    const { question, problems } = normaliseQuestion(slot.type!, replacement, timing);
    out[entry.index] =
      problems.length === 0
        ? { ok: true, question }
        : { ok: false, type: slot.type, raw: replacement, problems };
  });

  return out;
}

/** The slots a repair pass could do something about, in order. */
export function repairable(
  slots: readonly Slot[],
): { type: QuestionType; raw: GeneratedQuestion | null; problems: string[] }[] {
  return slots
    .filter((slot): slot is Extract<Slot, { ok: false }> => !slot.ok && slot.type !== null)
    .map((slot) => ({ type: slot.type!, raw: slot.raw, problems: slot.problems }));
}
