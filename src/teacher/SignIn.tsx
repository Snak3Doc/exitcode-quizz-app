/** Teacher sign in: Google, or email + password with confirmation. SPEC 9. */

import { useState, type FormEvent } from 'react';
import { S } from '../strings';
import { useAuth } from '../lib/auth';
import {
  SUPABASE_SETUP_MESSAGE,
  supabase,
  supabaseConfigured,
  teacherRedirectUrl,
} from '../lib/supabase';

export function SignIn() {
  const { rejectedMessage, clearRejected } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setError(null);
    setNotice(null);
    clearRejected();
  }

  async function signInWithGoogle() {
    reset();
    setBusy(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: teacherRedirectUrl() },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
    // On success the browser leaves this page for Google.
  }

  function localProblem(): string | null {
    if (email.trim() === '' || password === '') return S.signIn.emailAndPasswordRequired;
    if (password.length < 6) return S.signIn.passwordTooShort;
    return null;
  }

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    reset();
    const problem = localProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) setError(signInError.message);
    setBusy(false);
    // A successful sign-in is picked up by the auth listener, which also runs
    // the approved-teacher check.
  }

  async function createAccount() {
    reset();
    const problem = localProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: teacherRedirectUrl() },
    });
    if (signUpError) setError(signUpError.message);
    else setNotice(S.signIn.checkInbox);
    setBusy(false);
  }

  return (
    <main className="centre-page">
      <h1 className="narrow dollar" style={{ textAlign: 'center' }}>
        {S.app.name}
      </h1>

      {!supabaseConfigured && (
        <div className="narrow banner error">{SUPABASE_SETUP_MESSAGE}</div>
      )}

      <form className="narrow window" onSubmit={signInWithPassword}>
        <div className="title-bar">{S.signIn.signIn}</div>
        <div className="body">
          <button
            type="button"
            className="primary"
            onClick={signInWithGoogle}
            disabled={busy || !supabaseConfigured}
          >
            {S.signIn.google}
          </button>

          <div className="faint" style={{ textAlign: 'center' }}>
            {S.signIn.or}
          </div>

          <div className="field">
            <label htmlFor="signin-email">{S.signIn.email}</label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || !supabaseConfigured}
            />
          </div>

          <div className="field">
            <label htmlFor="signin-password">{S.signIn.password}</label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || !supabaseConfigured}
            />
          </div>

          <div className="row">
            <button type="submit" className="primary" disabled={busy || !supabaseConfigured}>
              {S.signIn.signIn}
            </button>
            <button
              type="button"
              onClick={createAccount}
              disabled={busy || !supabaseConfigured}
            >
              {S.signIn.createAccount}
            </button>
          </div>

          {notice && <div className="banner ok">{notice}</div>}
        </div>
      </form>

      {(rejectedMessage ?? error) && (
        <div className="narrow banner error" role="alert">
          {rejectedMessage ?? error}
        </div>
      )}
    </main>
  );
}
