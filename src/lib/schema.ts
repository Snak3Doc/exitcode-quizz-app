/**
 * One shared schema for complete (hostable) questions. Used by the hosting
 * checks, the importer and the editor. SPEC 3.5, 5.3, 5.4.
 *
 * Drafts in the editor are allowed to be incomplete, so nothing here runs while
 * the teacher types — it runs when they try to host, or when a file is imported.
 */

import { z } from 'zod';
import {
  CODE_LANGUAGES,
  QUESTION_TYPES,
  type CodeLanguage,
  type QuestionType,
} from './types';
import {
  MAX_ACCEPTED_ANSWERS,
  MAX_ACCEPTED_ANSWER_LENGTH,
  MAX_BLANKS,
  MAX_CODE_LENGTH,
  MAX_EXPLANATION_LENGTH,
  MAX_LINES,
  MAX_LINE_LENGTH,
  MAX_OPTIONS,
  MAX_OPTION_CODE_LENGTH,
  MAX_OPTION_TEXT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SNIPPET_LENGTH,
  MAX_TIME_LIMIT_SECONDS,
  MAX_TITLE_LENGTH,
  MAX_WORD_BANK,
  MAX_WORD_LENGTH,
  MIN_ACCEPTED_ANSWERS,
  MIN_LINES,
  MIN_OPTIONS,
  MIN_TIME_LIMIT_SECONDS,
  MIN_WORD_BANK,
} from './constants';

export const codeLanguageSchema = z.enum(CODE_LANGUAGES);
export const questionTypeSchema = z.enum(QUESTION_TYPES);

// ---------- content ----------

const choiceOptionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['text', 'code']),
    language: codeLanguageSchema.optional(),
    text: z.string(),
    correct: z.boolean(),
  })
  .superRefine((option, ctx) => {
    if (option.text.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'an option is empty' });
      return;
    }
    if (option.kind === 'code') {
      if (!option.language) {
        ctx.addIssue({ code: 'custom', message: 'a code option has no language' });
      }
      if (option.text.length > MAX_OPTION_CODE_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          message: `a code option is longer than ${MAX_OPTION_CODE_LENGTH} characters`,
        });
      }
    } else if (option.text.length > MAX_OPTION_TEXT_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        message: `an option is longer than ${MAX_OPTION_TEXT_LENGTH} characters`,
      });
    }
  });

const optionsArraySchema = z
  .array(choiceOptionSchema)
  .min(MIN_OPTIONS, `needs at least ${MIN_OPTIONS} options`)
  .max(MAX_OPTIONS, `can have at most ${MAX_OPTIONS} options`)
  .superRefine((options, ctx) => {
    const ids = new Set(options.map((o) => o.id));
    if (ids.size !== options.length) {
      ctx.addIssue({ code: 'custom', message: 'two options share an id' });
    }
  });

export const mcSingleContentSchema = z.object({
  options: optionsArraySchema.superRefine((options, ctx) => {
    const correct = options.filter((o) => o.correct).length;
    if (correct !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          correct === 0
            ? 'missing correct answer'
            : 'needs exactly one correct answer',
      });
    }
  }),
});

export const mcMultiContentSchema = z.object({
  options: optionsArraySchema.superRefine((options, ctx) => {
    if (!options.some((o) => o.correct)) {
      ctx.addIssue({ code: 'custom', message: 'missing correct answer' });
    }
  }),
});

export const trueFalseContentSchema = z.object({
  correct: z.boolean({
    required_error: 'missing correct answer',
    invalid_type_error: 'missing correct answer',
  }),
});

export const shortTextContentSchema = z.object({
  accepted: z
    .array(z.string())
    .min(MIN_ACCEPTED_ANSWERS, 'needs at least one accepted answer')
    .max(MAX_ACCEPTED_ANSWERS, `can have at most ${MAX_ACCEPTED_ANSWERS} accepted answers`)
    .superRefine((accepted, ctx) => {
      const filled = accepted.filter((a) => a.trim() !== '');
      if (filled.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'needs at least one accepted answer' });
      }
      if (accepted.some((a) => a.length > MAX_ACCEPTED_ANSWER_LENGTH)) {
        ctx.addIssue({
          code: 'custom',
          message: `an accepted answer is longer than ${MAX_ACCEPTED_ANSWER_LENGTH} characters`,
        });
      }
    }),
  caseSensitive: z.boolean(),
});

