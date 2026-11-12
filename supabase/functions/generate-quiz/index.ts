/**
 * generate-quiz — turns a teacher's prompt into a draft quiz.
 *
 * Transport, authentication, the approved-teacher check, and the call to
 * Gemini. It returns the model's questions untouched: converting and
 * validating them happens in the browser, where `checkQuestion()` already
 * judges imported questions, so generated ones meet the same bar by the same
 * code rather than a second copy of it.
 *
 * The auth gate comes first and is worth keeping that way — getting it wrong
 * is how a public endpoint ends up generating quizzes for strangers on
 * someone else's quota.
 *
 * Runs on Deno, not in the browser bundle. `tsconfig.app.json` only includes
 * `src`, so the app's typecheck never sees this file.
 *
 * Deploy:
 *   supabase functions deploy generate-quiz
 *   supabase secrets set GEMINI_API_KEY=...
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  DEFAULT_MODELS,
  MIN_USEFUL_BUDGET_MS,
  OUT_FOR_THE_DAY_MS,
  budgetWithin,
  generateQuiz,
} from './gemini.ts';
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from './prompt.ts';
import { checkRequest, isRepair, type GenerateRequest } from './request.ts';
import { quizSchemaFor } from './schema.ts';

/**
 * Every failure answers with this shape. `code` is for the app to branch on,
 * `message` is a readable fallback for curl and for logs — the app has its own
 * wording in `src/strings.ts` and should prefer it.
 *
 * Codes, and what the app should do with each:
 *
 *   method_not_allowed    a bug in the caller
 *   unauthenticated       send the teacher back to sign in
 *   not_approved          this account is not on the allowed list
 *   bad_request           the form let through something it should not have
 *   quota_exhausted       busy or rate limited -- try again shortly, or build
 *                         the quiz by hand, which is the whole app as it
 *                         already exists
 *   out_of_quota_today    the day's free requests are gone on every model, and
 *                         nothing will work until they reset. Worth its own
 *                         code: "try again later" sent teachers back every few
 *                         minutes for the best part of an hour
 *   topic_blocked         the safety filter refused the topic. Only the
 *                         teacher can fix this, by rewording it
 *   too_long              the answer was cut off mid-JSON. Fewer questions fit
 *   server_busy           this worker has no time left to finish a generation.
 *                         The next request gets a fresh one, so trying again
 *                         now genuinely works
 *   generation_failed     the model answered with something unusable; the
 *                         detail is in the function logs, not on screen
 *   server_misconfigured  the operator's problem, not the teacher's. Say so
 *                         plainly rather than folding it into a generic
 *                         failure, or a missing secret is very hard to
 *                         recognise from the UI.
 */
interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Allowing any origin is safe here and is not the usual trade-off.
 *
 * The caller's credential is a bearer token this function requires in the
 * Authorization header; it is not a cookie, so a browser will not attach it to
 * a cross-site request on its own. A page on another origin can call this
 * endpoint, but only with a token it already has — and if it has the token it
 * did not need our CORS policy to use it. Pinning the origin would mean
 * maintaining a list of localhost, the Vercel domain and every preview URL,
 * which buys nothing against that.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } } satisfies ErrorBody, status);
}

/**
 * When this worker booted, which is not when this request arrived.
 *
 * Module scope is the whole point: Supabase's wall clock is the worker's, and
 * a worker serves several requests over its life. Reading the clock here is
 * the only way to know how much of that life a generation can still have.
 */
