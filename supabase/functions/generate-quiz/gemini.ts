/**
 * Calling Gemini, shaped by what measurement found rather than by the docs.
 *
 * Four things cost a failed run each and are handled here:
 *
 *  - A **retired model stays in the models list** and 404s only when called,
 *    naming its replacement in the error. `supportedGenerationMethods` is not
 *    enough to pick one.
 *  - **Free-tier models are congested**, and transiently: on 2026-11-12 every
 *    model in the list returned 503 within six seconds of each other, and two
 *    of them answered fine moments later. One model is not enough; a list is,
 *    and so is asking again.
 *  - An **overloaded model accepts the connection and then goes quiet**, which
 *    without an explicit timeout surfaces minutes later as an unhandled error.
 *  - **The good models are rationed by the day, not the minute.** See
 *    `DEFAULT_MODELS` and `spentUntil` below. This is the one that made
 *    generation flaky for a week, and it is invisible until you read a 429's
 *    own error body.
 *
 * `fetch` is injected so this can be tested without the network. Nothing here
 * imports anything or touches a Deno global, so vitest can read it.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Long enough for a ten-question quiz. Measured: 8s, 28s and 39s on 2026-11-10. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * How long the whole call may take, retries and all.
 *
 * One attempt finishing before the platform does is not enough. On 2026-11-10
 * the first two models in the list accepted the connection and never answered,
 * so the loop spent its 60 seconds, slept, and started again -- and Supabase
 * killed the worker at 90s with WORKER_RESOURCE_LIMIT. The browser sees a
 * dropped connection and has nothing to tell the teacher.
 *
 * So the budget belongs to the call, not the attempt. Running out of it is an
 * answer: "busy, try later" is true and act-on-able, where a dead socket is
 * neither. The list will rot again; this is what keeps one bad entry from
 * taking the feature down with it.
 */
export const TOTAL_BUDGET_MS = 70_000;

/**
 * The least time any model in the list is guaranteed.
 *
 * The budget alone was not enough. Ordered best-first, the strongest model
 * takes 39s when it is healthy and the full timeout when it is not, so on
 * 2026-11-10 roughly half of all generations died with the budget spent and
 * 3.5-flash-lite -- which answered in 8s every single time -- never tried at
 * all. "Best first" is only free when there is no ceiling.
 *
 * So every model still to come has this much held back for it, and the model
 * being tried gets what is left over. The good model keeps its chance; the
 * quick one keeps its turn. 12s against a measured 8s leaves room for a bad
 * day without being worth starving anyone for.
 */
export const MIN_MODEL_SLICE_MS = 12_000;

/**
 * How many times the whole list is walked, counting the first.
 *
 * Giving up after one pass threw away most of the budget. Measured on
 * 2026-11-12: the list was walked in about ten seconds, every model said 503,
 * the teacher was told to try later -- and the same call four seconds later
 * succeeded. Sixty of seventy seconds went unused.
 *
 * Bounded rather than budget-driven because this tier is rationed in requests
 * per day. An unbounded loop inside a 70s budget is a way to spend a whole
 * day's allowance on one quiz that was never going to work.
 */
export const MAX_PASSES = 3;

/** The wait before the second pass. Doubled for each pass after it. */
export const FIRST_BACKOFF_MS = 1_500;

/** Why a generation attempt ended, in terms the caller can act on. */
export type GeminiFailure =
  /**
   * Busy, rate limited, or out of quota. `retryAfterMs` is set only when
   * every model has said when it is worth asking again, which is the
   * difference between "try in a minute" and "that is today's allowance".
   * Telling a teacher to try again shortly, when nothing can work for the
   * next fifty minutes, sends them to spend their afternoon on it.
   */
  | { kind: 'unavailable'; detail: string; retryAfterMs?: number }
  /** The request itself was wrong — a bad schema or a bad prompt. Our bug. */
  | { kind: 'rejected'; status: number; detail: string }
  /** The answer was cut off mid-JSON. Fewer questions would fit. */
  | { kind: 'truncated'; detail: string }
  /** The safety filter refused the topic. Rewording it is the only fix. */
  | { kind: 'blocked'; detail: string }
  /** It answered, but not with the JSON we asked for. */
  | { kind: 'unreadable'; detail: string };

/**
 * How much of a worker's life is left to spend on this request.
 *
 * Supabase's wall clock belongs to the **worker**, not the request -- "a
 * worker can serve multiple requests or process background tasks during this
 * period" -- so a worker that has already spent sixty seconds on an earlier
 * generation has ninety left for this one, not a fresh hundred and fifty.
 * That is why a fixed budget kept being wrong: generations run back to back
 * poison each other, and the second one is killed at 546 with nothing to say.
 */
