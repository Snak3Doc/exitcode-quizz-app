/**
 * Asking for one question to be written again.
 *
 * The note is the whole point. A bare "give me another one" gets something
 * just as arbitrary as the question the teacher already rejected; "make it
 * harder" or "use a list instead of a loop" gets what they actually wanted.
 * It is optional, because sometimes a reroll genuinely is all you want.
 */

import { useState, type FormEvent } from 'react';
import { S } from '../strings';

export function RegenerateQuestion({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(note);
  }

  return (
    <form className="window" onSubmit={submit}>
      <div className="title-bar">{S.editor.regenerateHeading}</div>
      <div className="body">
        <div className="field">
          <label htmlFor="regenerate-note">{S.editor.regenerateNoteLabel}</label>
          <input
            id="regenerate-note"
            type="text"
            autoFocus
            disabled={busy}
            value={note}
            placeholder={S.editor.regenerateNotePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="hint">{S.editor.regenerateHint}</p>
        </div>

        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? S.editor.regenerating : S.editor.regenerateSubmit}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            {S.quizzes.cancel}
          </button>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
