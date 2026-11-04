/**
 * @vitest-environment jsdom
 *
 * The answer editors are where a teacher's work is most easily lost, so each
 * one is driven the way a teacher drives it.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerEditor } from './AnswerEditors';
import { QuestionForm } from './QuestionForm';
import { defaultContent } from '../lib/quizzes';
import { checkQuestion } from '../lib/schema';
import type { Question, QuestionType } from '../lib/types';

/** Renders an editor that keeps its own state, and exposes the latest content. */
function renderEditor(type: QuestionType, initial?: Record<string, unknown>) {
  const latest: { content: Record<string, unknown> } = {
    content: initial ?? defaultContent(type),
  };

  function Harness() {
    const [content, setContent] = useState(latest.content);
    return (
      <AnswerEditor
        type={type}
        content={content}
        onChange={(next) => {
          latest.content = next;
          setContent(next);
        }}
      />
    );
  }

  render(<Harness />);
  return latest;
}

function isReady(type: QuestionType, content: Record<string, unknown>): boolean {
  return (
    checkQuestion({
      type,
      prompt: 'Prompt?',
      code: null,
      codeLanguage: null,
      timingMode: 'wait',
      timeLimitSeconds: null,
      explanation: null,
      content,
    }).length === 0
  );
}

describe('multiple choice, one answer', () => {
  it('starts with two empty options and no correct answer', () => {
    const latest = renderEditor('mc_single');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(isReady('mc_single', latest.content)).toBe(false);
  });

  it('can be filled in until it is ready to host', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('mc_single');

    await user.type(screen.getByLabelText('Option A text'), '0 2 4');
    await user.type(screen.getByLabelText('Option B text'), '2 4 6');
    await user.click(screen.getByLabelText('Option A is correct'));

    expect(isReady('mc_single', latest.content)).toBe(true);
  });

  it('only ever has one correct answer', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('mc_single');

    await user.click(screen.getByLabelText('Option A is correct'));
    await user.click(screen.getByLabelText('Option B is correct'));

    const options = latest.content.options as Array<{ correct: boolean }>;
    expect(options.map((o) => o.correct)).toEqual([false, true]);
  });

  it('adds options up to six and removes them down to two', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('mc_single');
    const add = screen.getByRole('button', { name: '+ Add option' });

    for (let i = 0; i < 4; i += 1) await user.click(add);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(add).toBeDisabled();

    const removes = screen.getAllByTitle('Remove option');
    await user.click(removes[5]);
    expect((latest.content.options as unknown[]).length).toBe(5);

    // Down at two, removing is no longer offered.
    for (const button of screen.getAllByTitle('Remove option').slice(0, 3)) {
      await user.click(button);
    }
    expect((latest.content.options as unknown[]).length).toBe(2);
    for (const button of screen.getAllByTitle('Remove option')) {
      expect(button).toBeDisabled();
    }
  });

  it('switches an option to a code block with its own language', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('mc_single');

    await user.selectOptions(screen.getAllByLabelText('Option kind')[0], 'code');
    await user.type(screen.getByLabelText('Option A code'), 'len(items)');

    const first = (latest.content.options as Array<Record<string, unknown>>)[0];
    expect(first.kind).toBe('code');
    expect(first.language).toBe('python');
    expect(first.text).toBe('len(items)');
  });
});

describe('multiple choice, several answers', () => {
  it('uses tick boxes and keeps every tick', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('mc_multi');

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await user.type(screen.getByLabelText('Option A text'), 'a');
    await user.type(screen.getByLabelText('Option B text'), 'b');
    await user.click(screen.getByLabelText('Option A is correct'));
    await user.click(screen.getByLabelText('Option B is correct'));

    const options = latest.content.options as Array<{ correct: boolean }>;
    expect(options.map((o) => o.correct)).toEqual([true, true]);
    expect(isReady('mc_multi', latest.content)).toBe(true);
  });
});

