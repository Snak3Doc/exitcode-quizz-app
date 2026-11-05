/**
 * The spike. Answers the one question that decides how generation is built.
 *
 *   node scripts/spike-gemini-schema.ts
 *
 * Put `GEMINI_API_KEY=...` in `.env.local` first; an environment variable of
 * the same name wins if one is set. Node 24 runs TypeScript directly, so there
 * is nothing to install and nothing to build.
 *
 * Deliberately throwaway. It is not imported by the app and not covered by the
 * test suite; delete it once the question is answered.
 *
 * ---
 *
 * A quiz is an array of questions, and a question is one of six different
 * `content` shapes. Gemini constrains output with `responseSchema`, which is a
 * subset of OpenAPI 3.0, and how well it handles a union of that kind decides
 * the architecture:
 *
 *   union works  -> one request can generate a whole mixed-type quiz
 *   union fails  -> one request per question, each with a single flat schema
 *
 * That matters on a free tier, where the limit is counted in requests: ten
 * questions is either one request or ten.
 *
 * Two calls, so a failure can be told apart from a key that does not work:
 *   A. one question of a known type   (control -- should pass)
 *   B. a two-question mixed-type quiz (the real question)
 */

import { readFileSync } from 'node:fs';
import { contentSchemaFor, QUESTION_TYPE_VALUES } from '../supabase/functions/generate-quiz/schema.ts';

/**
 * Read the key out of `.env.local` rather than asking for it on the command
 * line, where it would be recorded in shell history. That file is already
 * git-ignored, and because the name has no `VITE_` prefix, Vite will not put
 * it anywhere near the browser bundle.
 */
function keyFromEnvFile(): string | undefined {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*GEMINI_API_KEY\s*=\s*(.*)$/.exec(line);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env.local, which the message below covers.
  }
  return undefined;
}

