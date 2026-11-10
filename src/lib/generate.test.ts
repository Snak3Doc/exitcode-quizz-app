/**
 * Turning a failed call into something a teacher can act on.
 *
 * Worth testing on its own because every one of these paths is invisible until
 * it fires, and the wrong message sends a teacher to fix the wrong thing. The
 * live case that prompted this: a worker killed mid-generation came back as
 * "check your connection", so the advice was to retry a request that would be
 * killed again every time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../strings';

const invoke = vi.fn();

vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));

const { GenerationError, generateQuiz } = await import('./generate');

/** What supabase-js hands back for a non-2xx: an error carrying the response. */
function failedWith(status: number, body: unknown) {
  return {
    data: null,
    error: Object.assign(new Error(`status ${status}`), {
      context: new Response(JSON.stringify(body), { status }),
    }),
  };
}

const options = { topic: 'Python loops', count: 5, types: ['true_false' as const], timing: { mode: 'wait' as const } };

async function messageFrom(reply: unknown): Promise<string> {
  invoke.mockResolvedValueOnce(reply);
  try {
    await generateQuiz(options);
  } catch (caught) {
    expect(caught).toBeInstanceOf(GenerationError);
    return (caught as Error).message;
  }
  throw new Error('expected generateQuiz to throw');
}

beforeEach(() => {
  invoke.mockReset();
});

describe('what a teacher is told when generation fails', () => {
  it('names the real problem when the worker is killed mid-generation', async () => {
    // Supabase answers 546 with its code at the top level, not inside the
    // `error` the function itself documents -- a killed worker never reached
    // the code that would have nested it. Reading only `error.code` found
    // nothing and fell through to the catch-all.
    const message = await messageFrom(
      failedWith(546, {
        code: 'WORKER_RESOURCE_LIMIT',
        message: 'Function failed due to not having enough compute resources',
      }),
    );

    expect(message).toBe(S.generate.tookTooLong);
    expect(message).not.toBe(S.generate.unreachable);
  });

  it('sends an expired teacher back to sign in', async () => {
    // The function has always returned this; nothing read it, so a stale
    // session also reported itself as a connection problem.
    const message = await messageFrom(
      failedWith(401, { error: { code: 'unauthenticated', message: 'Sign in again.' } }),
    );

    expect(message).toBe(S.generate.signedOut);
  });

  it('treats the gateway\'s own 401 as an expired sign-in too', async () => {
    // The gateway in front of the function has codes of its own and no reason
    // to use ours, so the code is no help here. The status is.
    const message = await messageFrom(
      failedWith(401, {
        code: 'UNAUTHORIZED_NO_AUTH_HEADER',
        message: 'Missing authorization header',
      }),
    );

    expect(message).toBe(S.generate.signedOut);
  });

  it('passes on the codes the function documents', async () => {
    expect(await messageFrom(failedWith(503, { error: { code: 'quota_exhausted' } }))).toBe(
      S.generate.unavailable,
    );
    expect(await messageFrom(failedWith(403, { error: { code: 'not_approved' } }))).toBe(
      S.generate.notApproved,
    );
    expect(await messageFrom(failedWith(500, { error: { code: 'server_misconfigured' } }))).toBe(
      S.generate.misconfigured,
    );
    expect(await messageFrom(failedWith(502, { error: { code: 'generation_failed' } }))).toBe(
      S.generate.failed,
    );
    expect(await messageFrom(failedWith(405, { error: { code: 'method_not_allowed' } }))).toBe(
      S.generate.failed,
    );
  });

  it('falls back without blaming the teacher when there is no code to read', async () => {
    const message = await messageFrom({
      data: null,
      error: Object.assign(new Error('network'), {
        context: new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      }),
    });

    expect(message).toBe(S.generate.unreachable);
  });

  it('says so when the model answered with nothing usable', async () => {
    invoke.mockResolvedValueOnce({ data: { questions: [] }, error: null });
    await expect(generateQuiz(options)).rejects.toThrow(S.generate.noneUsable);
  });
});
