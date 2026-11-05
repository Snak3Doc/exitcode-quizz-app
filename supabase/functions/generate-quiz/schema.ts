/**
 * The response schema handed to Gemini, in its own dialect.
 *
 * Gemini constrains generation with `responseSchema`, which is a subset of
 * OpenAPI 3.0 rather than JSON Schema: uppercase type names, and only a
 * handful of keywords. So this is written out rather than derived from the Zod
 * schema in `src/lib/schema.ts` — a generic converter emits `$ref`, `allOf`
 * and `additionalProperties`, none of which survive the trip.
 *
 * The cost of writing it twice is drift, so `src/lib/generation.test.ts`
 * imports this file and asserts the enums and bounds still match
 * `types.ts` and `constants.ts`. That is why nothing here imports anything:
 * the file has to be readable by Deno and by vitest alike, and the app's
 * source uses extensionless imports that Deno will not resolve.
 *
 * The shape here is deliberately *not* the shape stored in the database.
 * `src/lib/generation.ts` converts between them. Two differences, both
 * forced:
 *
 *  - **No ids.** Options and lines carry ids in the database. Asking a model
 *    to invent unique ones is a reliable source of collisions, and they carry
 *    no meaning it needs: correctness is a boolean, order is array order.
 *  - **`fill_blank.answers` is an array, not a map.** The stored shape is
 *    `Record<string, string>` from blank number to word. Maps need
 *    `additionalProperties`, so the model returns `[{blank, word}]` instead.
 */

/** The subset of OpenAPI types Gemini accepts. */
type GeminiType = 'STRING' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';

export interface GeminiSchema {
  /** Optional only on an `anyOf` branch point, which carries no type of its own. */
  type?: GeminiType;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  /** Gemini-specific: fixes the order fields are generated in. */
  propertyOrdering?: string[];
  /** A union of shapes. Confirmed working by the spike on 2026-11-05. */
  anyOf?: GeminiSchema[];
}

// These are duplicated from the app on purpose (see the header). The test
// asserts they have not drifted.
export const QUESTION_TYPE_VALUES = [
  'mc_single',
  'mc_multi',
  'true_false',
  'short_text',
  'fill_blank',
  'order_lines',
] as const;

export const CODE_LANGUAGE_VALUES = [
  'python',
  'javascript',
  'html',
  'css',
  'plaintext',
] as const;

export const BOUNDS = {
  minOptions: 2,
  maxOptions: 6,
  minAccepted: 1,
  maxAccepted: 10,
  minWordBank: 2,
  maxWordBank: 12,
  maxBlanks: 6,
  minLines: 2,
  maxLines: 12,
} as const;

const language: GeminiSchema = {
  type: 'STRING',
  enum: [...CODE_LANGUAGE_VALUES],
  description: 'The language the code is written in. Only these are supported.',
};

const choiceOptions: GeminiSchema = {
  type: 'ARRAY',
  minItems: BOUNDS.minOptions,
  maxItems: BOUNDS.maxOptions,
  description: 'Four options suits most questions. Every wrong option should be one a student could believe.',
  items: {
    type: 'OBJECT',
    propertyOrdering: ['kind', 'language', 'text', 'correct'],
    required: ['kind', 'text', 'correct'],
    properties: {
      kind: {
        type: 'STRING',
        enum: ['text', 'code'],
        description: "Use 'code' only when the option is a fragment of code.",
      },
      language: language,
      text: { type: 'STRING' },
      correct: { type: 'BOOLEAN' },
    },
  },
};

