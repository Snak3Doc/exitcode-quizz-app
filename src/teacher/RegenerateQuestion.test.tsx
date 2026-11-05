/**
 * @vitest-environment jsdom
 *
 * Asking for one question to be written again.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegenerateQuestion } from './RegenerateQuestion';
import { S } from '../strings';

function renderForm(overrides: Partial<Parameters<typeof RegenerateQuestion>[0]> = {}) {
  const onSubmit = vi.fn<(note: string) => void>();
  const onCancel = vi.fn();
  render(
    <RegenerateQuestion
      busy={false}
      error={null}
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

describe('rewriting a question', () => {
  it("passes the teacher's note through", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(S.editor.regenerateNoteLabel), 'Make it harder');
    await user.click(screen.getByRole('button', { name: S.editor.regenerateSubmit }));

    expect(onSubmit).toHaveBeenCalledWith('Make it harder');
  });

  it('will go ahead with no note at all', async () => {
    // Sometimes a plain reroll is all a teacher wants.
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: S.editor.regenerateSubmit }));

    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('says why a note is worth writing', () => {
    renderForm();
    // Without one you get a question as arbitrary as the one being rejected,
    // and the teacher has spent a request to find that out.
    expect(screen.getByText(S.editor.regenerateHint)).toBeInTheDocument();
  });

  it('shuts its controls while it is working', () => {
    renderForm({ busy: true });
    expect(screen.getByRole('button', { name: S.editor.regenerating })).toBeDisabled();
    expect(screen.getByLabelText(S.editor.regenerateNoteLabel)).toBeDisabled();
  });

  it('can be abandoned', async () => {
    const user = userEvent.setup();
    const { onCancel, onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: S.quizzes.cancel }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a failure the caller hands it', () => {
    renderForm({ error: S.generate.unavailable });
    expect(screen.getByRole('alert')).toHaveTextContent(S.generate.unavailable);
  });
});
