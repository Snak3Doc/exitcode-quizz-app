/**
 * Pure game logic: share codes, names, marking, scoring, leaderboards.
 * No React, no network, no browser APIs beyond `crypto.getRandomValues`.
 * SPEC 3.8, 3.9, 3.11.
 */

import {
  BASE_POINTS,
  MAX_NAME_LENGTH,
  MAX_SPEED_BONUS,
  OPTION_LETTERS,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
} from './constants';
import type {
  AnswerValue,
  ChoiceContent,
  ChoiceOption,
  CorrectAnswer,
  FillBlankContent,
  LeaderboardEntry,
  OrderLinesContent,
  Outcome,
  Player,
  PublicQuestion,
  Question,
  QuestionType,
  ShortTextContent,
  TrueFalseContent,
} from './types';

// ---------- share codes (3.8) ----------

export function generateShareCode(
  randomBytes: (n: number) => Uint8Array = cryptoRandomBytes,
): string {
  const alphabet = SHARE_CODE_ALPHABET;
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  while (out.length < SHARE_CODE_LENGTH) {
    const bytes = randomBytes(SHARE_CODE_LENGTH);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length]);
      if (out.length === SHARE_CODE_LENGTH) break;
    }
  }
  return out.join('');
}

function cryptoRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Codes are typed by students: case-insensitive, spaces ignored. */
export function normaliseShareCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export function isWellFormedShareCode(input: string): boolean {
  const code = normaliseShareCode(input);
  if (code.length !== SHARE_CODE_LENGTH) return false;
  return [...code].every((char) => SHARE_CODE_ALPHABET.includes(char));
}

// ---------- student names (3.9) ----------