/** Blank markers in a fill-in-the-blank snippet, in the order they appear. */
export function findBlanks(snippet: string): number[] {
  const found: number[] = [];
  const pattern = /\{\{(\d+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snippet)) !== null) {
    found.push(Number(match[1]));
  }
  return found;
}

export const fillBlankContentSchema = z
  .object({
    language: codeLanguageSchema,
    snippet: z.string().max(MAX_SNIPPET_LENGTH, 'the snippet is too long'),
    wordBank: z.array(z.string()),
    answers: z.record(z.string(), z.string()),
  })
  .superRefine((content, ctx) => {
    if (content.snippet.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'the snippet is empty' });
    }

    const blanks = findBlanks(content.snippet);
    if (blanks.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'the snippet has no blanks (write {{1}}, {{2}} and so on)',
      });
    }
    if (blanks.length > MAX_BLANKS) {
      ctx.addIssue({
        code: 'custom',
        message: `has more than ${MAX_BLANKS} blanks`,
      });
    }
    const counts = new Map<number, number>();
    for (const n of blanks) counts.set(n, (counts.get(n) ?? 0) + 1);
    const duplicated = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
    if (duplicated.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `blank ${duplicated.join(', ')} appears more than once`,
      });
    }
    const distinct = [...counts.keys()].sort((a, b) => a - b);
    const expected = distinct.map((_, i) => i + 1);
    if (distinct.length > 0 && distinct.join(',') !== expected.join(',')) {
      ctx.addIssue({
        code: 'custom',
        message: `blanks must be numbered 1 to ${distinct.length} with no gaps`,
      });
    }

    const bank = content.wordBank.map((w) => w.trim()).filter((w) => w !== '');
    if (bank.length < MIN_WORD_BANK || bank.length > MAX_WORD_BANK) {
      ctx.addIssue({
        code: 'custom',
        message: `the word bank needs ${MIN_WORD_BANK} to ${MAX_WORD_BANK} words`,
      });
    }
    if (new Set(bank).size !== bank.length) {
      ctx.addIssue({ code: 'custom', message: 'the word bank has a repeated word' });
    }
    if (bank.some((w) => w.length > MAX_WORD_LENGTH)) {
      ctx.addIssue({
        code: 'custom',
        message: `a word in the bank is longer than ${MAX_WORD_LENGTH} characters`,
      });
    }

    for (const n of distinct) {
      const answer = content.answers[String(n)];
      if (!answer || answer.trim() === '') {
        ctx.addIssue({ code: 'custom', message: `blank ${n} has no correct word` });
      } else if (!bank.includes(answer)) {
        ctx.addIssue({
          code: 'custom',
          message: `the answer for blank ${n} is not in the word bank`,
        });
      }
    }
  });

export const orderLinesContentSchema = z.object({
  language: codeLanguageSchema,
  lines: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
      }),
    )
    .min(MIN_LINES, `needs at least ${MIN_LINES} lines`)
    .max(MAX_LINES, `can have at most ${MAX_LINES} lines`)
    .superRefine((lines, ctx) => {
      if (lines.some((l) => l.text.trim() === '')) {
        ctx.addIssue({ code: 'custom', message: 'a line is empty' });
      }
      if (lines.some((l) => l.text.length > MAX_LINE_LENGTH)) {
        ctx.addIssue({
          code: 'custom',
          message: `a line is longer than ${MAX_LINE_LENGTH} characters`,
        });
      }
      if (new Set(lines.map((l) => l.id)).size !== lines.length) {
        ctx.addIssue({ code: 'custom', message: 'two lines share an id' });
      }
    }),
});

export const contentSchemaFor: Record<QuestionType, z.ZodTypeAny> = {
  mc_single: mcSingleContentSchema,
  mc_multi: mcMultiContentSchema,
  true_false: trueFalseContentSchema,
  short_text: shortTextContentSchema,
  fill_blank: fillBlankContentSchema,
  order_lines: orderLinesContentSchema,
};

// ---------- whole questions ----------