describe('true / false', () => {
  it('defaults to True and can be switched to False', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('true_false');
    expect(latest.content).toEqual({ correct: true });
    expect(isReady('true_false', latest.content)).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'False' }));
    expect(latest.content).toEqual({ correct: false });
  });
});

describe('short text', () => {
  it('collects accepted answers and the case-sensitive choice', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('short_text');

    expect(isReady('short_text', latest.content)).toBe(false);
    await user.type(screen.getByLabelText('Accepted'), 'len');
    expect(isReady('short_text', latest.content)).toBe(true);

    await user.click(screen.getByRole('button', { name: '+ Add accepted answer' }));
    const fields = screen.getAllByLabelText('Accepted');
    await user.type(fields[1], 'len()');
    expect(latest.content.accepted).toEqual(['len', 'len()']);

    await user.click(screen.getByRole('checkbox', { name: 'Case-sensitive' }));
    expect(latest.content.caseSensitive).toBe(true);
  });

  it('never lets the last accepted answer be removed', () => {
    renderEditor('short_text');
    expect(screen.getByTitle('Remove accepted answer')).toBeDisabled();
  });
});

describe('fill in the blank', () => {
  it('shows a dropdown per blank once the snippet has blanks', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('fill_blank');

    expect(screen.queryByLabelText('Blank 1 answer')).toBeNull();

    // Pasted, not typed: userEvent reads "{{" as an escape sequence.
    await user.click(screen.getByLabelText('Code with blanks'));
    await user.paste('for i in {{1}}(3):\n    {{2}}(i)');
    expect(screen.getByLabelText('Blank 1 answer')).toBeInTheDocument();
    expect(screen.getByLabelText('Blank 2 answer')).toBeInTheDocument();

    const wordField = screen.getByLabelText('New word');
    for (const word of ['range', 'print']) {
      await user.clear(wordField);
      await user.type(wordField, word);
      await user.click(screen.getByRole('button', { name: '+ Add word' }));
    }
    expect(latest.content.wordBank).toEqual(['range', 'print']);

    await user.selectOptions(screen.getByLabelText('Blank 1 answer'), 'range');
    await user.selectOptions(screen.getByLabelText('Blank 2 answer'), 'print');

    expect(latest.content.answers).toEqual({ '1': 'range', '2': 'print' });
    expect(isReady('fill_blank', latest.content)).toBe(true);
  });

  it('will not add the same word twice', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('fill_blank');
    const wordField = screen.getByLabelText('New word');

    await user.type(wordField, 'range');
    await user.click(screen.getByRole('button', { name: '+ Add word' }));
    await user.type(wordField, 'range');
    await user.click(screen.getByRole('button', { name: '+ Add word' }));

    expect(latest.content.wordBank).toEqual(['range']);
  });

  it('clears any blank that pointed at a removed word', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('fill_blank', {
      language: 'python',
      snippet: '{{1}}(3)',
      wordBank: ['range', 'print'],
      answers: { '1': 'range' },
    });

    await user.click(screen.getAllByTitle('Remove word')[0]);

    expect(latest.content.wordBank).toEqual(['print']);
    expect(latest.content.answers).toEqual({});
  });
});

describe('order the lines', () => {
  it('collects lines in the correct order, keeping indentation', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('order_lines');

    await user.type(screen.getByLabelText('Line 1'), 'def f(x):');
    await user.type(screen.getByLabelText('Line 2'), '    return x * 2');

    const lines = latest.content.lines as Array<{ text: string }>;
    expect(lines.map((l) => l.text)).toEqual(['def f(x):', '    return x * 2']);
    expect(isReady('order_lines', latest.content)).toBe(true);
  });

  it('adds up to twelve lines and keeps at least two', async () => {
    const user = userEvent.setup();
    const latest = renderEditor('order_lines');
    const add = screen.getByRole('button', { name: '+ Add line' });

    for (let i = 0; i < 10; i += 1) await user.click(add);
    expect((latest.content.lines as unknown[]).length).toBe(12);
    expect(add).toBeDisabled();

    for (const button of screen.getAllByTitle('Remove line')) {
      if (!(button as HTMLButtonElement).disabled) await user.click(button);
    }
    expect((latest.content.lines as unknown[]).length).toBe(2);
  });
});