const NAME_PATTERN = /^[\p{L}\p{M}\p{N} .,'_!-]{1,20}$/u;

export function normaliseName(input: string): string {
  return input.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function isValidName(input: string): boolean {
  const name = normaliseName(input);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  return NAME_PATTERN.test(name);
}

/** Names are unique within a game, compared without case. */
export function isNameTaken(name: string, players: Player[]): boolean {
  const key = normaliseName(name).toLocaleLowerCase();
  return players.some((p) => normaliseName(p.name).toLocaleLowerCase() === key);
}

// ---------- short text matching (3.11) ----------

export function normaliseShortText(input: string, caseSensitive: boolean): string {
  const text = input.trim().replace(/\s+/g, ' ');
  return caseSensitive ? text : text.toLocaleLowerCase();
}

export function matchesShortText(
  answer: string,
  accepted: string[],
  caseSensitive: boolean,
): boolean {
  const given = normaliseShortText(answer, caseSensitive);
  if (given === '') return false;
  return accepted
    .filter((a) => a.trim() !== '')
    .some((a) => normaliseShortText(a, caseSensitive) === given);
}

// ---------- shuffling (6: never the correct order when lines differ) ----------

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Shuffle lines for a student. If every line is distinct, the result is never
 * the correct order. If some lines are identical, a shuffle may be unavoidably
 * equal to the original, so we stop trying after a few attempts.
 */
export function shuffleLines<T extends { text: string }>(
  lines: T[],
  random: () => number = Math.random,
): T[] {
  if (lines.length < 2) return [...lines];
  const original = lines.map((l) => l.text).join('\u0000');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = shuffle(lines, random);
    if (candidate.map((l) => l.text).join('\u0000') !== original) return candidate;
  }
  return shuffle(lines, random);
}

// ---------- marking (3.11) ----------

export interface Marked {
  /** 0 to 1. */
  fraction: number;
  status: Outcome;
}

export const NO_ANSWER: Marked = { fraction: 0, status: 'none' };

/**
 * Mark one student's answer against a question. `answer === undefined` means
 * they did not answer.
 */
export function markAnswer(question: Question, answer: AnswerValue | undefined): Marked {
  if (answer === undefined) return NO_ANSWER;

  const fraction = fractionFor(question, answer);
  return { fraction, status: statusFor(fraction) };
}

function statusFor(fraction: number): Outcome {
  if (fraction >= 1) return 'correct';
  if (fraction > 0) return 'partial';
  return 'wrong';
}

function fractionFor(question: Question, answer: AnswerValue): number {
  switch (question.type) {
    case 'mc_single': {
      const content = question.content as unknown as ChoiceContent;
      if (typeof answer !== 'string') return 0;
      const option = content.options?.find((o) => o.id === answer);
      return option?.correct ? 1 : 0;
    }

    case 'mc_multi': {
      const content = question.content as unknown as ChoiceContent;
      const options = content.options ?? [];
      if (!Array.isArray(answer)) return 0;
      const ticked = new Set(answer.filter((id) => typeof id === 'string'));
      const totalCorrect = options.filter((o) => o.correct).length;
      if (totalCorrect === 0) return 0;
      let correctTicked = 0;
      let wrongTicked = 0;
      for (const option of options) {
        if (!ticked.has(option.id)) continue;
        if (option.correct) correctTicked += 1;
        else wrongTicked += 1;
      }
      return clamp01((correctTicked - wrongTicked) / totalCorrect);
    }

    case 'true_false': {
      const content = question.content as unknown as TrueFalseContent;
      if (typeof answer !== 'boolean') return 0;
      return answer === content.correct ? 1 : 0;
    }

    case 'short_text': {
      const content = question.content as unknown as ShortTextContent;
      if (typeof answer !== 'string') return 0;
      return matchesShortText(answer, content.accepted ?? [], content.caseSensitive === true)
        ? 1
        : 0;
    }

    case 'fill_blank': {
      const content = question.content as unknown as FillBlankContent;
      const answers = content.answers ?? {};
      const blanks = Object.keys(answers);
      if (blanks.length === 0) return 0;
      if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return 0;
      const given = answer as Record<string, string>;
      let right = 0;
      for (const key of blanks) {
        if (given[key] === answers[key]) right += 1;
      }
      return clamp01(right / blanks.length);
    }

    case 'order_lines': {
      const content = question.content as unknown as OrderLinesContent;
      const lines = content.lines ?? [];
      if (lines.length === 0) return 0;
      if (!Array.isArray(answer)) return 0;
      const byId = new Map(lines.map((l) => [l.id, l.text]));
      let right = 0;
      // Identical lines are interchangeable, so compare the text at each position.
      for (let i = 0; i < lines.length; i += 1) {
        const givenId = answer[i];
        if (typeof givenId !== 'string') continue;
        if (byId.get(givenId) === lines[i].text) right += 1;
      }
      return clamp01(right / lines.length);
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ---------- scoring (3.11) ----------

export function basePoints(fraction: number): number {
  return Math.round(BASE_POINTS * clamp01(fraction));
}

/**
 * Speed bonus: timed questions only, fully correct answers only. Shrinks evenly
 * from the full bonus at the start to zero at the deadline.
 */
export function speedBonus(args: {
  fraction: number;
  timingMode: string;
  timeLimitSeconds: number | null;
  elapsedMs: number;
}): number {
  if (args.timingMode !== 'timed') return 0;
  if (args.fraction < 1) return 0;
  const limitMs = (args.timeLimitSeconds ?? 0) * 1000;
  if (limitMs <= 0) return 0;
  const raw = Math.round(MAX_SPEED_BONUS * (1 - args.elapsedMs / limitMs));
  return Math.min(MAX_SPEED_BONUS, Math.max(0, raw));
}

export interface QuestionScore {
  status: Outcome;
  base: number;
  bonus: number;
  points: number;
}

export function scoreAnswer(
  question: Question,
  answer: AnswerValue | undefined,
  elapsedMs: number,
): QuestionScore {
  const marked = markAnswer(question, answer);
  const base = basePoints(marked.fraction);
  const bonus =
    answer === undefined
      ? 0
      : speedBonus({
          fraction: marked.fraction,
          timingMode: question.timingMode,
          timeLimitSeconds: question.timeLimitSeconds,
          elapsedMs,
        });
  return { status: marked.status, base, bonus, points: base + bonus };
}

// ---------- leaderboard (3.11) ----------

/**
 * Highest total first, then name A to Z. Equal totals share a rank
 * (1, 2, 2, 4).
 */
export function buildLeaderboard(
  players: Array<{ id: string; name: string; total: number }>,
): LeaderboardEntry[] {
  const sorted = [...players].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const entries: LeaderboardEntry[] = [];
  let lastTotal: number | null = null;
  let lastRank = 0;
  sorted.forEach((player, index) => {
    const rank = lastTotal !== null && player.total === lastTotal ? lastRank : index + 1;
    lastTotal = player.total;
    lastRank = rank;
    entries.push({ playerId: player.id, name: player.name, total: player.total, rank });
  });
  return entries;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

// ---------- what students are allowed to see (12) ----------

/**
 * Strip every correct answer from a question's content. Order-the-lines comes
 * back shuffled; fill-in-the-blank keeps only the snippet and the word bank.
 */
export function publicContent(
  type: QuestionType,
  content: Record<string, unknown>,
  random: () => number = Math.random,
): Record<string, unknown> {
  switch (type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = ((content as unknown as ChoiceContent).options ?? []).map(
        ({ id, kind, language, text }) => ({
          id,
          kind,
          ...(language ? { language } : {}),
          text,
        }),
      );
      return { options };
    }
    case 'true_false':
      return {};
    case 'short_text':
      return {};
    case 'fill_blank': {
      const c = content as unknown as FillBlankContent;
      return {
        language: c.language,
        snippet: c.snippet,
        wordBank: c.wordBank ?? [],
      };
    }
    case 'order_lines': {
      const c = content as unknown as OrderLinesContent;
      return {
        language: c.language,
        lines: shuffleLines(c.lines ?? [], random),
      };
    }
  }
}

export function toPublicQuestion(
  question: Question,
  index: number,
  total: number,
  remainingMs: number | undefined,
  random: () => number = Math.random,
): PublicQuestion {
  return {
    index,
    total,
    type: question.type,
    prompt: question.prompt,
    ...(question.code ? { code: question.code } : {}),
    ...(question.codeLanguage ? { codeLanguage: question.codeLanguage } : {}),
    content: publicContent(question.type, question.content, random),
    timing: {
      mode: question.timingMode,
      ...(question.timingMode === 'timed' ? { remainingMs: remainingMs ?? 0 } : {}),
    },
  };
}

/** The correct answer, in the shape both results screens render. */
export function correctAnswerFor(question: Question): CorrectAnswer {
  switch (question.type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = (question.content as unknown as ChoiceContent).options ?? [];
      return {
        type: question.type,
        optionIds: options.filter((o) => o.correct).map((o) => o.id),
        options: options.map(({ id, kind, language, text }: ChoiceOption) => ({
          id,
          kind,
          ...(language ? { language } : {}),
          text,
        })),
      };
    }
    case 'true_false':
      return {
        type: 'true_false',
        correct: (question.content as unknown as TrueFalseContent).correct === true,
      };
    case 'short_text': {
      const c = question.content as unknown as ShortTextContent;
      return {
        type: 'short_text',
        accepted: (c.accepted ?? []).filter((a) => a.trim() !== ''),
        caseSensitive: c.caseSensitive === true,
      };
    }
    case 'fill_blank': {
      const c = question.content as unknown as FillBlankContent;
      return {
        type: 'fill_blank',
        language: c.language,
        snippet: c.snippet,
        answers: c.answers ?? {},
      };
    }
    case 'order_lines': {
      const c = question.content as unknown as OrderLinesContent;
      return { type: 'order_lines', language: c.language, lines: c.lines ?? [] };
    }
  }
}

/** Whether a student's answer is complete enough for Submit to be enabled. */
export function isAnswerSubmittable(
  type: QuestionType,
  content: Record<string, unknown>,
  answer: AnswerValue | undefined,
): boolean {
  switch (type) {
    case 'mc_single':
      return typeof answer === 'string' && answer !== '';
    case 'mc_multi':
      return Array.isArray(answer) && answer.length > 0;
    case 'true_false':
      return typeof answer === 'boolean';
    case 'short_text':
      return typeof answer === 'string' && answer.trim() !== '';
    case 'fill_blank': {
      if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return false;
      const given = answer as Record<string, string>;
      const snippet = String(content.snippet ?? '');
      const blanks = [...new Set([...snippet.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))];
      return blanks.length > 0 && blanks.every((n) => (given[n] ?? '') !== '');
    }
    case 'order_lines':
      // The shuffled order the student sees already counts as an answer.
      return true;
  }
}