/** The parts of a question that do not depend on its type. */
export const questionCommonSchema = z.object({
  type: questionTypeSchema,
  prompt: z
    .string()
    .max(MAX_PROMPT_LENGTH, `the question text is longer than ${MAX_PROMPT_LENGTH} characters`),
  code: z
    .string()
    .max(MAX_CODE_LENGTH, `the code block is longer than ${MAX_CODE_LENGTH} characters`)
    .nullable()
    .optional(),
  codeLanguage: codeLanguageSchema.nullable().optional(),
  timingMode: z.enum(['wait', 'timed']),
  timeLimitSeconds: z.number().int().nullable().optional(),
  explanation: z
    .string()
    .max(MAX_EXPLANATION_LENGTH, `the explanation is longer than ${MAX_EXPLANATION_LENGTH} characters`)
    .nullable()
    .optional(),
  content: z.record(z.string(), z.unknown()),
});

export type QuestionCommon = z.infer<typeof questionCommonSchema>;

/**
 * Every problem with one question, as sentences that can follow
 * "Question 3: ". Empty array means the question is ready to host.
 */
export function checkQuestion(question: {
  type: QuestionType;
  prompt: string;
  code?: string | null;
  codeLanguage?: CodeLanguage | null;
  timingMode: string;
  timeLimitSeconds?: number | null;
  explanation?: string | null;
  content: Record<string, unknown>;
}): string[] {
  const problems: string[] = [];

  const common = questionCommonSchema.safeParse(question);
  if (!common.success) {
    for (const issue of common.error.issues) {
      problems.push(issue.message);
    }
  }

  if (question.prompt.trim() === '') {
    problems.push('the question text is empty');
  }

  if (question.code !== null && question.code !== undefined) {
    if (question.code.trim() === '') {
      problems.push('the code block is empty');
    }
    if (!question.codeLanguage) {
      problems.push('the code block has no language');
    }
  }

  if (question.timingMode === 'timed') {
    const seconds = question.timeLimitSeconds;
    if (
      typeof seconds !== 'number' ||
      !Number.isInteger(seconds) ||
      seconds < MIN_TIME_LIMIT_SECONDS ||
      seconds > MAX_TIME_LIMIT_SECONDS
    ) {
      problems.push(
        `a timed question needs a whole number of seconds from ${MIN_TIME_LIMIT_SECONDS} to ${MAX_TIME_LIMIT_SECONDS}`,
      );
    }
  }

  const contentResult = contentSchemaFor[question.type].safeParse(question.content);
  if (!contentResult.success) {
    for (const issue of contentResult.error.issues) {
      problems.push(contentIssueMessage(issue));
    }
  }

  // Keep the list short and stable: no repeats, in the order found.
  return [...new Set(problems)];
}

/** Zod's own wording for a missing or wrong-typed field, which we replace. */
const ZOD_DEFAULT_TYPE_MESSAGE = /^(Required$|Expected )/;

function contentIssueMessage(issue: z.ZodIssue): string {
  // Our own messages already read as sentences and are kept as written. Zod's
  // built-in wording for a missing or wrong-typed field does not, so it gets a
  // plain fallback instead.
  if (issue.code === 'invalid_type' && ZOD_DEFAULT_TYPE_MESSAGE.test(issue.message)) {
    const path = issue.path.filter((p) => typeof p === 'string').join('.');
    return path ? `the answer is incomplete (${path})` : 'the answer is incomplete';
  }
  return issue.message;
}

export interface HostingProblem {
  /** 1-based, as shown to the teacher. */
  questionNumber: number;
  message: string;
}

/**
 * Everything that stops a quiz being hosted. SPEC 3.5.
 * questionNumber 0 means the problem is with the quiz itself.
 */
export function validateQuizForHosting(quiz: {
  title: string;
  questions: Array<Parameters<typeof checkQuestion>[0]>;
}): HostingProblem[] {
  const problems: HostingProblem[] = [];

  const title = quiz.title.trim();
  if (title === '') {
    problems.push({ questionNumber: 0, message: 'The quiz needs a title.' });
  } else if (title.length > MAX_TITLE_LENGTH) {
    problems.push({
      questionNumber: 0,
      message: `The title is longer than ${MAX_TITLE_LENGTH} characters.`,
    });
  }

  if (quiz.questions.length === 0) {
    problems.push({
      questionNumber: 0,
      message: 'The quiz needs at least one question.',
    });
    return problems;
  }

  quiz.questions.forEach((question, index) => {
    for (const message of checkQuestion(question)) {
      problems.push({ questionNumber: index + 1, message });
    }
  });

  return problems;
}