// ---------- the form around the answer area ----------

function renderForm(initial: Partial<Question> = {}) {
  const base: Question = {
    id: 'q1',
    quizId: 'z1',
    position: 0,
    type: 'mc_single',
    prompt: '',
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content: defaultContent(initial.type ?? 'mc_single'),
    ...initial,
  };
  const latest = { question: base };

  function Harness() {
    const [question, setQuestion] = useState(base);
    return (
      <QuestionForm
        question={question}
        onChange={(next) => {
          latest.question = next;
          setQuestion(next);
        }}
      />
    );
  }

  render(<Harness />);
  return latest;
}

describe('question form', () => {
  it('shows the seconds box only for timed questions', async () => {
    const user = userEvent.setup();
    const latest = renderForm();

    expect(screen.queryByLabelText('Seconds')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Timed' }));
    expect(screen.getByLabelText('Seconds')).toHaveValue(30);
    expect(latest.question.timeLimitSeconds).toBe(30);

    await user.click(screen.getByRole('button', { name: '120' }));
    expect(latest.question.timeLimitSeconds).toBe(120);

    await user.click(screen.getByRole('radio', { name: 'Wait for everyone' }));
    expect(screen.queryByLabelText('Seconds')).toBeNull();
    expect(latest.question.timeLimitSeconds).toBeNull();
  });

  it('adds and removes the optional code block', async () => {
    const user = userEvent.setup();
    const latest = renderForm();

    await user.click(screen.getByRole('button', { name: '+ Add code block' }));
    await user.type(screen.getByLabelText('Optional code block'), 'print(1)');
    expect(latest.question.code).toBe('print(1)');
    expect(latest.question.codeLanguage).toBe('python');

    await user.click(screen.getByRole('button', { name: 'Remove code block' }));
    expect(latest.question.code).toBeNull();
    expect(latest.question.codeLanguage).toBeNull();
  });

  it('asks before clearing answers when the type changes, and keeps them on cancel', async () => {
    const user = userEvent.setup();
    const latest = renderForm({
      type: 'short_text',
      content: { accepted: ['len'], caseSensitive: false },
    });

    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.selectOptions(screen.getByLabelText('Type'), 'true_false');
    expect(confirmed).toHaveBeenCalled();
    expect(latest.question.type).toBe('short_text');
    expect(latest.question.content).toEqual({ accepted: ['len'], caseSensitive: false });

    confirmed.mockReturnValue(true);
    await user.selectOptions(screen.getByLabelText('Type'), 'true_false');
    expect(latest.question.type).toBe('true_false');
    expect(latest.question.content).toEqual({ correct: true });
    confirmed.mockRestore();
  });

  it('does not ask when there is nothing to lose', async () => {
    const user = userEvent.setup();
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const latest = renderForm({ type: 'mc_single' });

    await user.selectOptions(screen.getByLabelText('Type'), 'order_lines');
    expect(confirmed).not.toHaveBeenCalled();
    expect(latest.question.type).toBe('order_lines');
    confirmed.mockRestore();
  });

  it('stores an empty explanation as nothing at all', async () => {
    const user = userEvent.setup();
    const latest = renderForm();
    const field = screen.getByLabelText('Explanation (optional)');

    await user.type(field, 'Because.');
    expect(latest.question.explanation).toBe('Because.');

    await user.clear(field);
    expect(latest.question.explanation).toBeNull();
  });

  it('letters the options A, B, C for the teacher too', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: '+ Add option' }));
    const answerArea = screen.getByText('Answer').closest('.window') as HTMLElement;
    const letters = within(answerArea)
      .getAllByText(/^[A-F]$/)
      .map((node) => node.textContent);
    expect(letters).toEqual(['A', 'B', 'C']);
  });
});
