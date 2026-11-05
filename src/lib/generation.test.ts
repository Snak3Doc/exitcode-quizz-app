/**
 * Generated questions, from what the model returns to what gets stored.
 *
 * Two jobs here. One is the conversion itself, checked by feeding plausible
 * model output through it and into the real `checkQuestion()` — if a question
 * survives that, it can be hosted.
 *
 * The other is the drift guard. The Gemini schema is written out separately
 * from the app's own types because Gemini's dialect will not take a converted
 * Zod schema, so the two can wander apart. These tests fail when they do.
 */

import { describe, expect, it } from 'vitest';
import {
  normaliseBatch,
  normaliseContent,
  normaliseQuestion,
  type GeneratedQuestion,
} from './generation';
import { checkQuestion } from './schema';
import { CODE_LANGUAGES, QUESTION_TYPES } from './types';
import {
  MAX_ACCEPTED_ANSWERS,
  MAX_BLANKS,
  MAX_LINES,
  MAX_OPTIONS,
  MAX_WORD_BANK,
  MIN_LINES,
  MIN_OPTIONS,
  MIN_WORD_BANK,
} from './constants';
import {
  BOUNDS,
  CODE_LANGUAGE_VALUES,
  QUESTION_TYPE_VALUES,
  contentSchemaFor,
  questionSchemaFor,
} from '../../supabase/functions/generate-quiz/schema';

const untimed = { mode: 'wait' } as const;

describe('the Gemini schema has not drifted from the app', () => {
  it('offers exactly the question types the app has', () => {
    expect([...QUESTION_TYPE_VALUES]).toEqual([...QUESTION_TYPES]);
  });

  it('offers exactly the code languages highlight.js is set up for', () => {
    expect([...CODE_LANGUAGE_VALUES]).toEqual([...CODE_LANGUAGES]);
  });

  it('uses the same bounds the validation does', () => {
    expect(BOUNDS.minOptions).toBe(MIN_OPTIONS);
    expect(BOUNDS.maxOptions).toBe(MAX_OPTIONS);
    expect(BOUNDS.maxAccepted).toBe(MAX_ACCEPTED_ANSWERS);
    expect(BOUNDS.minWordBank).toBe(MIN_WORD_BANK);
    expect(BOUNDS.maxWordBank).toBe(MAX_WORD_BANK);
    expect(BOUNDS.maxBlanks).toBe(MAX_BLANKS);
    expect(BOUNDS.minLines).toBe(MIN_LINES);
    expect(BOUNDS.maxLines).toBe(MAX_LINES);
  });

  it('can build a schema for every type the app supports', () => {
    for (const type of QUESTION_TYPES) {
      expect(() => questionSchemaFor(type)).not.toThrow();
      expect(contentSchemaFor(type).type).toBe('OBJECT');
    }
  });

  it('refuses a type it does not know, rather than returning something empty', () => {
    expect(() => contentSchemaFor('essay')).toThrow(/essay/);
  });

  it('never asks the model for an id', () => {
    // Ids are minted here, not generated. See schema.ts for why.
    for (const type of QUESTION_TYPES) {
      expect(JSON.stringify(questionSchemaFor(type))).not.toMatch(/"id"/);
    }
  });

  it('leaves timing out, because the teacher chooses it', () => {
    for (const type of QUESTION_TYPES) {
      const json = JSON.stringify(questionSchemaFor(type));
      expect(json).not.toMatch(/timingMode|timeLimitSeconds/);
    }
  });

  /**
   * The real guard, and the one that earns its keep.
   *
   * Comparing enums and bounds does not catch a field being renamed, which is
   * the drift that actually happened while writing this: the schema asked for
   * `answer` where the app stores `correct`, and every check above passed.
   *
   * So: for each type, take content shaped the way the schema asks for it, run
   * it through the conversion, and hand the result to the real validator. If a
   * field name drifts on either side, one of these fails.
   */
  const schemaShaped: Record<string, unknown> = {
    mc_single: {
      options: [
        { kind: 'text', text: '8', correct: true },
        { kind: 'text', text: '6', correct: false },
      ],
    },
    mc_multi: {
      options: [
        { kind: 'text', text: 'append()', correct: true },
        { kind: 'text', text: 'push()', correct: false },
        { kind: 'text', text: 'pop()', correct: true },
      ],
    },
    true_false: { correct: true },
    short_text: { accepted: ['print()', 'print'], caseSensitive: false },
    fill_blank: {
      language: 'python',
      snippet: 'for i in {{1}}(5):\n    {{2}}(i)',
      wordBank: ['range', 'print', 'len', 'input'],
      answers: [
        { blank: 1, word: 'range' },
        { blank: 2, word: 'print' },
      ],
    },
    order_lines: {
      language: 'python',
      lines: ['a = [0, 1, 2]', 'for i in a:', '    print(i)'],
    },
  };

  it.each([...QUESTION_TYPES])(
    'converts schema-shaped %s content into something the validator accepts',
    (type) => {
      const { problems } = normaliseQuestion(
        type,
        { prompt: 'A question.', content: schemaShaped[type] },
        untimed,
      );
      expect(problems).toEqual([]);
    },
  );

  it('covers every question type with a fixture', () => {
    // Stops a new type being added without one, which would make the test
    // above silently skip it.
    expect(Object.keys(schemaShaped).sort()).toEqual([...QUESTION_TYPES].sort());
  });
});