/** The `content` object for one question type. */
export function contentSchemaFor(type: string): GeminiSchema {
  switch (type) {
    case 'mc_single':
      return {
        type: 'OBJECT',
        required: ['options'],
        properties: {
          options: {
            ...choiceOptions,
            description: `${choiceOptions.description} Exactly one must be correct.`,
          },
        },
      };

    case 'mc_multi':
      return {
        type: 'OBJECT',
        required: ['options'],
        properties: {
          options: {
            ...choiceOptions,
            description:
              `${choiceOptions.description} At least one must be correct; two or three is the useful range. ` +
              'A wrong tick cancels out a right one when marking, so weak distractors punish students twice.',
          },
        },
      };

    case 'true_false':
      return {
        type: 'OBJECT',
        required: ['correct'],
        properties: {
          correct: {
            type: 'BOOLEAN',
            description:
              'Whether the statement in the question text is true. The statement must be ' +
              'unambiguously true or false, not arguable.',
          },
        },
      };

    case 'short_text':
      return {
        type: 'OBJECT',
        propertyOrdering: ['accepted', 'caseSensitive'],
        required: ['accepted', 'caseSensitive'],
        properties: {
          accepted: {
            type: 'ARRAY',
            minItems: BOUNDS.minAccepted,
            maxItems: BOUNDS.maxAccepted,
            items: { type: 'STRING' },
            description:
              'Every spelling a student might reasonably type, such as both "print()" and "print". ' +
              'Marking is an exact comparison after trimming spaces, not fuzzy, so a one-word or ' +
              'one-token answer works far better than a sentence.',
          },
          caseSensitive: {
            type: 'BOOLEAN',
            description: 'Almost always false. True only when capitals genuinely change the meaning.',
          },
        },
      };

    case 'fill_blank':
      return {
        type: 'OBJECT',
        propertyOrdering: ['language', 'snippet', 'wordBank', 'answers'],
        required: ['language', 'snippet', 'wordBank', 'answers'],
        properties: {
          language,
          snippet: {
            type: 'STRING',
            description:
              'Code with blanks written {{1}}, {{2}} and so on, numbered from 1 with no gaps, at most ' +
              `${BOUNDS.maxBlanks}. Anything else in double braces is shown to students literally, so ` +
              'never write {{i}} or {{x}} for a variable — write the variable name plainly.',
          },
          wordBank: {
            type: 'ARRAY',
            minItems: BOUNDS.minWordBank,
            maxItems: BOUNDS.maxWordBank,
            items: { type: 'STRING' },
            description:
              'Every correct answer, plus at least two plausible wrong words. Without spare words the ' +
              'question is solvable by elimination alone.',
          },
          answers: {
            type: 'ARRAY',
            minItems: 1,
            maxItems: BOUNDS.maxBlanks,
            description: 'One entry per blank. Every word here must also appear in the word bank.',
            items: {
              type: 'OBJECT',
              propertyOrdering: ['blank', 'word'],
              required: ['blank', 'word'],
              properties: {
                blank: { type: 'INTEGER', description: 'The blank number, matching {{n}}.' },
                word: { type: 'STRING' },
              },
            },
          },
        },
      };

    case 'order_lines':
      return {
        type: 'OBJECT',
        propertyOrdering: ['language', 'lines'],
        required: ['language', 'lines'],
        properties: {
          language,
          lines: {
            type: 'ARRAY',
            minItems: BOUNDS.minLines,
            maxItems: BOUNDS.maxLines,
            items: { type: 'STRING' },
            description:
              'The lines in their CORRECT order. Do not shuffle them — the app shuffles them for ' +
              'students. Keep leading spaces, which matter in Python. There must be exactly one ' +
              'correct order, so avoid independent lines that could go either way.',
          },
        },
      };

    default:
      throw new Error(`No generation schema for question type: ${type}`);
  }
}

/** One whole question, for generating a single question of a known type. */
export function questionSchemaFor(type: string): GeminiSchema {
  return {
    type: 'OBJECT',
    propertyOrdering: ['prompt', 'code', 'codeLanguage', 'explanation', 'content'],
    // The explanation is required on purpose. It is the only thing a student
    // who got the question wrong reads, it costs almost nothing to generate,
    // and left optional a model under output pressure drops it first.
    required: ['prompt', 'explanation', 'content'],
    properties: {
      prompt: {
        type: 'STRING',
        description: 'The question as the class reads it on the projector. One or two lines.',
      },
      code: {
        type: 'STRING',
        description:
          'An optional code block shown above the question. Leave it out unless the question is ' +
          'about this specific code.',
      },
      codeLanguage: language,
      explanation: {
        type: 'STRING',
        description: 'Why the answer is right. Students read this after the question closes.',
      },
      content: contentSchemaFor(type),
    },
  };
}

/**
 * A whole quiz in one response.
 *
 * The spike (2026-11-05) confirmed Gemini handles `anyOf` over the six content
 * shapes and fills each one in correctly against its sibling `type`, so a quiz
 * costs one request rather than one per question. That matters on a free tier
 * counted in requests.
 *
 * `type` sits beside `content` so the converter knows which shape it is
 * looking at. Without it the caller would have to assume the model returned
 * the question types in the order they were asked for, which nothing
 * guarantees.
 */
export function quizSchemaFor(types: readonly string[]): GeminiSchema {
  const distinct = [...new Set(types)];
  if (distinct.length === 0) throw new Error('A quiz needs at least one question type.');

  return {
    type: 'OBJECT',
    required: ['questions'],
    properties: {
      questions: {
        type: 'ARRAY',
        minItems: 1,
        description:
          'The questions, in the order a class should meet them: easier first, ' +
          'building up. Do not repeat the same example or idea twice.',
        items: {
          type: 'OBJECT',
          propertyOrdering: ['type', 'prompt', 'code', 'codeLanguage', 'explanation', 'content'],
          required: ['type', 'prompt', 'explanation', 'content'],
          properties: {
            type: {
              type: 'STRING',
              enum: distinct,
              description: 'Which kind of question this is. `content` must match it.',
            },
            prompt: {
              type: 'STRING',
              description: 'The question as the class reads it on the projector. One or two lines.',
            },
            code: {
              type: 'STRING',
              description:
                'The code block shown above the question. REQUIRED whenever the question ' +
                'text refers to a piece of code ("what does this code print", "when this ' +
                'loop runs") — there is nowhere else for that code to go, and without it ' +
                'the question cannot be answered. Leave it out only when the question ' +
                'needs no code at all.',
            },
            codeLanguage: language,
            explanation: {
              type: 'STRING',
              description: 'Why the answer is right. Students read this after the question closes.',
            },
            content: {
              anyOf: distinct.map((type) => contentSchemaFor(type)),
            },
          },
        },
      },
    },
  };
}

/**
 * Timing is not in either schema on purpose. It is the teacher's choice in the
 * form, not the model's — the speed bonus only applies to timed questions, so
 * letting the model pick quietly changes how the whole quiz scores.
 */