const API_KEY = process.env.GEMINI_API_KEY ?? keyFromEnvFile();
if (!API_KEY) {
  console.error('No Gemini API key found.\n');
  console.error('Add this line to .env.local (it is git-ignored, and without a');
  console.error('VITE_ prefix Vite will not put it in the browser bundle):\n');
  console.error('  GEMINI_API_KEY=your-key-here\n');
  console.error('Get a key from https://aistudio.google.com/apikey');
  process.exit(1);
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Ask Google which models this key can use rather than hard-coding a name.
 * Model names change and the free tier does not carry the same ones forever.
 */
/** `gemini-3.8-flash` -> 3008, so versions sort properly rather than as text. */
function versionOf(name: string): number {
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  if (!match) return -1;
  return Number(match[1]) * 1000 + Number(match[2] ?? 0);
}

async function pickFlashModel(): Promise<string> {
  const response = await fetch(`${BASE}/models?key=${API_KEY}`);
  if (!response.ok) {
    throw new Error(`Could not list models: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };

  const usable = (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));

  // `supportedGenerationMethods` says what a model can do, not whether this
  // key may still call it: a retired model is listed and then 404s. So prefer
  // the newest, and follow Google's redirect if we still pick a dead one.
  const flash = usable
    .filter((name) => name.includes('flash'))
    .filter((name) => !/preview|exp|thinking|image|audio|tts|live/.test(name))
    .sort((a, b) => {
      const byVersion = versionOf(b) - versionOf(a);
      if (byVersion !== 0) return byVersion;
      // At the same version, full Flash beats Flash-Lite: the fiddly question
      // types are exactly where the weaker model shows.
      return (a.includes('lite') ? 1 : 0) - (b.includes('lite') ? 1 : 0);
    });

  console.log(`Models this key can generate with: ${usable.length} (${flash.length} flash)`);
  if (flash.length === 0) throw new Error('This key has no usable flash model.');
  console.log(`Newest first: ${flash.slice(0, 5).join(', ')}`);

  return flash;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The models to try, newest first. Set from pickFlashModel. */
let candidates: string[] = [];
/** Whichever one actually answered. */
let activeModel = '';

async function callOnce(model: string, prompt: string, responseSchema: unknown) {
  try {
    const response = await fetch(`${BASE}/models/${model}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
      // An overloaded model can accept the connection and then never answer.
      // Without this the default headers timeout throws an uncaught error
      // minutes later and takes the whole script with it.
      signal: AbortSignal.timeout(45_000),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    // A hang or a dropped connection says the same thing as a 503: this model
    // is not answering right now. Treat it as such rather than crashing.
    return {
      status: 503,
      text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Try the candidates in order, because a free tier fails in ways that say
 * nothing about the schema:
 *
 *   503 / 429  the model is busy or the quota is spent -- wait, then move on
 *   404        the model is retired; the message names its replacement
 *   400        the schema was rejected, which is the answer we came for
 */
async function generate(prompt: string, responseSchema: unknown) {
  for (const candidate of [...candidates]) {
    let model = candidate;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { status, text } = await callOnce(model, prompt, responseSchema);

      if (status === 200) {
        activeModel = model;
        const body = JSON.parse(text) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const raw = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        try {
          return { ok: true as const, parsed: JSON.parse(raw) as unknown };
        } catch {
          return { ok: false as const, status, detail: `Not JSON: ${raw.slice(0, 400)}` };
        }
      }

      const suggested = /use models\/([A-Za-z0-9._-]+)/.exec(text)?.[1];
      if (status === 404 && suggested && suggested !== model) {
        console.log(`   ${model} is retired; Google points at ${suggested}.`);
        model = suggested;
        continue;
      }

      if (status === 503 || status === 429) {
        const why = status === 503 ? 'busy' : 'rate limited';
        if (attempt === 1) {
          console.log(`   ${model} is ${why}; waiting 5s and trying once more.`);
          await sleep(5000);
          continue;
        }
        console.log(`   ${model} still ${why}; trying the next model.`);
        break;
      }

      // Anything else -- a 400 above all -- is a real answer about the schema.
      return { ok: false as const, status, detail: text.slice(0, 600) };
    }
  }

  return {
    ok: false as const,
    status: 0,
    detail: 'Every candidate model was busy or rate limited. Try again later.',
  };
}

/** One question of a type we already know — the control. */
const singleQuestionSchema = {
  type: 'OBJECT',
  required: ['prompt', 'explanation', 'content'],
  properties: {
    prompt: { type: 'STRING' },
    explanation: { type: 'STRING' },
    content: contentSchemaFor('mc_single'),
  },
};

/** A whole quiz of mixed types — the thing in question. */
const mixedQuizSchema = {
  type: 'OBJECT',
  required: ['questions'],
  properties: {
    questions: {
      type: 'ARRAY',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'OBJECT',
        required: ['type', 'prompt', 'explanation', 'content'],
        properties: {
          type: { type: 'STRING', enum: [...QUESTION_TYPE_VALUES] },
          prompt: { type: 'STRING' },
          explanation: { type: 'STRING' },
          // The crux. If this is rejected, or comes back as the wrong shape
          // for the type beside it, generation goes one question per request.
          content: {
            anyOf: [
              contentSchemaFor('mc_single'),
              contentSchemaFor('true_false'),
              contentSchemaFor('order_lines'),
            ],
          },
        },
      },
    },
  },
};

candidates = await pickFlashModel();
console.log(`Trying: ${candidates[0]}\n`);

console.log('A. One question, type fixed (control)');
const control = await generate(
  'Write one multiple-choice question about Python lists for a 14-year-old.',
  singleQuestionSchema,
);
if (control.ok) {
  console.log(`   PASS (answered by ${activeModel})\n`);
} else {
  console.log(`   FAIL ${control.status}: ${control.detail}\n`);
  console.log('The control failed, so nothing below is meaningful. Check the key and the quota.');
  process.exit(1);
}

console.log('B. Two questions, mixed types, union content (the real question)');
const union = await generate(
  'Write two questions about Python for a 14-year-old: one multiple choice, ' +
    "one ordering three lines of code. Set each question's type field to match its content.",
  mixedQuizSchema,
);

if (!union.ok) {
  console.log(`   FAIL ${union.status}: ${union.detail}\n`);
  console.log('VERDICT: the union is not usable -> generate one question per request.');
  console.log('Each call then has a single flat schema, and plan §1 resolves that way.');
  process.exit(0);
}

console.log('   The call succeeded. Now check the shapes actually match:\n');
console.log(JSON.stringify(union.parsed, null, 2).slice(0, 1800));

console.log(
  '\nVERDICT: a 200 is necessary but not sufficient. Look at the two questions above —\n' +
    "each `content` must match its own `type` (an mc_single with `options`, an\n" +
    'order_lines with `lines`). If the model filled in the wrong shape, or merged\n' +
    'the fields of several types into one object, the union is unreliable and\n' +
    'generation should still go one question per request.',
);