describe('converting a generated question', () => {
  it('turns a multiple-choice question into one that can be hosted', () => {
    const { question, problems } = normaliseQuestion(
      'mc_single',
      {
        prompt: 'What does this print?',
        code: 'print(2 ** 3)',
        codeLanguage: 'python',
        explanation: '** is exponentiation.',
        content: {
          options: [
            { kind: 'text', text: '8', correct: true },
            { kind: 'text', text: '6', correct: false },
          ],
        },
      },
      untimed,
    );

    expect(problems).toEqual([]);
    expect(question.prompt).toBe('What does this print?');
    expect(question.codeLanguage).toBe('python');
    expect(question.timingMode).toBe('wait');
    expect(question.timeLimitSeconds).toBeNull();
  });

  it('gives every option its own id', () => {
    const content = normaliseContent('mc_multi', {
      options: [
        { kind: 'text', text: 'append()', correct: true },
        { kind: 'text', text: 'push()', correct: false },
      ],
    });
    const options = content.options as { id: string }[];
    expect(options).toHaveLength(2);
    expect(options[0].id).not.toBe(options[1].id);
    expect(options[0].id).not.toBe('');
  });

  it('rebuilds the fill-in-the-blank answer map from the list', () => {
    const content = normaliseContent('fill_blank', {
      language: 'python',
      snippet: 'for i in {{1}}(5):\n    {{2}}(i)',
      wordBank: ['range', 'print', 'len', 'input'],
      answers: [
        { blank: 1, word: 'range' },
        { blank: 2, word: 'print' },
      ],
    });
    expect(content.answers).toEqual({ '1': 'range', '2': 'print' });
  });

  it('keeps the order of the lines exactly as generated', () => {
    const content = normaliseContent('order_lines', {
      language: 'python',
      lines: ['a = [0, 1, 2]', 'for i in a:', '    print(i)'],
    });
    const lines = content.lines as { id: string; text: string }[];
    // The model is told to send them in the CORRECT order; the app shuffles
    // for students. Reordering here would make every answer wrong.
    expect(lines.map((l) => l.text)).toEqual([
      'a = [0, 1, 2]',
      'for i in a:',
      '    print(i)',
    ]);
    expect(lines[2].text).toBe('    print(i)');
  });

  it('applies the timing the teacher chose, not the model', () => {
    const { question } = normaliseQuestion(
      'true_false',
      { prompt: 'Python lists are ordered.', content: { correct: true } },
      { mode: 'timed', seconds: 20 },
    );
    expect(question.timingMode).toBe('timed');
    expect(question.timeLimitSeconds).toBe(20);
  });

  it('gives a code block a language, since the database demands both or neither', () => {
    const { question, problems } = normaliseQuestion(
      'true_false',
      {
        prompt: 'This prints 3.',
        code: 'print(3)',
        // The model left the language out.
        content: { correct: true },
      },
      untimed,
    );
    expect(question.codeLanguage).toBe('plaintext');
    expect(problems).toEqual([]);
  });

  it('drops a language when there is no code to go with it', () => {
    const { question } = normaliseQuestion(
      'true_false',
      { prompt: 'Tuples are immutable.', codeLanguage: 'python', content: { correct: true } },
      untimed,
    );
    expect(question.code).toBeNull();
    expect(question.codeLanguage).toBeNull();
  });
});

