/**
 * Calling Gemini, shaped by what the spike found rather than by the docs.
 *
 * Three things cost a failed run each on 2026-11-05 and are handled here:
 *
 *  - A **retired model stays in the models list** and 404s only when called,
 *    naming its replacement in the error. `supportedGenerationMethods` is not
 *    enough to pick one.
 *  - The **newest free models are congested**: 3.8, 3.7 and 3.6 flash all
 *    returned 503 while 3.5-flash answered. One model is not enough; a list is.
 *  - An **overloaded model accepts the connection and then goes quiet**, which
 *    without an explicit timeout surfaces minutes later as an unhandled error.
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

/** Why a generation attempt ended, in terms the caller can act on. */
export type GeminiFailure =
  /** Busy, rate limited, or out of quota. The teacher is told to try later. */
  | { kind: 'unavailable'; detail: string }
  /** The request itself was wrong — a bad schema or a bad prompt. Our bug. */
  | { kind: 'rejected'; status: number; detail: string }
  /** It answered, but not with the JSON we asked for. */
  | { kind: 'unreadable'; detail: string };

export type GeminiResult =
  | { ok: true; model: string; questions: unknown[] }
  | { ok: false; failure: GeminiFailure };

export interface GeminiCall {
  apiKey: string;
  /** Models to try, newest first. */
  models: readonly string[];
  systemPrompt: string;
  userPrompt: string;
  responseSchema: unknown;
  fetchImpl?: typeof fetch;
  /** Injected in tests so the budget can run out without the clock moving. */
  nowImpl?: () => number;
  /** Defaults to TOTAL_BUDGET_MS. */
  budgetMs?: number;
}

interface RawResponse {
  status: number;
  text: string;
}

async function callOnce(
  call: GeminiCall,
  model: string,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<RawResponse> {
  try {
    const response = await doFetch(
      `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(call.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: call.userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: call.responseSchema,
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

/** Pull the questions array out of a successful response. */
function readQuestions(text: string): unknown[] | null {
  try {
    const body = JSON.parse(text) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as { questions?: unknown };
    return Array.isArray(parsed.questions) ? parsed.questions : null;
  } catch {
    return null;
  }
}

/**
 * Ask for a quiz, trying each model in turn.
 *
 * A model that is busy gets one retry and then we move down the list; a model
 * that is retired is swapped for the replacement it names. Anything else is
 * returned straight away, because it says something about the request rather
 * than about the weather.
 *
 * The whole walk shares one budget. Whatever the models do, this answers.
 */
export async function generateQuiz(call: GeminiCall): Promise<GeminiResult> {
  const doFetch = call.fetchImpl ?? fetch;
  const now = call.nowImpl ?? Date.now;

  if (call.models.length === 0) {
    return { ok: false, failure: { kind: 'unavailable', detail: 'No models configured.' } };
  }

  const deadline = now() + (call.budgetMs ?? TOTAL_BUDGET_MS);
  let lastDetail = 'No model answered.';

  for (let index = 0; index < call.models.length; index += 1) {
    let model = call.models[index];

    // Two turns per entry, so a retired model can be followed to the
    // replacement it names. Not a retry: see the 503 case below.
    for (let hop = 1; hop <= 2; hop += 1) {
      // No model may be given longer than the call has left, and one with
      // nothing left is not worth opening a socket for.
      const timeLeft = deadline - now();
      if (timeLeft <= 0) {
        return {
          ok: false,
          failure: { kind: 'unavailable', detail: `Ran out of time. ${lastDetail}` },
        };
      }

      const { status, text } = await callOnce(
        call,
        model,
        doFetch,
        sliceFor(timeLeft, call.models.length - index - 1),
      );

      if (status === 200) {
        const questions = readQuestions(text);
        if (questions === null) {
          return {
            ok: false,
            failure: { kind: 'unreadable', detail: text.slice(0, 500) },
          };
        }
        return { ok: true, model, questions };
      }

      const suggested = /use models\/([A-Za-z0-9._-]+)/.exec(text)?.[1];
      if (status === 404 && suggested && suggested !== model) {
        model = suggested;
        continue;
      }

      if (status === 503 || status === 429 || status === 500) {
        // Straight on to the next model, with no second go at this one. A
        // model that has just said it is overloaded is a worse bet than one
        // that has not been asked, and the budget only stretches so far.
        lastDetail = `${model}: ${status}`;
        break;
      }

      // 400 and friends: the request is wrong, and trying another model with
      // the same request would only waste more of the day's quota.
      return { ok: false, failure: { kind: 'rejected', status, detail: text.slice(0, 500) } };
    }
  }

  return { ok: false, failure: { kind: 'unavailable', detail: lastDetail } };
}

/**
 * The models to try, newest first.
 *
 * Asking the API which models exist sounds better than a list, and is not: the
 * list includes retired models, and the newest are the most congested. A
 * hard-coded order that ends somewhere old and quiet is more reliable, and
 * `generateQuiz` follows Google's redirect if one of these retires.
 *
 * 3.8-flash and 3.7-flash were at the head of this list and are gone from it.
 * They are still in the API's own model list and still take a connection, but
 * on 2026-11-10 neither sent a byte back -- not a 503, nothing -- so every
 * generation died on the first entry. Measured with a real ten-question quiz
 * that day: 3.6-flash 39s, 3.5-flash 28s, 3.5-flash-lite 8s.
 *
 * If generation starts failing again, this list is the first thing to check:
 * call each one and see what answers. `scripts/try-generation.ts` does it.
 */
export const DEFAULT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const;