export const WORKER_WALL_CLOCK_MS = 150_000;

/** Room to answer, log and return after the budget runs out. */
export const WORKER_SAFETY_MS = 15_000;

/** Below this, there is no point asking anyone anything. */
export const MIN_USEFUL_BUDGET_MS = MIN_MODEL_SLICE_MS + 3_000;

/** A delay past which "try again later" means a different day, not a moment. */
export const OUT_FOR_THE_DAY_MS = 10 * 60_000;

export function budgetWithin(workerStartedAt: number, nowMs: number): number {
  const left = WORKER_WALL_CLOCK_MS - (nowMs - workerStartedAt) - WORKER_SAFETY_MS;
  return Math.min(TOTAL_BUDGET_MS, Math.max(0, left));
}

/**
 * What the answer cost, for the logs.
 *
 * Worth carrying back purely so the next outage is diagnosable. When 3.8 and
 * 3.7 flash went silent it took a week and a live spike to work out they were
 * thinking rather than broken; one line of `thoughtTokens` in the function
 * logs would have said so the first day.
 */
export interface GeminiUsage {
  promptTokens?: number;
  thoughtTokens?: number;
  outputTokens?: number;
  /** What answered, which is not always what was asked for. */
  modelVersion?: string;
}

export type GeminiResult =
  | {
      ok: true;
      model: string;
      title: string | null;
      questions: unknown[];
      usage: GeminiUsage;
      /** True when this model refused the thinking level and was asked again without it. */
      thinkingDropped: boolean;
    }
  | { ok: false; failure: GeminiFailure };

export interface GeminiCall {
  apiKey: string;
  /** Models to try, cheapest-and-quickest first. */
  models: readonly string[];
  systemPrompt: string;
  userPrompt: string;
  responseSchema: unknown;
  fetchImpl?: typeof fetch;
  /** Injected in tests so the budget can run out without the clock moving. */
  nowImpl?: () => number;
  /** Injected in tests so backoff costs no real time. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Defaults to TOTAL_BUDGET_MS. */
  budgetMs?: number;
}

interface RawResponse {
  status: number;
  text: string;
}

/**
 * Models whose quota is spent, and the moment each is worth asking again.
 *
 * Module scope on purpose: a Supabase worker serves several requests over its
 * life, so this is remembered from one generation to the next without a table,
 * a migration or a read on the hot path. A recycled worker forgets, which
 * costs one wasted request and no correctness.
 *
 * It matters because the ration is daily. When 3.6-flash says "retry in
 * 3161s", every request that asks it again before then is spent for nothing --
 * and before this existed, that was every generation for the rest of the day.
 */
const spentUntil = new Map<string, number>();

/** For tests, which would otherwise leak one case's quota state into the next. */
export function forgetSpentQuota(): void {
  spentUntil.clear();
}

function isSpent(model: string, nowMs: number): boolean {
  const until = spentUntil.get(model);
  if (until === undefined) return false;
  if (until <= nowMs) {
    spentUntil.delete(model);
    return false;
  }
  return true;
}

/**
 * How long Google says to wait, from the 429's own RetryInfo.
 *
 * Worth reading rather than guessing: the same status covers "you are going a
 * bit fast" and "that is your twenty for today", and the only thing that tells
 * them apart is this number. Measured 2026-11-12: a per-day violation on
 * 3.6-flash came back as `"retryDelay": "3161s"`.
 */
