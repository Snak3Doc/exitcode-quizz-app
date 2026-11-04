import { describe, expect, it } from 'vitest';
import { buildQuizFile, parseQuizFile, quizFileName } from './quiz-file';
import type { FullQuiz } from './types';

const goodQuestion = {
  type: 'mc_single',
  prompt: 'What does this print?',
  code: 'for i in range(3):\n    print(i)',
  codeLanguage: 'python',
  timingMode: 'wait',
  timeLimitSeconds: null,
  explanation: 'range(3) gives 0, 1, 2.',
  content: {
    options: [
      { id: 'o1', kind: 'text', text: '0 1 2', correct: true },
      { id: 'o2', kind: 'text', text: '1 2 3', correct: false },
    ],
  },
};

function fileWith(questions: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: 'classroom-quiz',
    version: 1,
    title: 'Python basics',
    questions,
    ...extra,
  });
}

describe('export', () => {
  it('writes the documented shape', () => {
    const quiz: FullQuiz = {
      id: 'z1',
      title: 'Python basics',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      questions: [
        {
          id: 'q1',
          quizId: 'z1',
          position: 0,
          type: 'true_false',
          prompt: 'Python is a language.',
          code: null,
          codeLanguage: null,
          timingMode: 'timed',
          timeLimitSeconds: 20,
          explanation: null,
          content: { correct: true },
        },
      ],
    };
    expect(buildQuizFile(quiz)).toEqual({
      format: 'classroom-quiz',
      version: 1,
      title: 'Python basics',
      questions: [
        {
          type: 'true_false',
          prompt: 'Python is a language.',
          code: null,
          codeLanguage: null,
          timingMode: 'timed',
          timeLimitSeconds: 20,
          explanation: null,
          content: { correct: true },
        },
      ],
    });
  });

  it('makes a safe file name', () => {
    expect(quizFileName('Python basics: loops')).toBe('python-basics-loops.quiz.json');
    expect(quizFileName('Tiếng Việt')).toBe('tieng-viet.quiz.json');
    expect(quizFileName('???')).toBe('quiz.quiz.json');
  });

  it('round-trips through import', () => {
    const quiz: FullQuiz = {
      id: 'z1',
      title: 'Round trip',
      createdAt: '',
      updatedAt: '',
      questions: [
        {
          id: 'q1',
          quizId: 'z1',
          position: 0,
          ...goodQuestion,
        } as never,
      ],
    };
    const result = parseQuizFile(JSON.stringify(buildQuizFile(quiz)));
    expect(result.ok).toBe(true);
    expect(result.quiz?.title).toBe('Round trip');
    expect(result.quiz?.questions[0].content).toEqual(goodQuestion.content);
  });
});

describe('import: the file itself', () => {
  it('accepts a good file', () => {
    const result = parseQuizFile(fileWith([goodQuestion]));
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.quiz?.questions).toHaveLength(1);
    expect(result.quiz?.questions[0].position).toBe(0);
  });

  it('rejects a file that is too big, before parsing it', () => {
    expect(parseQuizFile('{}', 2_000_000).problems).toEqual([
      'That file is bigger than 1 MB.',
    ]);
  });

  it('rejects broken JSON, the wrong format and a newer version', () => {
    expect(parseQuizFile('not json').problems).toEqual(["That file isn't valid JSON."]);
    expect(parseQuizFile('[]').problems).toEqual(["That isn't a quiz file for this app."]);
    expect(parseQuizFile(JSON.stringify({ format: 'something-else' })).problems).toEqual([
      "That isn't a quiz file for this app.",
    ]);
    expect(
      parseQuizFile(fileWith([goodQuestion], { version: 2 })).problems,
    ).toEqual(['That quiz file was made by a newer version of this app.']);
  });

  it('rejects no questions and too many questions', () => {
    expect(parseQuizFile(fileWith([])).problems).toEqual(['The file has no questions.']);
    const many = Array.from({ length: 51 }, () => goodQuestion);
    expect(parseQuizFile(fileWith(many)).problems).toEqual([
      'The file has more than 50 questions.',
    ]);
  });

  it('accepts exactly 50 questions', () => {
    const fifty = Array.from({ length: 50 }, () => goodQuestion);
    expect(parseQuizFile(fileWith(fifty)).ok).toBe(true);
  });

  it('falls back to an untitled quiz when the title is missing', () => {
    const result = parseQuizFile(
      JSON.stringify({ format: 'classroom-quiz', version: 1, questions: [goodQuestion] }),
    );
    expect(result.quiz?.title).toBe('Untitled quiz');
  });
});

describe('import: the questions', () => {
  it('names the question in every problem and creates nothing', () => {
    const broken = {
      ...goodQuestion,
      content: {
        options: [
          { id: 'o1', kind: 'text', text: 'a', correct: false },
          { id: 'o2', kind: 'text', text: 'b', correct: false },
        ],
      },
    };
    const result = parseQuizFile(fileWith([goodQuestion, broken]));
    expect(result.ok).toBe(false);
    expect(result.quiz).toBeUndefined();
    expect(result.problems).toEqual(['Question 2: missing correct answer.']);
  });

  it('rejects an unknown question type', () => {
    const result = parseQuizFile(fileWith([{ ...goodQuestion, type: 'essay' }]));
    expect(result.problems).toEqual(['Question 1: unknown question type "essay".']);
  });

  it('rejects an entry that is not an object', () => {
    expect(parseQuizFile(fileWith(['hello'])).problems).toEqual([
      'Question 1: it is not a question.',
    ]);
  });

  it('ignores unknown fields', () => {
    const result = parseQuizFile(
      fileWith([{ ...goodQuestion, somethingNew: 42, author: 'x' }], { extra: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.quiz?.questions[0]).not.toHaveProperty('somethingNew');
  });

  it('gives a code block without a language a safe default', () => {
    const result = parseQuizFile(
      fileWith([{ ...goodQuestion, codeLanguage: 'cobol' }]),
    );
    expect(result.ok).toBe(true);
    expect(result.quiz?.questions[0].codeLanguage).toBe('plaintext');
  });

  it('drops a stray language when there is no code block', () => {
    const result = parseQuizFile(
      fileWith([{ ...goodQuestion, code: null, codeLanguage: 'python' }]),
    );
    expect(result.ok).toBe(true);
    expect(result.quiz?.questions[0].codeLanguage).toBeNull();
  });

  it('checks timed questions the same way hosting does', () => {
    const result = parseQuizFile(
      fileWith([{ ...goodQuestion, timingMode: 'timed', timeLimitSeconds: 999 }]),
    );
    expect(result.problems).toEqual([
      'Question 1: a timed question needs a whole number of seconds from 5 to 300.',
    ]);
  });

  it('drops a stray time limit on an untimed question', () => {
    const result = parseQuizFile(
      fileWith([{ ...goodQuestion, timingMode: 'wait', timeLimitSeconds: 999 }]),
    );
    expect(result.ok).toBe(true);
    expect(result.quiz?.questions[0].timeLimitSeconds).toBeNull();
  });

  it('reports problems for every bad question, not just the first', () => {
    const noPrompt = { ...goodQuestion, prompt: '   ' };
    const noAccepted = {
      ...goodQuestion,
      type: 'short_text',
      content: { accepted: [], caseSensitive: false },
    };
    const result = parseQuizFile(fileWith([noPrompt, noAccepted]));
    expect(result.problems).toEqual([
      'Question 1: the question text is empty.',
      'Question 2: needs at least one accepted answer.',
    ]);
  });
});
