/**
 * @vitest-environment jsdom
 *
 * The generate form, driven the way a teacher drives it.
 *
 * What matters here is which choices the form hands over, because they decide
 * how the quiz scores. Timing above all: the speed bonus only applies to timed
 * questions, so a form that quietly defaulted to timed would turn every
 * generated quiz into a race nobody asked for.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenerateQuiz, type GenerateChoices } from './GenerateQuiz';
import { S } from '../strings';
import { QUESTION_TYPES } from '../lib/types';

function renderForm(overrides: Partial<Parameters<typeof GenerateQuiz>[0]> = {}) {
  const onGenerate = vi.fn<(choices: GenerateChoices) => void>();
  const onCancel = vi.fn();
  render(
    <GenerateQuiz
      busy={false}
      error={null}
      onCancel={onCancel}
      onGenerate={onGenerate}
      {...overrides}
    />,
  );
  return { onGenerate, onCancel };
}

describe('the generate form', () => {
  it('asks for a topic before it will do anything', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(S.generate.missingTopic);
  });

  it('will not generate with every type turned off', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Python loops');
    for (const type of QUESTION_TYPES) {
      await user.click(screen.getByRole('checkbox', { name: S.types[type] }));
    }
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(S.generate.missingTypes);
  });

  it('starts with every question type on', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Python loops');
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0][0].types).toEqual([...QUESTION_TYPES]);
  });

  it('asks for untimed questions unless the teacher says otherwise', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Python loops');
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    // Untimed is the forgiving classroom default, and it keeps the speed bonus
    // out of a quiz nobody asked to be a race.
    expect(onGenerate.mock.calls[0][0].timing).toEqual({ mode: 'wait' });
  });

  it('sends a time limit once the teacher asks for timed questions', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Python loops');
    await user.click(screen.getByRole('radio', { name: S.generate.timed }));
    await user.click(screen.getByRole('button', { name: '20' }));
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    expect(onGenerate.mock.calls[0][0].timing).toEqual({ mode: 'timed', seconds: 20 });
  });

  it('hides the seconds box while the quiz is untimed', () => {
    renderForm();
    expect(screen.queryByLabelText(S.generate.secondsLabel)).toBeNull();
  });

  it("sends the types in the app's own order, not the order they were ticked", async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Python loops');
    // Turn two off and back on, which would otherwise move them to the end.
    await user.click(screen.getByRole('checkbox', { name: S.types.mc_single }));
    await user.click(screen.getByRole('checkbox', { name: S.types.true_false }));
    await user.click(screen.getByRole('checkbox', { name: S.types.mc_single }));
    await user.click(screen.getByRole('checkbox', { name: S.types.true_false }));
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    // The same choice should always send the same request.
    expect(onGenerate.mock.calls[0][0].types).toEqual([...QUESTION_TYPES]);
  });

  it('passes the topic and count through as typed', async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderForm();

    await user.type(screen.getByLabelText(S.generate.topicLabel), 'Recursion for beginners');
    const count = screen.getByLabelText(S.generate.countLabel);
    await user.clear(count);
    await user.type(count, '4');
    await user.click(screen.getByRole('button', { name: S.generate.submit }));

    expect(onGenerate.mock.calls[0][0].topic).toBe('Recursion for beginners');
    expect(onGenerate.mock.calls[0][0].count).toBe(4);
  });

  it('shuts every control while it is working, so nothing is sent twice', () => {
    renderForm({ busy: true });
    expect(screen.getByRole('button', { name: S.generate.working })).toBeDisabled();
    expect(screen.getByLabelText(S.generate.topicLabel)).toBeDisabled();
    expect(screen.getByRole('button', { name: S.generate.cancel })).toBeDisabled();
  });

  it('shows a failure the caller hands it', () => {
    renderForm({ error: S.generate.unavailable });
    expect(screen.getByRole('alert')).toHaveTextContent(S.generate.unavailable);
  });
});
