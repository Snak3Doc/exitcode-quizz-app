import { describe, expect, it } from 'vitest';
import { checkQuestion, findBlanks, validateQuizForHosting } from './schema';
import type { QuestionType } from './types';

function q(
  type: QuestionType,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    type,
    prompt: 'Prompt?',
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content,
    ...extra,
  } as Parameters<typeof checkQuestion>[0];
}

const goodMcSingle = {
  options: [
    { id: 'o1', kind: 'text', text: 'right', correct: true },
    { id: 'o2', kind: 'text', text: 'wrong', correct: false },
  ],
};

describe('findBlanks', () => {
  it('finds every blank marker in order', () => {
    expect(findBlanks('for i in {{1}}(3):\n    {{2}}(i)')).toEqual([1, 2]);
    expect(findBlanks('no blanks here')).toEqual([]);
    expect(findBlanks('{{2}} then {{1}}')).toEqual([2, 1]);
    expect(findBlanks('{{1}} and {{1}}')).toEqual([1, 1]);
  });
});

describe('checkQuestion: the parts every question has', () => {
  it('passes a complete question', () => {
    expect(checkQuestion(q('mc_single', goodMcSingle))).toEqual([]);
  });

  it('catches empty question text', () => {
    expect(checkQuestion(q('mc_single', goodMcSingle, { prompt: '   ' }))).toContain(
      'the question text is empty',
    );
  });

  it('catches an empty code block and a missing language', () => {
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { code: '  ', codeLanguage: 'python' })),
    ).toContain('the code block is empty');
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { code: 'x = 1', codeLanguage: null })),
    ).toContain('the code block has no language');
  });

  it('accepts a question with no code block at all', () => {
    expect(checkQuestion(q('mc_single', goodMcSingle, { code: null }))).toEqual([]);
  });

  it('checks the time limit on timed questions only', () => {
    const message =
      'a timed question needs a whole number of seconds from 5 to 300';
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { timingMode: 'timed', timeLimitSeconds: 4 })),
    ).toContain(message);
    expect(
      checkQuestion(
        q('mc_single', goodMcSingle, { timingMode: 'timed', timeLimitSeconds: 301 }),
      ),
    ).toContain(message);
    expect(
      checkQuestion(
        q('mc_single', goodMcSingle, { timingMode: 'timed', timeLimitSeconds: 30.5 }),
      ),
    ).toContain(message);
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { timingMode: 'timed', timeLimitSeconds: null })),
    ).toContain(message);
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { timingMode: 'timed', timeLimitSeconds: 5 })),
    ).toEqual([]);
    // Untimed questions ignore a stray seconds value.
    expect(checkQuestion(q('mc_single', goodMcSingle, { timeLimitSeconds: 1 }))).toEqual([]);
  });

  it('catches overlong text', () => {
    expect(checkQuestion(q('mc_single', goodMcSingle, { prompt: 'a'.repeat(2001) }))).toContain(
      'the question text is longer than 2000 characters',
    );
    expect(
      checkQuestion(
        q('mc_single', goodMcSingle, {
          code: 'a'.repeat(4001),
          codeLanguage: 'python',
        }),
      ),
    ).toContain('the code block is longer than 4000 characters');
    expect(
      checkQuestion(q('mc_single', goodMcSingle, { explanation: 'a'.repeat(2001) })),
    ).toContain('the explanation is longer than 2000 characters');
  });
});