export function retryDelayMs(text: string): number | null {
  try {
    const body = JSON.parse(text) as {
      error?: { details?: { retryDelay?: unknown }[] };
    };
    for (const detail of body.error?.details ?? []) {
      if (typeof detail.retryDelay !== 'string') continue;
      const seconds = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(detail.retryDelay);
      if (seconds) return Math.round(Number(seconds[1]) * 1_000);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The wait before a pass, jittered.
 *
 * The jitter is not decoration. Without it every teacher whose generation hit
 * the same overloaded model comes back in lockstep, which is the pile-up
 * backoff exists to break up.
 */
function backoffFor(pass: number, random: () => number): number {
  const base = FIRST_BACKOFF_MS * 2 ** (pass - 1);
  return Math.round(base * (0.75 + random() * 0.5));
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How hard a model should think before writing, or null to leave it alone.
 *
 * Gemini 3 models think by default and the default is not small -- 3.8-flash
 * defaults to MEDIUM. That is almost certainly what "the model accepted the
 * connection and never answered" was: not a broken model, a model still
 * thinking when the 60s timeout fired. Thinking tokens also count against the
 * output limit, so a long think can eat the whole answer.
 *
 * A rule rather than a table, so it survives the list changing and the 404
 * redirect landing somewhere new. The flash-lite models already come back
 * with zero thinking tokens (measured 2026-11-12), so there is nothing to
 * turn down and asking would only risk a 400 for no gain.
 *
 * LOW rather than MINIMAL on purpose, twice over: MINIMAL is not accepted by
 * every model -- 3.8-flash answered `Thinking level MINIMAL is not supported
 * for this model` -- and these questions need some reasoning. "Work out what
 * this code prints line by line" is the one thing the system prompt insists
 * on, and a question with the wrong answer marked correct is worse than a
 * slow one.
 */
export function thinkingLevelFor(model: string): string | null {
  if (model.includes('flash-lite')) return null;
  if (model.includes('flash')) return 'LOW';
  return null;
}

async function callOnce(
  call: GeminiCall,
  model: string,
  doFetch: typeof fetch,
  timeoutMs: number,
  thinkingLevel: string | null,
): Promise<RawResponse> {
  try {
    const response = await doFetch(
      `${BASE}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The key belongs in a header, not in `?key=`. A query string is
          // logged by every proxy between here and Google, and the point of
          // keeping this call on the server was that the key stays secret.
          'x-goog-api-key': call.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: call.userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: call.responseSchema,
            ...(thinkingLevel === null ? {} : { thinkingConfig: { thinkingLevel } }),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    return { status: response.status, text: await response.text() };
  } catch (error) {
    // A hang or a dropped connection means the same thing to the teacher as a
    // 503: this model is not answering. Treat it as such rather than throwing.
    return {
      status: 503,
      text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * How long the model being tried may have, given how many are still to come.
 *
 * Each of those is owed MIN_MODEL_SLICE_MS, so this model gets the rest --
 * capped at REQUEST_TIMEOUT_MS, since beyond that it is not coming. When the
 * reservation would leave this model nothing, it still gets a slice: it is the
 * one being asked, and a socket opened for zero milliseconds helps nobody.
 */
function sliceFor(timeLeft: number, modelsStillToCome: number): number {
  const share = Math.min(REQUEST_TIMEOUT_MS, timeLeft - modelsStillToCome * MIN_MODEL_SLICE_MS);
  return share > 0 ? share : Math.min(MIN_MODEL_SLICE_MS, timeLeft);
}

/** A 200 that is not a usable quiz, and which of the three it is. */
type BadRead = { ok: false; why: 'truncated' | 'blocked' | 'unreadable'; detail: string };

type QuizRead =
  | { ok: true; title: string | null; questions: unknown[]; usage: GeminiUsage }
  | BadRead;

/**
 * Finish reasons that mean the filter stopped it, not that we asked wrongly.
 *
 * Kept apart from the other failures because the teacher can act on this one
 * and only this one: no amount of trying again helps, and rewording the topic
 * always does.
 */
const BLOCKED_FINISHES = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
]);

/**
 * Pull the quiz out of a successful response, or say why there isn't one.
 *
 * A 200 is not the same as an answer. The response carries a `finishReason`
 * and, when the prompt itself was refused, a `promptFeedback.blockReason` and
 * no candidates at all. All of these used to arrive at the same place -- the
 * parse failed, and the teacher was told "Generation did not work this time",
 * which is true and useless. Three of them have different fixes.
 */
function readQuiz(text: string): QuizRead {
  let body: {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
    modelVersion?: string;
    usageMetadata?: {
      promptTokenCount?: number;
      thoughtsTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return { ok: false, why: 'unreadable', detail: text.slice(0, 500) };
  }

  // A refused prompt comes back with no candidates whatsoever, so this has to
  // be read before anything tries to reach into them.
  const blockReason = body.promptFeedback?.blockReason;
  if (typeof blockReason === 'string' && blockReason !== '') {
    return { ok: false, why: 'blocked', detail: `prompt blocked: ${blockReason}` };
  }

  const candidate = body.candidates?.[0];
  const finish = candidate?.finishReason;
  const raw = candidate?.content?.parts?.[0]?.text;

  if (typeof raw !== 'string') {
    if (finish !== undefined && BLOCKED_FINISHES.has(finish)) {
      return { ok: false, why: 'blocked', detail: `stopped: ${finish}` };
    }
    // Thinking tokens count against the output limit, so a model can spend
    // the whole allowance before writing a single question.
    if (finish === 'MAX_TOKENS') {
      return { ok: false, why: 'truncated', detail: 'no output within the token limit' };
    }
    return { ok: false, why: 'unreadable', detail: text.slice(0, 500) };
  }

  let parsed: { title?: unknown; questions?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // JSON that stops mid-object is what a cut-off answer looks like, and the
    // finish reason is the only thing that distinguishes it from nonsense.
    if (finish === 'MAX_TOKENS' || finish === 'CONTINUATION') {
      return { ok: false, why: 'truncated', detail: `cut off after ${raw.length} characters` };
    }
    return { ok: false, why: 'unreadable', detail: raw.slice(0, 500) };
  }

  if (!Array.isArray(parsed.questions)) {
    if (finish === 'MAX_TOKENS') {
      return { ok: false, why: 'truncated', detail: 'no questions within the token limit' };
    }
    return { ok: false, why: 'unreadable', detail: raw.slice(0, 500) };
  }

  // A missing title is not a failure: the caller has the teacher's topic to
  // fall back on, and losing a whole quiz over its name would be absurd.
  const title = typeof parsed.title === 'string' && parsed.title.trim() !== ''
    ? parsed.title.trim()
    : null;
  return {
    ok: true,
    title,
    questions: parsed.questions,
    usage: {
      promptTokens: body.usageMetadata?.promptTokenCount,
      thoughtTokens: body.usageMetadata?.thoughtsTokenCount,
      outputTokens: body.usageMetadata?.candidatesTokenCount,
      modelVersion: body.modelVersion,
    },
  };
}

function failureFor(read: BadRead): GeminiFailure {
  switch (read.why) {
    case 'truncated':
      return { kind: 'truncated', detail: read.detail };
    case 'blocked':
      return { kind: 'blocked', detail: read.detail };
    default:
      return { kind: 'unreadable', detail: read.detail };
  }
}

/**
 * When the first model comes back, or null while any is still worth asking.
 *
 * Null is the ordinary case -- something is merely busy. A number means every
 * model has named a time, and the teacher can be told which kind of "later"
 * this is instead of being sent to retry for the next fifty minutes.
 */
function soonestReturn(models: readonly string[], nowMs: number): number | null {
  let soonest: number | null = null;
  for (const model of models) {
    const until = spentUntil.get(model);
    if (until === undefined || until <= nowMs) return null;
    soonest = soonest === null ? until : Math.min(soonest, until);
  }
  return soonest === null ? null : soonest - nowMs;
}

function unavailable(detail: string, retryAfterMs?: number): GeminiResult {
  const failure: GeminiFailure =
    retryAfterMs === undefined
      ? { kind: 'unavailable', detail }
      : { kind: 'unavailable', detail, retryAfterMs };
  return { ok: false, failure };
}

/**
 * Ask for a quiz, trying each model in turn and then trying again.
 *
 * One pass down the list, each model getting a single go -- a model that has
 * just said it is overloaded is a worse bet than one that has not been asked.
 * Then, if the budget allows, the whole list again after a jittered backoff,
 * because a 503 on this tier clears in seconds.
 *
 * Skipped on every pass: any model whose own 429 told us when to come back and
 * that moment has not arrived. A retired model is swapped for the replacement
 * it names. A 400 is returned straight away, because it says something about
 * the request rather than about the weather, and no other model will like it
 * any better.
 *
 * The whole walk shares one budget. Whatever the models do, this answers.
 */
export async function generateQuiz(call: GeminiCall): Promise<GeminiResult> {
  const doFetch = call.fetchImpl ?? fetch;
  const now = call.nowImpl ?? Date.now;
  const sleep = call.sleepImpl ?? realSleep;

  if (call.models.length === 0) {
    return unavailable('No models configured.');
  }

  const deadline = now() + (call.budgetMs ?? TOTAL_BUDGET_MS);
  let lastDetail = 'No model answered.';

  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    if (pass > 1) {
      // Another pass is only worth making if, after the wait, a model would
      // get a real slice rather than a socket that closes before it can
      // answer. Checking only that the sleep itself fits is not enough: it
      // leaves just enough budget to open a connection and abandon it, which
      // spends a request to learn nothing.
      const wait = backoffFor(pass - 1, Math.random);
      if (now() + wait + MIN_MODEL_SLICE_MS >= deadline) break;
      await sleep(wait);
    }

    const candidates = call.models.filter((model) => !isSpent(model, now()));
    if (candidates.length === 0) {
      // Every model has told us to come back later and meant it. Asking
      // anyway is the exact waste this is here to stop.
      return unavailable(
        `Every model's quota is spent. ${lastDetail}`,
        soonestReturn(call.models, now()) ?? undefined,
      );
    }

    for (let index = 0; index < candidates.length; index += 1) {
      let model = candidates[index];
      let thinking = thinkingLevelFor(model);
      let thinkingDropped = false;

      // Up to three turns per entry: a retired model can be followed to the
      // replacement it names, and one that will not take the thinking level
      // can be asked again without it. Neither is a retry -- see the 503 case
      // below for why a busy model gets no second go on this pass.
      for (let hop = 1; hop <= 3; hop += 1) {
        // No model may be given longer than the call has left, and one with
        // nothing left is not worth opening a socket for.
        const timeLeft = deadline - now();
        if (timeLeft <= 0) {
          return unavailable(`Ran out of time. ${lastDetail}`);
        }

        const { status, text } = await callOnce(
          call,
          model,
          doFetch,
          sliceFor(timeLeft, candidates.length - index - 1),
          thinking,
        );

        if (status === 200) {
          const quiz = readQuiz(text);
          if (!quiz.ok) return { ok: false, failure: failureFor(quiz) };
          return {
            ok: true,
            model,
            title: quiz.title,
            questions: quiz.questions,
            usage: quiz.usage,
            thinkingDropped,
          };
        }

        const suggested = /use models\/([A-Za-z0-9._-]+)/.exec(text)?.[1];
        if (status === 404 && suggested && suggested !== model) {
          model = suggested;
          // The replacement is a different model and may want a different
          // level, or none.
          thinking = thinkingLevelFor(model);
          continue;
        }

        // A model that will not take the thinking level says so in a 400, and
        // that is about this model rather than about the request -- so unlike
        // every other 400 it must not take the whole generation down with it.
        // Measured 2026-11-12: 3.8-flash answers `Thinking level MINIMAL is
        // not supported for this model`. The level we send is not MINIMAL,
        // but the trap is the same shape whatever Google changes next.
        if (status === 400 && thinking !== null && /thinking/i.test(text)) {
          thinking = null;
          thinkingDropped = true;
          lastDetail = `${model}: refused thinking level, asked again without it`;
          continue;
        }

        if (status === 429) {
          // The one status that carries its own answer. Believe it: a model
          // that says 3161 seconds will say it again, and every one of those
          // requests is gone from the day's allowance for nothing.
          const delay = retryDelayMs(text);
          if (delay !== null) {
            spentUntil.set(model, now() + delay);
            lastDetail = `${model}: 429, out for ${Math.round(delay / 1_000)}s`;
          } else {
            lastDetail = `${model}: 429`;
          }
          break;
        }

        if (status === 503 || status === 500) {
          // Straight on to the next model, with no second go at this one on
          // this pass. The next pass is where it gets asked again, by which
          // time a spike has usually passed.
          lastDetail = `${model}: ${status}`;
          break;
        }

        // 400 and friends: the request is wrong, and trying another model with
        // the same request would only waste more of the day's quota.
        return { ok: false, failure: { kind: 'rejected', status, detail: text.slice(0, 500) } };
      }
    }
  }

  return unavailable(lastDetail, soonestReturn(call.models, now()) ?? undefined);
}

/**
 * The models to try, cheapest and quickest first.
 *
 * Asking the API which models exist sounds better than a list, and is not: the
 * list includes retired models, and the newest are the most congested. A
 * hard-coded order is more reliable, and `generateQuiz` follows Google's
 * redirect if one of these retires.
 *
 * The order here is by **daily allowance**, not by capability, and that is the
 * fix for a week of flaky generation. Measured 2026-11-12, from the 429's own
 * error body: `gemini-3.6-flash` is capped at twenty requests per day on the
 * free tier (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue
 * 20). It used to be first, so every quiz spent one of those twenty before
 * reaching a model that answers -- and a quiz costs more than one request,
 * because the repair pass and every "regenerate this question" start the walk
 * again. Once the twenty were gone, every generation for the rest of the day
 * wasted a guaranteed-429 request on it first.
 *
 * Both flash-lite models returned a valid ten-question quiz in 4.5s and 5.6s
 * with zero thinking tokens, and their allowance runs to the hundreds. So they
 * lead, and 3.6-flash is the reserve rather than the default.
 *
 * Worth being honest about: no one has compared the *quality* of the questions
 * these write against 3.6-flash. If generated questions get noticeably worse,
 * this order is the first thing to revisit, and that comparison is the thing
 * to do before changing it back.
 *
 * 3.8-flash and 3.7-flash are deliberately absent. They take a connection and
 * never answer within 60s, which is almost certainly default thinking -- 3.8
 * defaults to MEDIUM -- rather than the models being broken.
 *
 * If generation starts failing again, this list is the first thing to check:
 * call each one and see what answers. `scripts/try-generation.ts` does it.
 */
export const DEFAULT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
] as const;
