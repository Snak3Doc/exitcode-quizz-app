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

/** Long enough for a ten-question quiz, short enough to fail before the platform does. */
export const REQUEST_TIMEOUT_MS = 60_000;

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
  /** Injected in tests so retries do not actually wait. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface RawResponse {
  status: number;
  text: string;
}

async function callOnce(
  call: GeminiCall,
  model: string,
  doFetch: typeof fetch,
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 */
export async function generateQuiz(call: GeminiCall): Promise<GeminiResult> {
  const doFetch = call.fetchImpl ?? fetch;
  const sleep = call.sleepImpl ?? realSleep;

  if (call.models.length === 0) {
    return { ok: false, failure: { kind: 'unavailable', detail: 'No models configured.' } };
  }

  let lastDetail = 'No model answered.';

  for (const candidate of call.models) {
    let model = candidate;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { status, text } = await callOnce(call, model, doFetch);

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
        lastDetail = `${model}: ${status}`;
        if (attempt === 1) {
          await sleep(2_000);
          continue;
        }
        break; // Next model.
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
 */
export const DEFAULT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const;
