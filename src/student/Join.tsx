/** The home page: a game code and a name. No account, no sign-in. SPEC 3.7. */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S } from '../strings';
import { isValidName, normaliseName, normaliseShareCode } from '../lib/game-logic';
import { MAX_NAME_LENGTH, SHARE_CODE_LENGTH } from '../lib/constants';
import { SUPABASE_SETUP_MESSAGE, supabaseConfigured } from '../lib/supabase';

/** Carried to /play/:code so the student does not type their name twice. */
export interface PendingJoin {
  name: string;
}

export function Join() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();

    const cleanCode = normaliseShareCode(code);
    if (cleanCode.length === 0) {
      setError(S.join.missingCode);
      return;
    }
    if (cleanCode.length !== SHARE_CODE_LENGTH) {
      setError(S.join.notFound);
      return;
    }

    const cleanName = normaliseName(name);
    if (cleanName === '') {
      setError(S.join.missingName);
      return;
    }
    if (!isValidName(cleanName)) {
      setError(S.join.badName);
      return;
    }

    setError(null);
    navigate(`/play/${cleanCode}`, { state: { name: cleanName } satisfies PendingJoin });
  }

  return (
    <main className="centre-page">
      <h1 className="app-mark">{S.app.name}</h1>

      {!supabaseConfigured && (
        <div className="narrow banner error">{SUPABASE_SETUP_MESSAGE}</div>
      )}

      <form className="narrow window" onSubmit={onSubmit}>
        <div className="title-bar">{S.join.joinGame}</div>
        <div className="body">
          <div className="field">
            <label htmlFor="join-code">{S.join.codeLabel}</label>
            <input
              id="join-code"
              type="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              value={code}
              placeholder={S.join.codePlaceholder}
              style={{ textTransform: 'uppercase', letterSpacing: '0.3em' }}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="join-name">{S.join.nameLabel}</label>
            <input
              id="join-name"
              type="text"
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              placeholder={S.join.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <button type="submit" className="primary" disabled={!supabaseConfigured}>
            {S.join.joinGame}
          </button>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>

      {/*
        Teachers reach their own screens from here. Only approved emails can
        read or write anything, so showing the way in costs nothing.
      */}
      <Link className="teacher-link" to="/teacher">
        {S.join.teacherSignIn}
      </Link>
    </main>
  );
}
