import { describe, expect, it } from 'vitest';
import {
  basePoints,
  buildLeaderboard,
  correctAnswerFor,
  generateShareCode,
  isAnswerSubmittable,
  isNameTaken,
  isValidName,
  isWellFormedShareCode,
  markAnswer,
  matchesShortText,
  normaliseName,
  normaliseShareCode,
  normaliseShortText,
  optionLetter,
  ordinal,
  publicContent,
  scoreAnswer,
  shuffleLines,
  speedBonus,
  toPublicQuestion,
} from './game-logic';
import { SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH } from './constants';
import type { Question, QuestionType } from './types';

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
    ...extra,
  };
}

const mcContent = {
  options: [
    { id: 'o1', kind: 'text', text: 'right', correct: true },
    { id: 'o2', kind: 'text', text: 'wrong', correct: false },
    { id: 'o3', kind: 'code', language: 'python', text: 'len(x)', correct: false },
  ],
};

// ---------- share codes ----------

describe('share codes', () => {
  it('is six characters from the safe alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      for (const char of code) expect(SHARE_CODE_ALPHABET).toContain(char);
    }
  });

  it('leaves out the characters that are easy to misread', () => {
    for (const char of ['I', 'L', 'O', '0', '1']) {
      expect(SHARE_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('rejects bytes outside the unbiased range instead of folding them in', () => {
    // 255 is above the rejection limit for a 31-character alphabet, so these
    // bytes are skipped and the generator asks for more.
    const supply = [255, 255, 255, 255, 255, 255, 0, 1, 2, 3, 4, 5];
    let at = 0;
    const code = generateShareCode((n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = supply[at++ % supply.length];
      return bytes;
    });
    expect(code).toBe('ABCDEF');
  });

  it('normalises what a student types', () => {
    expect(normaliseShareCode(' k7m 2qx ')).toBe('K7M2QX');
    expect(isWellFormedShareCode('k7m2qx')).toBe(true);
    expect(isWellFormedShareCode('K7M2Q')).toBe(false);
    expect(isWellFormedShareCode('K7M2QI')).toBe(false);
  });
});

// ---------- names ----------

describe('student names', () => {
  it('trims, collapses spaces and normalises', () => {
    expect(normaliseName('  Sam   Lee ')).toBe('Sam Lee');
    // NFC: "e" + combining acute becomes the single character "é".
    expect(normaliseName('Mé')).toBe('Mé');
  });

  it('accepts Vietnamese names and the allowed punctuation', () => {
    for (const name of ['Nguyễn Linh', "O'Brien", 'Mai-Anh', 'J_7', 'Yes!', 'Đức']) {
      expect(isValidName(name), name).toBe(true);
    }
  });

  it('rejects empty, overlong and disallowed characters', () => {
    for (const name of ['', '   ', 'a'.repeat(21), 'Sam<script>', 'a@b', 'a#b', 'a/b']) {
      expect(isValidName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('compares taken names without case or spacing differences', () => {
    const players = [{ id: 'p1', name: 'Sam Lee' }];
    expect(isNameTaken('sam   lee', players)).toBe(true);
    expect(isNameTaken('SAM LEE', players)).toBe(true);
    expect(isNameTaken('Samantha', players)).toBe(false);
  });
});

// ---------- short text ----------

describe('short text matching', () => {
  it('ignores case and extra spaces by default', () => {
    expect(normaliseShortText('  LEN   ( )  ', false)).toBe('len ( )');
    expect(matchesShortText(' Len ', ['len'], false)).toBe(true);
    expect(matchesShortText('LEN', ['len'], false)).toBe(true);
  });

  it('respects case when the teacher asks for it', () => {
    expect(matchesShortText('LEN', ['len'], true)).toBe(false);
    expect(matchesShortText('len', ['len'], true)).toBe(true);
  });

  it('matches any of the accepted answers and ignores blank ones', () => {
    expect(matchesShortText('len()', ['len', 'len()'], false)).toBe(true);
    expect(matchesShortText('', ['', 'len'], false)).toBe(false);
    expect(matchesShortText('nope', ['len'], false)).toBe(false);
  });
});

// ---------- marking ----------

describe('marking', () => {
  it('no answer always scores zero', () => {
    expect(markAnswer(question('mc_single', mcContent), undefined)).toEqual({
      fraction: 0,
      status: 'none',
    });
  });

  it('mc_single is all or nothing', () => {
    const q = question('mc_single', mcContent);
    expect(markAnswer(q, 'o1')).toEqual({ fraction: 1, status: 'correct' });
    expect(markAnswer(q, 'o2')).toEqual({ fraction: 0, status: 'wrong' });
    expect(markAnswer(q, 'nope')).toEqual({ fraction: 0, status: 'wrong' });
    expect(markAnswer(q, ['o1'])).toEqual({ fraction: 0, status: 'wrong' });
  });

  it('mc_multi gives partial credit and subtracts wrong ticks', () => {
    const q = question('mc_multi', {
      options: [
        { id: 'a', kind: 'text', text: 'a', correct: true },
        { id: 'b', kind: 'text', text: 'b', correct: true },
        { id: 'c', kind: 'text', text: 'c', correct: false },
        { id: 'd', kind: 'text', text: 'd', correct: false },
      ],
    });
    expect(markAnswer(q, ['a', 'b']).fraction).toBe(1);
    expect(markAnswer(q, ['a']).fraction).toBe(0.5);
    expect(markAnswer(q, ['a', 'c']).fraction).toBe(0);
    expect(markAnswer(q, ['a', 'b', 'c']).fraction).toBe(0.5);
    // Ticking everything must not pay.
    expect(markAnswer(q, ['a', 'b', 'c', 'd']).fraction).toBe(0);
    expect(markAnswer(q, ['c', 'd']).fraction).toBe(0);
    expect(markAnswer(q, []).fraction).toBe(0);
    expect(markAnswer(q, ['a']).status).toBe('partial');
  });

  it('true_false needs a boolean', () => {
    const q = question('true_false', { correct: true });
    expect(markAnswer(q, true).fraction).toBe(1);
    expect(markAnswer(q, false).fraction).toBe(0);
    expect(markAnswer(q, 'true').fraction).toBe(0);
  });

  it('short_text uses forgiving matching', () => {
    const q = question('short_text', { accepted: ['len', 'len()'], caseSensitive: false });
    expect(markAnswer(q, ' LEN ').fraction).toBe(1);
    expect(markAnswer(q, 'size').fraction).toBe(0);
  });

  it('fill_blank scores each blank, wrong blanks subtract nothing', () => {
    const q = question('fill_blank', {
      language: 'python',
      snippet: 'for i in {{1}}(3):\n    {{2}}(i)',
      wordBank: ['range', 'print', 'len'],
      answers: { '1': 'range', '2': 'print' },
    });
    expect(markAnswer(q, { '1': 'range', '2': 'print' }).fraction).toBe(1);
    expect(markAnswer(q, { '1': 'range', '2': 'len' }).fraction).toBe(0.5);
    expect(markAnswer(q, { '1': 'len', '2': 'len' }).fraction).toBe(0);
    expect(markAnswer(q, { '1': 'range' }).fraction).toBe(0.5);
    expect(markAnswer(q, 'range').fraction).toBe(0);
  });

  it('order_lines scores each position and treats identical lines as interchangeable', () => {
    const q = question('order_lines', {
      language: 'python',
      lines: [
        { id: 'l1', text: 'def f(x):' },
        { id: 'l2', text: '    return x * 2' },
        { id: 'l3', text: 'print(f(3))' },
      ],
    });
    expect(markAnswer(q, ['l1', 'l2', 'l3']).fraction).toBe(1);
    expect(markAnswer(q, ['l1', 'l3', 'l2']).fraction).toBeCloseTo(1 / 3);
    expect(markAnswer(q, ['l3', 'l2', 'l1']).fraction).toBeCloseTo(1 / 3);
    expect(markAnswer(q, ['l2', 'l3', 'l1']).fraction).toBe(0);

    const withRepeats = question('order_lines', {
      language: 'python',
      lines: [
        { id: 'a', text: 'x += 1' },
        { id: 'b', text: 'x += 1' },
      ],
    });
    // Swapping two identical lines is still fully correct.
    expect(markAnswer(withRepeats, ['b', 'a']).fraction).toBe(1);
  });
});

// ---------- scoring ----------

describe('scoring', () => {
  it('base points scale the 1000 points', () => {
    expect(basePoints(1)).toBe(1000);
    expect(basePoints(0)).toBe(0);
    expect(basePoints(1 / 3)).toBe(333);
    expect(basePoints(2)).toBe(1000);
    expect(basePoints(-1)).toBe(0);
  });

  it('speed bonus shrinks evenly to zero at the deadline', () => {
    const args = { fraction: 1, timingMode: 'timed', timeLimitSeconds: 30 };
    expect(speedBonus({ ...args, elapsedMs: 0 })).toBe(500);
    expect(speedBonus({ ...args, elapsedMs: 15_000 })).toBe(250);
    expect(speedBonus({ ...args, elapsedMs: 30_000 })).toBe(0);
    expect(speedBonus({ ...args, elapsedMs: 45_000 })).toBe(0);
  });

  it('no speed bonus on untimed questions or partial answers', () => {
    expect(
      speedBonus({ fraction: 1, timingMode: 'wait', timeLimitSeconds: null, elapsedMs: 0 }),
    ).toBe(0);
    expect(
      speedBonus({ fraction: 0.5, timingMode: 'timed', timeLimitSeconds: 30, elapsedMs: 0 }),
    ).toBe(0);
  });

  it('question points are base plus bonus', () => {
    const timed = question('mc_single', mcContent, {
      timingMode: 'timed',
      timeLimitSeconds: 20,
    });
    expect(scoreAnswer(timed, 'o1', 5_000)).toEqual({
      status: 'correct',
      base: 1000,
      bonus: 375,
      points: 1375,
    });
    expect(scoreAnswer(timed, 'o2', 5_000)).toEqual({
      status: 'wrong',
      base: 0,
      bonus: 0,
      points: 0,
    });
    expect(scoreAnswer(timed, undefined, 20_000)).toEqual({
      status: 'none',
      base: 0,
      bonus: 0,
      points: 0,
    });
  });
});

// ---------- leaderboard ----------

describe('leaderboard', () => {
  it('orders by total then name, and shares ranks on ties', () => {
    const board = buildLeaderboard([
      { id: 'p1', name: 'Sam', total: 100 },
      { id: 'p2', name: 'Linh', total: 300 },
      { id: 'p3', name: 'Mai', total: 100 },
      { id: 'p4', name: 'Jake', total: 50 },
    ]);
    expect(board.map((e) => [e.name, e.rank])).toEqual([
      ['Linh', 1],
      ['Mai', 2],
      ['Sam', 2],
      ['Jake', 4],
    ]);
  });

  it('handles an empty game and a single player', () => {
    expect(buildLeaderboard([])).toEqual([]);
    expect(buildLeaderboard([{ id: 'p1', name: 'Sam', total: 0 }])[0].rank).toBe(1);
  });

  it('writes ordinals the way English does', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
    ]);
  });

  it('letters options A to F', () => {
    expect([0, 1, 5].map(optionLetter)).toEqual(['A', 'B', 'F']);
  });
});

// ---------- shuffling ----------

describe('shuffleLines', () => {
  it('never returns the correct order when the lines are distinct', () => {
    const lines = [
      { id: 'l1', text: 'a' },
      { id: 'l2', text: 'b' },
      { id: 'l3', text: 'c' },
    ];
    for (let i = 0; i < 300; i += 1) {
      const shuffled = shuffleLines(lines);
      expect(shuffled).toHaveLength(3);
      expect(shuffled.map((l) => l.id).sort()).toEqual(['l1', 'l2', 'l3']);
      expect(shuffled.map((l) => l.text).join('')).not.toBe('abc');
    }
  });

  it('gives up gracefully when every line is identical', () => {
    const lines = [
      { id: 'a', text: 'same' },
      { id: 'b', text: 'same' },
    ];
    const shuffled = shuffleLines(lines);
    expect(shuffled.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('leaves a single line alone', () => {
    expect(shuffleLines([{ id: 'a', text: 'x' }])).toEqual([{ id: 'a', text: 'x' }]);
  });
});

// ---------- what students receive ----------

describe('content sent to students', () => {
  it('strips correct flags from choice options but keeps order and code language', () => {
    const sent = publicContent('mc_single', mcContent) as {
      options: Array<Record<string, unknown>>;
    };
    expect(sent.options.map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
    for (const option of sent.options) expect(option).not.toHaveProperty('correct');
    expect(sent.options[2]).toEqual({
      id: 'o3',
      kind: 'code',
      language: 'python',
      text: 'len(x)',
    });
  });

  it('sends nothing at all for true/false and short text', () => {
    expect(publicContent('true_false', { correct: true })).toEqual({});
    expect(
      publicContent('short_text', { accepted: ['len'], caseSensitive: false }),
    ).toEqual({});
  });

  it('sends the fill-in snippet and word bank but not the answers', () => {
    const sent = publicContent('fill_blank', {
      language: 'python',
      snippet: '{{1}}(3)',
      wordBank: ['range', 'print'],
      answers: { '1': 'range' },
    });
    expect(sent).toEqual({
      language: 'python',
      snippet: '{{1}}(3)',
      wordBank: ['range', 'print'],
    });
    expect(sent).not.toHaveProperty('answers');
  });

  it('sends order-the-lines already shuffled', () => {
    const content = {
      language: 'python',
      lines: [
        { id: 'l1', text: 'a' },
        { id: 'l2', text: 'b' },
        { id: 'l3', text: 'c' },
      ],
    };
    const sent = publicContent('order_lines', content) as {
      lines: Array<{ id: string }>;
    };
    expect(sent.lines.map((l) => l.id).sort()).toEqual(['l1', 'l2', 'l3']);
    expect(sent.lines.map((l) => l.id).join('')).not.toBe('l1l2l3');
  });

  it('builds the question message with timing only when timed', () => {
    const untimed = toPublicQuestion(question('true_false', { correct: true }), 0, 5, undefined);
    expect(untimed.timing).toEqual({ mode: 'wait' });
    expect(untimed.total).toBe(5);

    const timed = toPublicQuestion(
      question('true_false', { correct: true }, { timingMode: 'timed', timeLimitSeconds: 30 }),
      2,
      5,
      12_345,
    );
    expect(timed.timing).toEqual({ mode: 'timed', remainingMs: 12_345 });
  });

  it('includes the code block only when there is one', () => {
    const plain = toPublicQuestion(question('true_false', { correct: true }), 0, 1, undefined);
    expect(plain).not.toHaveProperty('code');

    const withCode = toPublicQuestion(
      question('true_false', { correct: true }, { code: 'x = 1', codeLanguage: 'python' }),
      0,
      1,
      undefined,
    );
    expect(withCode.code).toBe('x = 1');
    expect(withCode.codeLanguage).toBe('python');
  });
});

describe('correct answers for the results screen', () => {
  it('lists every correct option id', () => {
    const answer = correctAnswerFor(question('mc_multi', mcContent));
    expect(answer).toMatchObject({ type: 'mc_multi', optionIds: ['o1'] });
  });

  it('drops blank accepted answers', () => {
    const answer = correctAnswerFor(
      question('short_text', { accepted: ['len', '  '], caseSensitive: true }),
    );
    expect(answer).toEqual({ type: 'short_text', accepted: ['len'], caseSensitive: true });
  });
});

// ---------- submit button ----------

describe('isAnswerSubmittable', () => {
  it('requires a choice, a tick, a boolean or some text', () => {
    expect(isAnswerSubmittable('mc_single', {}, undefined)).toBe(false);
    expect(isAnswerSubmittable('mc_single', {}, 'o1')).toBe(true);
    expect(isAnswerSubmittable('mc_multi', {}, [])).toBe(false);
    expect(isAnswerSubmittable('mc_multi', {}, ['o1'])).toBe(true);
    expect(isAnswerSubmittable('true_false', {}, undefined)).toBe(false);
    expect(isAnswerSubmittable('true_false', {}, false)).toBe(true);
    expect(isAnswerSubmittable('short_text', {}, '   ')).toBe(false);
    expect(isAnswerSubmittable('short_text', {}, 'len')).toBe(true);
  });

  it('requires every blank to be chosen', () => {
    const content = { snippet: '{{1}}(3)\n{{2}}(i)' };
    expect(isAnswerSubmittable('fill_blank', content, { '1': 'range' })).toBe(false);
    expect(isAnswerSubmittable('fill_blank', content, { '1': 'range', '2': 'print' })).toBe(
      true,
    );
    expect(isAnswerSubmittable('fill_blank', content, { '1': 'range', '2': '' })).toBe(false);
  });

  it('always allows order-the-lines, because the shuffled order is an answer', () => {
    expect(isAnswerSubmittable('order_lines', {}, undefined)).toBe(true);
  });
});
