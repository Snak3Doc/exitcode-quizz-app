/**
 * @vitest-environment jsdom
 *
 * What a results screen shows once the answers are in.
 *
 * The question these pin down is not "is the right answer marked" but "can
 * you still see what the question was offering". Showing the answer alone
 * reads fine in isolation and is nearly useless to a class going over a
 * question they have just argued about.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CorrectAnswerView } from './QuestionView';
import type { CorrectAnswer } from '../lib/types';

const options = [
  { id: 'o1', kind: 'text' as const, text: 'zero one two' },
  { id: 'o2', kind: 'text' as const, text: 'one two three' },
  { id: 'o3', kind: 'text' as const, text: 'an error' },
];

describe('the correct answer on a results screen', () => {
  it('shows the options that were wrong as well as the one that was right', () => {
    const correct: CorrectAnswer = {
      type: 'mc_single',
      options,
      optionIds: ['o2'],
    };
    const { container } = render(<CorrectAnswerView correct={correct} />);

    // All three, not just the answer.
    expect(screen.getByText('zero one two')).toBeInTheDocument();
    expect(screen.getByText('one two three')).toBeInTheDocument();
    expect(screen.getByText('an error')).toBeInTheDocument();

    const marked = container.querySelectorAll('.option.is-correct');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('one two three');
    expect(container.querySelectorAll('.option.is-dim')).toHaveLength(2);
  });

  it('marks every right option when several are right', () => {
    const correct: CorrectAnswer = {
      type: 'mc_multi',
      options,
      optionIds: ['o1', 'o3'],
    };
    const { container } = render(<CorrectAnswerView correct={correct} />);

    expect(container.querySelectorAll('.option.is-correct')).toHaveLength(2);
    expect(container.querySelectorAll('.option.is-dim')).toHaveLength(1);
  });

  it('shows both sides of a true or false question', () => {
    // Otherwise the screen says "True" with nothing to contrast it against,
    // which tells a student who answered False nothing at all.
    const correct: CorrectAnswer = { type: 'true_false', correct: true };
    const { container } = render(<CorrectAnswerView correct={correct} />);

    expect(container.querySelectorAll('.option')).toHaveLength(2);
    expect(container.querySelector('.option.is-correct')?.textContent).toContain('True');
    expect(container.querySelector('.option.is-dim')?.textContent).toContain('False');
  });
});