const workerStartedAt = Date.now();

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return fail('method_not_allowed', 'Send a POST request.', 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return fail('unauthenticated', 'Sign in first.', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    // Misconfiguration, not the caller's fault. Say so without leaking which.
    console.error('SUPABASE_URL or SUPABASE_ANON_KEY is missing from the function environment.');
    return fail('server_misconfigured', 'The server is not set up correctly.', 500);
  }

  // The caller's own token, so `auth.jwt()` inside the database sees the
  // teacher rather than the service role. is_allowed_teacher() reads the email
  // out of that token, which is the whole reason to pass it through.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAllowed, error: rpcError } = await supabase.rpc('is_allowed_teacher');

  if (rpcError) {
    // A bad or expired token lands here rather than on a false result, because
    // the function is only granted to `authenticated`.
    console.error('is_allowed_teacher failed:', rpcError.message);
    return fail('unauthenticated', 'Sign in again.', 401);
  }

  if (isAllowed !== true) {
    // Signed in, but not on the list. The same answer the rest of the app
    // gives: the database decides this, not the app.
    return fail('not_approved', 'This account is not an approved teacher.', 403);
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    console.error('GEMINI_API_KEY is missing. Run: supabase secrets set GEMINI_API_KEY=...');
    return fail('server_misconfigured', 'The server is not set up correctly.', 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('bad_request', 'Send a JSON body.', 400);
  }

  const problem = checkRequest(body);
  if (problem) return fail('bad_request', problem, 400);

  // A repair asks for replacements for questions that came back unusable. It
  // shares the schema and the system prompt with a fresh quiz -- only what is
  // asked for differs -- so the answers travel the same path home.
  const repairing = isRepair(body);
  const topic = (repairing ? body.topic : (body as GenerateRequest).topic).trim();
  const types = repairing
    ? [...new Set(body.repair.map((entry) => entry.type))]
    : [...new Set((body as GenerateRequest).types)];

  // What is left of this worker's life, not a fixed guess. A generation that
  // cannot finish inside it is killed at 546 with nothing to tell anyone, so
  // it is better not to start -- and better still not to spend a request on it.
  const budgetMs = budgetWithin(workerStartedAt, Date.now());
  if (budgetMs < MIN_USEFUL_BUDGET_MS) {
    console.warn(`Worker has ${budgetMs}ms of budget left; refusing rather than being killed.`);
    return fail('server_busy', 'The server is out of time for this one.', 503);
  }

  const result = await generateQuiz({
    apiKey: geminiKey,
    models: DEFAULT_MODELS,
    systemPrompt: buildSystemPrompt(types),
    userPrompt: repairing
      ? buildRepairPrompt(topic, body.repair)
      : buildUserPrompt({ topic, count: (body as GenerateRequest).count, types }),
    responseSchema: quizSchemaFor(types, !repairing),
    budgetMs,
  });

  if (!result.ok) {
    const { failure } = result;

    if (failure.kind === 'unavailable') {
      console.warn('Gemini unavailable:', failure.detail);
      // The one distinction worth making to a teacher: a spike clears in
      // seconds, a spent daily allowance does not clear until it resets.
      if (failure.retryAfterMs !== undefined && failure.retryAfterMs > OUT_FOR_THE_DAY_MS) {
        return fail('out_of_quota_today', "Today's free requests are used up.", 503);
      }
      return fail('quota_exhausted', 'Generation is unavailable right now.', 503);
    }

    if (failure.kind === 'blocked') {
      // Not our bug and not a transient one. Retrying is the one thing that
      // cannot help, so say what would.
      console.warn('Prompt refused:', failure.detail);
      return fail('topic_blocked', 'The topic was refused.', 422);
    }

    if (failure.kind === 'truncated') {
      console.warn('Answer cut off:', failure.detail);
      return fail('too_long', 'The answer was cut off before it finished.', 502);
    }

    // A rejected request or unreadable output is our bug, not the teacher's,
    // and the detail belongs in the logs rather than on their screen.
    console.error('Generation failed:', JSON.stringify(failure));
    return fail('generation_failed', 'Generation did not work this time.', 502);
  }

  // What it cost, so the next outage is readable from the logs rather than
  // guessed at. When 3.8 and 3.7 flash went quiet it took a week to work out
  // they were thinking, not broken; `thought=` would have said so on day one.
  const { usage } = result;
  console.log(
    `Generated ${result.questions.length} question(s) with ${result.model}` +
      `${result.thinkingDropped ? ' (thinking level refused, asked again without it)' : ''}: ` +
      `prompt=${usage.promptTokens ?? '?'} thought=${usage.thoughtTokens ?? '?'} ` +
      `out=${usage.outputTokens ?? '?'} served-by=${usage.modelVersion ?? '?'}`,
  );

  // The questions go back raw. Converting and validating them happens in the
  // browser, where `checkQuestion()` already judges imported questions, so
  // generated ones are held to exactly the same standard by the same code.
  return json({ model: result.model, title: result.title, questions: result.questions }, 200);
});