describe('checkQuestion: multiple choice', () => {
  it('needs 2 to 6 options', () => {
    expect(
      checkQuestion(q('mc_single', { options: [goodMcSingle.options[0]] })),
    ).toContain('needs at least 2 options');
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `o${i}`,
      kind: 'text',
      text: `opt ${i}`,
      correct: i === 0,
    }));
    expect(checkQuestion(q('mc_single', { options: seven }))).toContain(
      'can have at most 6 options',
    );
  });

  it('needs exactly one correct answer for mc_single', () => {
    expect(
      checkQuestion(
        q('mc_single', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: false },
            { id: 'o2', kind: 'text', text: 'b', correct: false },
          ],
        }),
      ),
    ).toContain('missing correct answer');
    expect(
      checkQuestion(
        q('mc_single', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: true },
            { id: 'o2', kind: 'text', text: 'b', correct: true },
          ],
        }),
      ),
    ).toContain('needs exactly one correct answer');
  });

  it('needs at least one correct answer for mc_multi, and allows several', () => {
    expect(
      checkQuestion(
        q('mc_multi', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: true },
            { id: 'o2', kind: 'text', text: 'b', correct: true },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      checkQuestion(
        q('mc_multi', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: false },
            { id: 'o2', kind: 'text', text: 'b', correct: false },
          ],
        }),
      ),
    ).toContain('missing correct answer');
  });

  it('catches an empty option and a code option with no language', () => {
    expect(
      checkQuestion(
        q('mc_single', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: true },
            { id: 'o2', kind: 'text', text: '   ', correct: false },
          ],
        }),
      ),
    ).toContain('an option is empty');
    expect(
      checkQuestion(
        q('mc_single', {
          options: [
            { id: 'o1', kind: 'code', text: 'len(x)', correct: true },
            { id: 'o2', kind: 'text', text: 'b', correct: false },
          ],
        }),
      ),
    ).toContain('a code option has no language');
  });

  it('catches repeated option ids', () => {
    expect(
      checkQuestion(
        q('mc_single', {
          options: [
            { id: 'same', kind: 'text', text: 'a', correct: true },
            { id: 'same', kind: 'text', text: 'b', correct: false },
          ],
        }),
      ),
    ).toContain('two options share an id');
  });
});

describe('checkQuestion: true/false and short text', () => {
  it('true_false needs the correct side picked', () => {
    expect(checkQuestion(q('true_false', { correct: true }))).toEqual([]);
    expect(checkQuestion(q('true_false', { correct: false }))).toEqual([]);
    expect(checkQuestion(q('true_false', {}))).toContain('missing correct answer');
  });

  it('short_text needs at least one non-empty accepted answer', () => {
    expect(
      checkQuestion(q('short_text', { accepted: ['len'], caseSensitive: false })),
    ).toEqual([]);
    expect(
      checkQuestion(q('short_text', { accepted: [], caseSensitive: false })),
    ).toContain('needs at least one accepted answer');
    expect(
      checkQuestion(q('short_text', { accepted: ['  '], caseSensitive: false })),
    ).toContain('needs at least one accepted answer');
    expect(
      checkQuestion(
        q('short_text', { accepted: ['a'.repeat(101)], caseSensitive: false }),
      ),
    ).toContain('an accepted answer is longer than 100 characters');
    expect(
      checkQuestion(
        q('short_text', {
          accepted: Array.from({ length: 11 }, (_, i) => `a${i}`),
          caseSensitive: false,
        }),
      ),
    ).toContain('can have at most 10 accepted answers');
  });
});

describe('checkQuestion: fill in the blank', () => {
  const good = {
    language: 'python',
    snippet: 'for i in {{1}}(3):\n    {{2}}(i)',
    wordBank: ['range', 'print', 'len'],
    answers: { '1': 'range', '2': 'print' },
  };

  it('passes a complete one', () => {
    expect(checkQuestion(q('fill_blank', good))).toEqual([]);
  });

  it('allows the same word to answer two blanks', () => {
    expect(
      checkQuestion(
        q('fill_blank', {
          ...good,
          snippet: '{{1}}(a)\n{{2}}(b)',
          answers: { '1': 'print', '2': 'print' },
        }),
      ),
    ).toEqual([]);
  });

  it('catches an empty snippet and a snippet with no blanks', () => {
    expect(checkQuestion(q('fill_blank', { ...good, snippet: '   ' }))).toContain(
      'the snippet is empty',
    );
    expect(checkQuestion(q('fill_blank', { ...good, snippet: 'print(1)' }))).toContain(
      'the snippet has no blanks (write {{1}}, {{2}} and so on)',
    );
  });

  it('catches gaps, repeats and too many blanks', () => {
    expect(
      checkQuestion(
        q('fill_blank', {
          ...good,
          snippet: '{{1}} {{3}}',
          answers: { '1': 'range', '3': 'print' },
        }),
      ),
    ).toContain('blanks must be numbered 1 to 2 with no gaps');
    expect(
      checkQuestion(
        q('fill_blank', { ...good, snippet: '{{1}} {{1}}', answers: { '1': 'range' } }),
      ),
    ).toContain('blank 1 appears more than once');
    const sevenBlanks = Array.from({ length: 7 }, (_, i) => `{{${i + 1}}}`).join(' ');
    const sevenAnswers = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [String(i + 1), 'range']),
    );
    expect(
      checkQuestion(q('fill_blank', { ...good, snippet: sevenBlanks, answers: sevenAnswers })),
    ).toContain('has more than 6 blanks');
  });

  it('checks the word bank', () => {
    expect(
      checkQuestion(q('fill_blank', { ...good, wordBank: ['range'] })),
    ).toContain('the word bank needs 2 to 12 words');
    expect(
      checkQuestion(q('fill_blank', { ...good, wordBank: ['range', 'print', 'range'] })),
    ).toContain('the word bank has a repeated word');
    expect(
      checkQuestion(
        q('fill_blank', { ...good, wordBank: ['range', 'print', 'a'.repeat(31)] }),
      ),
    ).toContain('a word in the bank is longer than 30 characters');
  });

  it('checks every blank has an answer that is in the bank', () => {
    expect(
      checkQuestion(q('fill_blank', { ...good, answers: { '1': 'range' } })),
    ).toContain('blank 2 has no correct word');
    expect(
      checkQuestion(
        q('fill_blank', { ...good, answers: { '1': 'range', '2': 'missing' } }),
      ),
    ).toContain('the answer for blank 2 is not in the word bank');
  });
});

