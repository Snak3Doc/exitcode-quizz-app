/**
 * Exercise the real generation path without deploying anything.
 *
 *   node scripts/try-generation.ts
 *
 * Reads GEMINI_API_KEY the same way the spike does. Uses the actual prompts,
 * the actual schema and the actual retry logic the Edge Function uses — only
 * the HTTP and auth shell around them is skipped, which is the part vitest
 * already covers and the part that cannot be wrong in an interesting way.
 *
 * Costs one request. Worth it: a bad prompt is far cheaper to find here than
 * after deploying, and the questions have to be read by a person anyway —
 * nothing automated can tell you whether a question is actually correct.
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_MODELS, generateQuiz } from '../supabase/functions/generate-quiz/gemini.ts';
import {
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from '../supabase/functions/generate-quiz/prompt.ts';
import { quizSchemaFor } from '../supabase/functions/generate-quiz/schema.ts';

function keyFromEnvFile(): string | undefined {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*GEMINI_API_KEY\s*=\s*(.*)$/.exec(line);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // Covered by the message below.
  }
  return undefined;
}

const apiKey = process.env.GEMINI_API_KEY ?? keyFromEnvFile();
if (!apiKey) {
  console.error('Put GEMINI_API_KEY=... in .env.local first.');
  process.exit(1);
}

/**
 * `--repair` asks for a replacement for a deliberately broken question
 * instead of a fresh quiz. The repair path only fires when the model gets
 * something wrong, which is rare enough that waiting for it to happen is not
 * a way to find out whether it works.
 */
const repairing = process.argv.includes('--repair');

if (repairing) {
  // A single-answer question with two correct options: the exact thing
  // checkQuestion() rejects, described in checkQuestion()'s own words.
  const broken = {
    prompt: 'Which of these is a Python list method?',
    explanation: 'Both append() and pop() are list methods.',
    content: {
      options: [
        { kind: 'text', text: 'append()', correct: true },
        { kind: 'text', text: 'pop()', correct: true },
      ],
    },
  };

  const repairResult = await generateQuiz({
    apiKey,
    models: DEFAULT_MODELS,
    systemPrompt: buildSystemPrompt(['mc_single']),
    userPrompt: buildRepairPrompt('Python list methods, for beginners', [
      {
        type: 'mc_single',
        problems: ['a single-answer question needs exactly one correct option'],
        question: broken,
      },
    ]),
    responseSchema: quizSchemaFor(['mc_single']),
  });

  if (!repairResult.ok) {
    console.error(`REPAIR FAILED (${repairResult.failure.kind})`);
    console.error(JSON.stringify(repairResult.failure, null, 2));
    process.exit(1);
  }

  console.log(`Repaired by ${repairResult.model}:\n`);
  console.log(JSON.stringify(repairResult.questions, null, 2));
  console.log(
    '\nCheck that exactly one option is now correct, and that it is still the same\n' +
      'question rather than an unrelated one.',
  );
  process.exit(0);
}

const types = ['mc_single', 'fill_blank', 'order_lines'];
const topic = process.argv[2] ?? 'Python for loops and the range() function, for beginners';
const count = 3;

console.log(`Topic: ${topic}`);
console.log(`Asking for ${count} questions of: ${types.join(', ')}\n`);

const result = await generateQuiz({
  apiKey,
  models: DEFAULT_MODELS,
  systemPrompt: buildSystemPrompt(types),
  userPrompt: buildUserPrompt({ topic, count, types }),
  responseSchema: quizSchemaFor(types),
});

if (!result.ok) {
  console.error(`FAILED (${result.failure.kind})`);
  console.error(JSON.stringify(result.failure, null, 2));
  process.exit(1);
}

console.log(`Answered by ${result.model}, ${result.questions.length} question(s).\n`);
console.log(JSON.stringify(result.questions, null, 2));

console.log(
  '\nRead these properly. The schema and the validator between them cannot tell you\n' +
    'whether an answer is actually right, whether order_lines came back shuffled, or\n' +
    'whether a fill_blank word bank gives the game away.',
);