describe('catching what the model gets wrong', () => {
  it('reports a single-answer question with two correct options', () => {
    const { problems } = normaliseQuestion(
      'mc_single',
      {
        prompt: 'Which is a list method?',
        content: {
          options: [
            { kind: 'text', text: 'append()', correct: true },
            { kind: 'text', text: 'pop()', correct: true },
          ],
        },
      },
      untimed,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('reports a fill-in-the-blank whose numbering has a gap', () => {
    // {{1}} and {{3}} with no {{2}} — the kind of thing that looks right at a
    // glance and leaves a student staring at a blank with no answer.
    const { problems } = normaliseQuestion(
      'fill_blank',
      {
        prompt: 'Complete the loop.',
        content: {
          language: 'python',
          snippet: 'for i in {{1}}(5):\n    {{3}}(i)',
          wordBank: ['range', 'print', 'len'],
          answers: [
            { blank: 1, word: 'range' },
            { blank: 3, word: 'print' },
          ],
        },
      },
      untimed,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('reports a word bank that is missing one of its own answers', () => {
    const { problems } = normaliseQuestion(
      'fill_blank',
      {
        prompt: 'Complete the loop.',
        content: {
          language: 'python',
          snippet: 'for i in {{1}}(5):',
          wordBank: ['print', 'len'],
          answers: [{ blank: 1, word: 'range' }],
        },
      },
      untimed,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('reports an order-the-lines question with only one line', () => {
    const { problems } = normaliseQuestion(
      'order_lines',
      {
        prompt: 'Put these in order.',
        content: { language: 'python', lines: ['print(1)'] },
      },
      untimed,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('reports a question with no prompt', () => {
    const { problems } = normaliseQuestion(
      'true_false',
      { prompt: '   ', content: { correct: true } },
      untimed,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('survives content that is missing altogether', () => {
    const { problems } = normaliseQuestion('short_text', { prompt: 'Why?' }, untimed);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('cannot tell that order-the-lines came back shuffled', () => {
    // Worth pinning down, because it is the one failure nothing here catches.
    // These lines are in the wrong order, and the question is still valid --
    // it only shows up mid-lesson as students marked wrong for the right
    // answer. The guard is the teacher reading the editor, which labels this
    // answer "Lines are in the CORRECT order here."
    const { problems } = normaliseQuestion(
      'order_lines',
      {
        prompt: 'Order the lines so it prints 0, 1, 2',
        content: {
          language: 'python',
          lines: ['    print(i)', 'for i in a:', 'a = [0, 1, 2]'],
        },
      },
      untimed,
    );
    expect(problems).toEqual([]);
  });
});

describe('a whole batch', () => {
  const good: GeneratedQuestion = {
    prompt: 'Python lists are ordered.',
    content: { correct: true },
  };
  const bad: GeneratedQuestion = { prompt: '', content: {} };

  it('keeps the good questions and reports the rest', () => {
    const outcome = normaliseBatch(
      ['true_false', 'true_false', 'true_false'],
      [good, bad, good],
      untimed,
    );
    // Importing a file is all-or-nothing; generating is not. Throwing away two
    // good questions because one came back malformed would waste quota the
    // teacher cannot get back.
    expect(outcome.kept).toHaveLength(2);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0].number).toBe(2);
    expect(outcome.dropped[0].problems.length).toBeGreaterThan(0);
  });

  it('reports every question when the whole batch is unusable', () => {
    const outcome = normaliseBatch(['true_false', 'true_false'], [bad, bad], untimed);
    expect(outcome.kept).toEqual([]);
    expect(outcome.dropped).toHaveLength(2);
  });

  it('does not trust the model to return the number of questions asked for', () => {
    const outcome = normaliseBatch(['true_false'], [good, good], untimed);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(1);
  });

  it('produces questions the real validator is happy with', () => {
    const outcome = normaliseBatch(['true_false'], [good], untimed);
    expect(checkQuestion(outcome.kept[0])).toEqual([]);
  });
});