describe('checkQuestion: order the lines', () => {
  const good = {
    language: 'python',
    lines: [
      { id: 'l1', text: 'def f(x):' },
      { id: 'l2', text: '    return x * 2' },
    ],
  };

  it('passes a complete one and keeps indentation', () => {
    expect(checkQuestion(q('order_lines', good))).toEqual([]);
  });

  it('needs 2 to 12 non-empty lines', () => {
    expect(checkQuestion(q('order_lines', { ...good, lines: [good.lines[0]] }))).toContain(
      'needs at least 2 lines',
    );
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ id: `l${i}`, text: `x${i}` }));
    expect(checkQuestion(q('order_lines', { ...good, lines: thirteen }))).toContain(
      'can have at most 12 lines',
    );
    expect(
      checkQuestion(
        q('order_lines', { ...good, lines: [good.lines[0], { id: 'l2', text: '   ' }] }),
      ),
    ).toContain('a line is empty');
    expect(
      checkQuestion(
        q('order_lines', {
          ...good,
          lines: [good.lines[0], { id: 'l2', text: 'a'.repeat(121) }],
        }),
      ),
    ).toContain('a line is longer than 120 characters');
  });
});

describe('validateQuizForHosting', () => {
  it('passes a complete quiz', () => {
    expect(
      validateQuizForHosting({
        title: 'Python basics',
        questions: [q('mc_single', goodMcSingle), q('true_false', { correct: false })],
      }),
    ).toEqual([]);
  });

  it('needs a title and at least one question', () => {
    expect(validateQuizForHosting({ title: '  ', questions: [] })).toEqual([
      { questionNumber: 0, message: 'The quiz needs a title.' },
      { questionNumber: 0, message: 'The quiz needs at least one question.' },
    ]);
  });

  it('numbers the problems from one, as the teacher sees them', () => {
    const problems = validateQuizForHosting({
      title: 'Mixed',
      questions: [
        q('mc_single', goodMcSingle),
        q('mc_single', {
          options: [
            { id: 'o1', kind: 'text', text: 'a', correct: false },
            { id: 'o2', kind: 'text', text: 'b', correct: false },
          ],
        }),
        q('short_text', { accepted: [], caseSensitive: false }),
      ],
    });
    expect(problems).toEqual([
      { questionNumber: 2, message: 'missing correct answer' },
      { questionNumber: 3, message: 'needs at least one accepted answer' },
    ]);
  });

  it('does not repeat the same problem twice for one question', () => {
    const problems = checkQuestion(
      q('order_lines', {
        language: 'python',
        lines: [
          { id: 'l1', text: '  ' },
          { id: 'l2', text: '  ' },
        ],
      }),
    );
    expect(problems.filter((p) => p === 'a line is empty')).toHaveLength(1);
  });
});
