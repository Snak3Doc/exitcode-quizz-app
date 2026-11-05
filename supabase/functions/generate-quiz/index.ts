/**
 * generate-quiz — turns a teacher's prompt into a draft quiz.
 *
 * This is the shell: transport, authentication and the approved-teacher check.
 * The generation itself is not written yet and the function answers 501 once a
 * caller has got past the gate.
 *
 * It exists as its own deployable piece on purpose. Everything here can be
 * tested against the real project with curl, without an LLM key and without
 * spending any quota, and getting it wrong is how a public endpoint ends up
 * generating quizzes for strangers.
 *
 * Runs on Deno, not in the browser bundle. `tsconfig.app.json` only includes
 * `src`, so the app's typecheck never sees this file.
 *
 * Deploy:
 *   supabase functions deploy generate-quiz
 *   supabase secrets set GEMINI_API_KEY=...
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

/**
 * Every failure answers with this shape. `code` is for the app to branch on,
 * `message` is a readable fallback for curl and for logs — the app has its own
 * wording in `src/strings.ts` and should prefer it.
 *
 * Codes: method_not_allowed, unauthenticated, not_approved, not_implemented.
 * `quota_exhausted` joins them once generation lands: when Gemini's free tier
 * is spent the teacher is told to try tomorrow or build the quiz by hand.
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

  return fail(
    'not_implemented',
    'Quiz generation is not built yet.',
    501,
  );
});
