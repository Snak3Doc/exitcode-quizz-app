/**
 * @vitest-environment jsdom
 *
 * A student's answer controls, driven the way a student drives them, and the
 * answer they produce fed straight into the real marking.
 */

import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerControls } from './AnswerControls';
import {
  isAnswerSubmittable,
  markAnswer,
  publicContent,
} from '../lib/game-logic';
import type { AnswerValue, Question, QuestionType } from '../lib/types';

function question(
  type: QuestionType,
  content: Record<string, unknown>,
  extra: Partial<Question> = {},
): Question {
  return {
    id: 'q1',
    quizId: 'z1',
    position: 0,
    type,
    prompt: 'Prompt?',
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content,
    generatedAt: null,
    ...extra,
  };
}

/**
 * Renders the controls with exactly what the host would have sent, so the test
 * can never accidentally show a student a correct answer.
 */
function renderFor(q: Question) {
  const sent = publicContent(q.type, q.content, () => 0.42);
  const latest: { answer: AnswerValue | undefined } = { answer: undefined };

  function Harness() {
    const [answer, setAnswer] = useState<AnswerValue | undefined>(undefined);
    return (
      <AnswerControls
        type={q.type}
        content={sent}
        answer={answer}
        onChange={(next) => {
          latest.answer = next;
          setAnswer(next);
        }}
      />
    );
  }

  render(<Harness />);
  return {
    sent,
    get answer() {
      return latest.answer;
    },
    canSubmit() {
      return isAnswerSubmittable(q.type, sent, latest.answer);
    },
    mark() {
      return markAnswer(q, latest.answer);
    },
  };
}

const mcQuestion = question('mc_single', {
  options: [
    { id: 'o1', kind: 'text', text: '0 2 4', correct: true },
    { id: 'o2', kind: 'text', text: '2 4 6', correct: false },
    { id: 'o3', kind: 'code', language: 'python', text: 'len(x)', correct: false },
  ],
});

describe('multiple choice, one answer', () => {
  it('shows lettered options and never the correct flag', () => {
    const h = renderFor(mcQuestion);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    for (const option of (h.sent as { options: unknown[] }).options) {
      expect(option).not.toHaveProperty('correct');
    }
  });

  it('cannot be submitted until something is chosen, then marks correctly', async () => {
    const user = userEvent.setup();
    const h = renderFor(mcQuestion);
    expect(h.canSubmit()).toBe(false);

    await user.click(screen.getAllByRole('radio')[0]);
    expect(h.canSubmit()).toBe(true);
    expect(h.mark().status).toBe('correct');
  });

  it('replaces the choice rather than adding to it', async () => {
    const user = userEvent.setup();
    const h = renderFor(mcQuestion);
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getAllByRole('radio')[1]);
    expect(h.answer).toBe('o2');
    expect(h.mark().status).toBe('wrong');
  });
});

describe('multiple choice, several answers', () => {
  const q = question('mc_multi', {
    options: [
      { id: 'a', kind: 'text', text: 'a', correct: true },
      { id: 'b', kind: 'text', text: 'b', correct: true },
      { id: 'c', kind: 'text', text: 'c', correct: false },
    ],
  });

  it('says to select all that apply and ticks several', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    expect(screen.getByText('Select all that apply.')).toBeInTheDocument();
    expect(h.canSubmit()).toBe(false);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getAllByRole('checkbox')[1]);
    expect(h.canSubmit()).toBe(true);
    expect(h.mark().fraction).toBe(1);
  });

  it('unticks again, and an empty set cannot be submitted', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(h.answer).toEqual([]);
    expect(h.canSubmit()).toBe(false);
  });

  it('loses marks for a wrong tick', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getAllByRole('checkbox')[2]);
    expect(h.mark().fraction).toBe(0);
  });
});

describe('true / false', () => {
  const q = question('true_false', { correct: false });

  it('offers two big buttons and marks the chosen one', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    expect(h.canSubmit()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'False' }));
    expect(h.answer).toBe(false);
    expect(h.canSubmit()).toBe(true);
    expect(h.mark().status).toBe('correct');
  });
});

describe('short text', () => {
  const q = question('short_text', { accepted: ['len'], caseSensitive: false });

  it('will not submit blank or whitespace, and marks forgivingly', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    const field = screen.getByLabelText('Type your answer');

    expect(h.canSubmit()).toBe(false);
    await user.type(field, '   ');
    expect(h.canSubmit()).toBe(false);

    await user.clear(field);
    await user.type(field, '  LEN ');
    expect(h.canSubmit()).toBe(true);
    expect(h.mark().status).toBe('correct');
  });

  it('never shows the student the accepted answers', () => {
    const h = renderFor(q);
    expect(h.sent).toEqual({});
    expect(screen.queryByText('len')).toBeNull();
  });
});

describe('fill in the blank', () => {
  const q = question('fill_blank', {
    language: 'python',
    snippet: 'for i in {{1}}(3):\n    {{2}}(i)',
    wordBank: ['range', 'print', 'len'],
    answers: { '1': 'range', '2': 'print' },
  });

  it('sends the snippet and bank but not the answers', () => {
    const h = renderFor(q);
    expect(h.sent).not.toHaveProperty('answers');
    expect(h.sent).toMatchObject({ wordBank: ['range', 'print', 'len'] });
  });

  it('needs every blank chosen before it can be submitted', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(h.canSubmit()).toBe(false);

    await user.selectOptions(screen.getByLabelText('Blank 1 answer'), 'range');
    expect(h.canSubmit()).toBe(false);

    await user.selectOptions(screen.getByLabelText('Blank 2 answer'), 'print');
    expect(h.canSubmit()).toBe(true);
    expect(h.mark().status).toBe('correct');
  });

  it('gives half marks for one right blank', async () => {
    const user = userEvent.setup();
    const h = renderFor(q);
    await user.selectOptions(screen.getByLabelText('Blank 1 answer'), 'range');
    await user.selectOptions(screen.getByLabelText('Blank 2 answer'), 'len');
    expect(h.mark().fraction).toBe(0.5);
    expect(h.mark().status).toBe('partial');
  });
});

describe('order the lines', () => {
  const q = question('order_lines', {
    language: 'python',
    lines: [
      { id: 'l1', text: 'def f(x):' },
      { id: 'l2', text: '    return x * 2' },
      { id: 'l3', text: 'print(f(3))' },
    ],
  });

  it('shows the lines shuffled, never in the correct order', () => {
    const h = renderFor(q);
    const shown = (h.sent as { lines: Array<{ id: string }> }).lines;
    expect(shown.map((l) => l.id).sort()).toEqual(['l1', 'l2', 'l3']);
    expect(shown.map((l) => l.id).join('')).not.toBe('l1l2l3');
  });

  it('can always be submitted, because the shuffled order is an answer', () => {
    const h = renderFor(q);
    expect(h.canSubmit()).toBe(true);
  });

  it('keeps indentation on screen', () => {
    renderFor(q);
    // No normalising: the leading spaces are the point of this test.
    const line = screen.getByText('    return x * 2', { normalizer: (text) => text });
    expect(line).toBeInTheDocument();
    expect(line).toHaveClass('line-text');
  });

  it('offers a drag handle for every line', () => {
    renderFor(q);
    expect(screen.getAllByRole('button', { name: /Drag the lines into order/ })).toHaveLength(
      3,
    );
  });
});
