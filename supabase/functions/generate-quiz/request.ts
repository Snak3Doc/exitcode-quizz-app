/**
 * What the browser may ask for, and what it may not.
 *
 * The caller is an approved teacher, so this is not a defence against an
 * attacker so much as a defence against a bug or a stray click spending the
 * day's quota. A free tier gives no second chances.
 *
 * No imports and no Deno globals, so vitest can read it (see `schema.ts`).
 */

import { QUESTION_TYPE_VALUES } from './schema.ts';

/**
 * Well below the schema's 50-question ceiling.
 *
 * Past twenty the response is long enough to risk the request timing out, and
 * a timed-out request still costs the quota of a successful one.
 */
export const MAX_QUESTIONS_PER_REQUEST = 20;

/** Roughly a long paragraph. Enough for a lesson topic, not a pasted worksheet. */
export const MAX_TOPIC_LENGTH = 2_000;

export interface GenerateRequest {
  topic: string;
  count: number;
  types: string[];
}

/** One failed question to write a replacement for. */
export interface RepairEntry {
  type: string;
  problems: string[];
  question?: unknown;
}

export interface RepairRequest {
  topic: string;
  repair: RepairEntry[];
}

/** A repair asks for replacements rather than a fresh quiz. */
export function isRepair(body: unknown): body is RepairRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { repair?: unknown }).repair)
  );
}

function checkTopic(topic: unknown): string | null {
  if (typeof topic !== 'string' || topic.trim() === '') {
    return 'Say what the quiz should be about.';
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return `Keep the topic under ${MAX_TOPIC_LENGTH} characters.`;
  }
  return null;
}

function checkTypes(types: unknown): string | null {
  if (!Array.isArray(types) || types.length === 0) {
    return 'Choose at least one question type.';
  }
  const unknown = types.filter((type) => !QUESTION_TYPE_VALUES.includes(type as never));
  if (unknown.length > 0) {
    return `Unknown question type: ${unknown.join(', ')}`;
  }
  return null;
}

/** The problem with this request, or null when there is none. */
export function checkRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return 'Send a JSON object.';
  }

  if (isRepair(body)) return checkRepairRequest(body);

  const { topic, count, types } = body as Partial<GenerateRequest>;

  const topicProblem = checkTopic(topic);
  if (topicProblem) return topicProblem;

  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return 'Ask for at least one question.';
  }
  if (count > MAX_QUESTIONS_PER_REQUEST) {
    return `Ask for at most ${MAX_QUESTIONS_PER_REQUEST} questions at a time.`;
  }

  return checkTypes(types);
}

function checkRepairRequest(body: RepairRequest): string | null {
  const topicProblem = checkTopic(body.topic);
  if (topicProblem) return topicProblem;

  if (body.repair.length === 0) {
    return 'Nothing to repair.';
  }
  // A repair cannot ask for more than a whole quiz could, or a malformed first
  // pass becomes a way to spend an unbounded amount of the day's quota.
  if (body.repair.length > MAX_QUESTIONS_PER_REQUEST) {
    return `Ask for at most ${MAX_QUESTIONS_PER_REQUEST} replacements at a time.`;
  }

  return checkTypes(body.repair.map((entry) => entry?.type));
}
