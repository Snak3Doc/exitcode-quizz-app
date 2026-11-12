/**
 * Compare the question quality of the models in the list, head to head.
 *
 *   npx vite-node scripts/compare-models.ts
 *   npx vite-node scripts/compare-models.ts --self-check    (costs nothing)
 *   npx vite-node scripts/compare-models.ts --report-only   (costs nothing)
 *
 * The list in `gemini.ts` is ordered by daily allowance rather than by
 * capability, which was the right call for reliability and was made without
 * anyone checking whether the cheaper models write worse questions. This is
 * that check.
 *
 * It is deliberately not a vibe test. Each model gets the same topics, the
 * same prompts and the same schema, and the answers go through:
 *
 *  1. `checkQuestion()`, the same validator that judges an imported file, so
 *     "usable at all" is measured rather than eyeballed; and
 *  2. **Python**, for every question that shows code and asks what it prints.
 *     That is the one failure that matters most and the one nobody notices: a
 *     question whose marked answer is wrong teaches the class something false.
 *
 * What it cannot judge is whether a question is worth asking. The report it
 * writes puts the questions side by side so a teacher can.
 *
 * `--self-check` runs the checker against the cases it has already got wrong,
 * without spending a request. That is not ceremony: the first version of this
 * script reported four wrong answers across two models and every one of them
 * was its own fault -- it compared a count against stdout, compared "1 2 3"
 * against "1\n2\n3", and tried to run a snippet with a blank still in it. A
 * scoreboard that libels a model is worse than no scoreboard, so run it.
 *
 * Costs one request per model per topic. gemini-3.6-flash is rationed at
 * twenty a day, so keep TOPICS short.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateQuiz } from '../supabase/functions/generate-quiz/gemini';
import { buildSystemPrompt, buildUserPrompt } from '../supabase/functions/generate-quiz/prompt';
import { quizSchemaFor } from '../supabase/functions/generate-quiz/schema';
import { normaliseSlots, summarise, type GeneratedQuestion } from '../src/lib/generation';
import type { QuestionType } from '../src/lib/types';

function keyFromEnvFile(): string | undefined {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const match = /^\s*GEMINI_API_KEY\s*=\s*(.*)$/m.exec(text);
  return match?.[1].trim().replace(/^["']|["']$/g, '');
}

const selfChecking = process.argv.includes('--self-check');

const apiKey = selfChecking ? 'not-needed' : (process.env.GEMINI_API_KEY ?? keyFromEnvFile());
if (!apiKey) {
  console.error('Put GEMINI_API_KEY=... in .env.local first.');
  process.exit(1);
}

/**
 * Topics picked to be traps, not softballs.
 *
 * Negative indices, negative modulo and range() boundaries are exactly where
 * a model that is pattern-matching rather than working it out gets the answer
 * confidently wrong -- which is the difference this is trying to detect.
 */
const TOPICS = [
  'Python list slicing with negative indices and steps',
  'Python integer division // and modulo % with negative numbers',
  'Python range() boundaries and what a for loop actually prints',
];

const TYPES: QuestionType[] = ['mc_single', 'true_false', 'short_text'];
const COUNT = 6;

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

interface Checked {
  model: string;
  topic: string;
  kept: number;
  dropped: { number: number; problems: string[] }[];
  ms: number;
  thoughtTokens?: number;
  /** Questions that show code and claim what it prints, actually run. */
  ran: {
    prompt: string;
    code: string;
    marked: string;
    printed: string;
    agrees: boolean;
    /** Right values, wrong shape: "1 2 3" for something printed on three lines. */
    formattingOnly: boolean;
  }[];
  questions: GeneratedQuestion[];
  failure?: string;
}

/** Run a snippet and return what it printed, or the error it raised. */
function runPython(code: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'quizcheck-'));
  const file = join(dir, 'snippet.py');
  writeFileSync(file, code, 'utf8');
  try {
    // -I: isolated. Model-written code is not trusted code, and an unqualified
    // interpreter would import from the snippet's own directory.
    return execFileSync('python', ['-I', file], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const shell = error as { stderr?: string; stdout?: string; message?: string };
    const stderr = (shell.stderr ?? '').trim();
    return stderr !== '' ? `ERROR: ${stderr.split('\n').pop()}` : `ERROR: ${shell.message ?? '?'}`;
  }
}

/** The answer the question says is correct, as text. */
function markedAnswer(question: GeneratedQuestion): string | null {
  const content = question.content as {
    options?: { text?: string; correct?: boolean }[];
    accepted?: string[];
    correct?: boolean;
  };
  if (Array.isArray(content.options)) {
    const right = content.options.filter((option) => option.correct);
    return right.length === 1 ? (right[0].text ?? null) : null;
  }
  if (Array.isArray(content.accepted)) return content.accepted[0] ?? null;
  return null;
}

/** Exactly what came out, give or take trailing space and Windows line ends. */
const tidy = (text: string) => text.trim().replace(/\r/g, '').replace(/[ \t]+$/gm, '');

/**
 * The same values in the same order, however they were laid out.
 *
 * A model that answers "1 2 3" where the program prints one number per line
 * has the arithmetic right and the presentation wrong. Those are different
 * complaints and conflating them was the first version of this script's
 * mistake -- it reported three wrong answers that were all correct.
 */
const values = (text: string) => tidy(text).split(/\s+/).join('\u0001');

/**
 * Only questions whose answer *is* the program's output.
 *
 * "How many lines does this print?" is answered by a number, not by stdout,
 * and comparing the two says nothing. Neither does running a snippet with a
 * blank left in it for the student to fill. Both were counted as wrong
 * answers by the first version of this, which is how a scoreboard ends up
 * libelling a model that got everything right.
 */
/**
 * Does the marked answer match what the program actually did?
 *
 * The prose case is not a fudge. "Nothing is printed" is the correct answer to
 * a loop that never runs, and it is a description rather than a transcript of
 * the empty output it describes. Without this the checker reports a wrong
 * answer for a question the model got exactly right -- which it did, before
 * this was here.
 */
function sameAnswer(printed: string, marked: string): boolean {
  if (values(printed) === values(marked)) return true;
  return tidy(printed) === '' && /\b(nothing|no output|empty|none)\b/i.test(marked);
}

function answerIsTheOutput(prompt: string, code: string): boolean {
  if (/_{3,}|\{\{/.test(code)) return false;
  if (/how many|how often|first|last|value of|which |what type/i.test(prompt)) return false;
  return /what (does|will) .*\b(print|output|display)|what is (printed|output|displayed)/i.test(
    prompt,
  );
}

async function askOne(model: string, topic: string): Promise<Checked> {
  const started = Date.now();
  const result = await generateQuiz({
    apiKey: apiKey!,
    models: [model],
    systemPrompt: buildSystemPrompt(TYPES),
    userPrompt: buildUserPrompt({ topic, count: COUNT, types: TYPES }),
    responseSchema: quizSchemaFor(TYPES),
  });
  const ms = Date.now() - started;

  if (!result.ok) {
    return {
      model,
      topic,
      kept: 0,
      dropped: [],
      ms,
      ran: [],
      questions: [],
      failure: JSON.stringify(result.failure).slice(0, 160),
    };
  }

  const raw = result.questions as GeneratedQuestion[];
  const types = raw.map((question) => (question as { type?: QuestionType }).type as QuestionType);
  const outcome = summarise(normaliseSlots(types, raw, { mode: 'wait' }));

  // Only the questions that make a checkable claim: code shown, output asked
  // for. Anything else is a judgement call and belongs in the report, not here.
  const ran: Checked['ran'] = [];
  for (const question of raw) {
    const code = (question as { code?: string }).code;
    const language = (question as { codeLanguage?: string }).codeLanguage;
    const prompt = (question as { prompt?: string }).prompt ?? '';
    if (!code || language !== 'python') continue;
    if (!answerIsTheOutput(prompt, code)) continue;
    const marked = markedAnswer(question);
    if (marked === null) continue;
    const printed = runPython(code);
    ran.push({
      prompt,
      code,
      marked,
      printed,
      agrees: sameAnswer(printed, marked),
      formattingOnly: sameAnswer(printed, marked) && tidy(printed) !== tidy(marked),
    });
  }

  return {
    model,
    topic,
    kept: outcome.kept.length,
    dropped: outcome.dropped,
    ms,
    thoughtTokens: result.usage.thoughtTokens,
    ran,
    questions: raw,
  };
}

/**
 * `--self-check`: prove the checker before trusting it, costing no requests.
 *
 * Every case here is one this script got wrong at some point and reported as
 * a model marking a wrong answer as correct. A scoreboard that libels a model
 * is worse than no scoreboard, so the scoreboard gets its own tests.
 */
/** One of each awkward shape the report has to survive, and no requests. */
function sampleResults(): Checked[] {
  return [
    {
      model: 'model-a',
      topic: 'Python something',
      kept: 1,
      dropped: [{ number: 2, problems: ['a code option has no language'] }],
      ms: 4200,
      ran: [
        {
          prompt: 'What does this code print?',
          code: 'print(1)',
          marked: '2',
          printed: '1',
          agrees: false,
          formattingOnly: false,
        },
      ],
      questions: [
        {
          type: 'mc_single',
          prompt: 'What does this code print?',
          code: 'print(1)',
          codeLanguage: 'python',
          explanation: 'It prints 1.',
          content: { options: [{ kind: 'code', text: 'print(1)', correct: true }] },
        },
        { type: 'true_false', prompt: 'A list is ordered.', content: { correct: true } },
        { type: 'short_text', prompt: 'Which method appends?', content: { accepted: ['append'] } },
      ] as unknown as GeneratedQuestion[],
    },
    {
      model: 'model-b',
      topic: 'Python something else',
      kept: 0,
      dropped: [],
      ms: 900,
      ran: [],
      questions: [],
      failure: '{"kind":"unavailable","detail":"quota is spent"}',
    },
  ];
}

function selfCheck(): void {
  const cases: { name: string; pass: boolean }[] = [
    {
      name: 'a count is not the output: "how many lines does this print?"',
      pass: !answerIsTheOutput('How many total lines of output will this loop print?', 'print(1)'),
    },
    {
      name: 'nor is "what is the first number printed?"',
      pass: !answerIsTheOutput('What is the first number printed by this loop?', 'print(1)'),
    },
    {
      name: 'a snippet with a blank left in it is not runnable',
      pass: !answerIsTheOutput('What does this code print?', 'for i in ____:\n    print(i)'),
    },
    {
      name: 'but a plain "what does this code print?" is',
      pass: answerIsTheOutput('What does this code print?', 'for i in range(3):\n    print(i)'),
    },
    {
      name: '"1 2 3" and "1\\n2\\n3" are the same answer, laid out differently',
      pass: sameAnswer('1\n2\n3', '1 2 3'),
    },
    {
      name: '...and that difference is still reported',
      pass: values('1\n2\n3') === values('1 2 3') && tidy('1\n2\n3') !== tidy('1 2 3'),
    },
    {
      name: '"Nothing is printed" is right when nothing is printed',
      pass: sameAnswer('', 'Nothing is printed'),
    },
    {
      name: 'a genuinely wrong answer is still wrong',
      pass: !sameAnswer('0\n1\n2', '1\n2\n3'),
    },
    {
      name: 'and so is a near miss',
      pass: !sameAnswer('0\n1\n2', '0\n1\n2\n3'),
    },
    {
      // Otherwise a typo in the report writer only surfaces after the run has
      // already spent a model's day, with the results stuck in the JSON.
      name: 'the report renders, including the awkward shapes',
      pass: (() => {
        try {
          const report = renderReport(sampleResults());
          return (
            report.includes('## Results') &&
            report.includes('## Every question, to read') &&
            report.includes('**disagrees**') &&
            report.includes('daily quota spent')
          );
        } catch {
          return false;
        }
      })(),
    },
  ];

  let failed = 0;
  for (const one of cases) {
    console.log(`${one.pass ? '  ok  ' : ' FAIL '} ${one.name}`);
    if (!one.pass) failed += 1;
  }
  console.log(failed === 0 ? '\nThe checker checks out.' : `\n${failed} broken.`);
  process.exit(failed === 0 ? 0 : 1);
}

if (selfChecking) selfCheck();

/**
 * `--report-only`: rebuild the report from the last run's saved results.
 *
 * The questions are the expensive part and they are already on disk. Changing
 * how the report reads should not cost another model its day.
 */
if (process.argv.includes('--report-only')) {
  const saved = JSON.parse(
    readFileSync(new URL('../model-comparison.json', import.meta.url), 'utf8'),
  ) as Checked[];
  writeFileSync(new URL('../model-comparison.md', import.meta.url), renderReport(saved), 'utf8');
  console.log(`Rebuilt model-comparison.md from ${saved.length} saved results. No requests spent.`);
  process.exit(0);
}

/**
 * Write the whole thing out as something a teacher can read and judge.
 *
 * The numbers above say whether a question is *usable* and whether its answer
 * is *right*. Neither says whether it is worth asking, which is the part that
 * actually decides this question -- so every question goes in the report, with
 * its options, its explanation and, where it was run, what Python really
 * printed.
 */
function renderReport(saved: readonly Checked[]): string {
  const out: string[] = [];
  const w = (line = '') => out.push(line);
  const field = (q: GeneratedQuestion, name: string) =>
    (q as Record<string, unknown>)[name];

  // Judge again rather than trusting what was recorded at the time. The
  // questions are the expensive part and they do not change; the checker does,
  // and it has been wrong. An old run re-rendered through a fixed checker
  // should get the fixed verdict, not keep the one that was wrong.
  const results = saved.map((r) => ({
    ...r,
    ran: r.ran.map((x) => ({
      ...x,
      agrees: sameAnswer(x.printed, x.marked),
      formattingOnly: sameAnswer(x.printed, x.marked) && tidy(x.printed) !== tidy(x.marked),
    })),
  }));

  const done = results.filter((r) => !r.failure);
  const totals = {
    questions: done.reduce((n, r) => n + r.questions.length, 0),
    kept: done.reduce((n, r) => n + r.kept, 0),
    ran: done.reduce((n, r) => n + r.ran.length, 0),
    right: done.reduce((n, r) => n + r.ran.filter((x) => x.agrees).length, 0),
  };

  w('# Which model writes better questions?');
  w();
  w(`Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/compare-models.ts\`.`);
  w('Same topics, same prompts, same schema for every model — the real');
  w('`buildSystemPrompt`, `buildUserPrompt` and `quizSchemaFor`, through the same');
  w('`generateQuiz` the Edge Function runs.');
  w();
  w('## How each question was checked');
  w();
  w('1. **`checkQuestion()`** — the same validator that judges an imported quiz file,');
  w('   so "usable at all" is measured rather than eyeballed.');
  w('2. **Python** — every question that shows code and asks what it *prints* was');
  w('   actually executed, and the output compared to the answer marked correct.');
  w();
  w('What neither can judge is whether a question is worth asking. That part is below,');
  w('question by question.');
  w();
  w('## Results');
  w();
  w('| Model | Topic | Usable | Answers run | Right | Time |');
  w('|---|---|---|---|---|---|');
  for (const r of results) {
    const topic = r.topic.replace(/^Python /, '').slice(0, 38);
    if (r.failure) {
      const why = r.failure.includes('quota') ? 'daily quota spent' : 'busy (503)';
      w(`| \`${r.model}\` | ${topic} | — | — | — | *${why}* |`);
      continue;
    }
    const right = r.ran.filter((x) => x.agrees).length;
    w(
      `| \`${r.model}\` | ${topic} | **${r.kept}/${r.questions.length}** | ${r.ran.length} | ` +
        `${r.ran.length === 0 ? '—' : `${right}/${r.ran.length}`} | ${(r.ms / 1000).toFixed(1)}s |`,
    );
  }
  w();
  w(`Across every quiz that came back: **${totals.kept} of ${totals.questions} usable**, and of the`);
  w(`${totals.ran} answers that could be checked by running the code, **${totals.right} were right**.`);
  if (totals.ran > 0 && totals.right === totals.ran) {
    w();
    w('**No model marked a wrong answer as correct.**');
  }
  w();

  const refused = done.filter((r) => r.dropped.length > 0);
  w('## Questions the validator refused');
  w();
  if (refused.length === 0) {
    w('None.');
  } else {
    w('```');
    for (const r of refused) {
      for (const d of r.dropped) w(`${r.model}  q${d.number}: ${d.problems.join('; ')}`);
    }
    w('```');
  }
  w();

  const wrong = done.flatMap((r) => r.ran.filter((x) => !x.agrees).map((x) => ({ r, x })));
  w('## Answers that disagree with Python');
  w();
  if (wrong.length === 0) {
    w('None. Every checkable answer matched what the code actually printed.');
  } else {
    w('**Read each of these before believing it.** This checker has reported false');
    w('positives before — a count compared against stdout, prose compared against an');
    w('empty output — and a scoreboard that libels a model is worse than no scoreboard.');
    w();
    for (const { r, x } of wrong) {
      w(`**\`${r.model}\`** — ${x.prompt}`);
      w();
      w('```python');
      w(x.code);
      w('```');
      w();
      w(`- marked correct: \`${JSON.stringify(x.marked)}\``);
      w(`- Python printed: \`${JSON.stringify(x.printed)}\``);
      w();
    }
  }
  w();

  w('## Every question, to read');
  w();
  for (const r of done) {
    w(`### \`${r.model}\` — ${r.topic}`);
    w();
    r.questions.forEach((q, index) => {
      const dropped = r.dropped.find((d) => d.number === index + 1);
      w(
        `**${index + 1}. ${String(field(q, 'prompt') ?? '')}**  <br>*${String(field(q, 'type') ?? '')}*` +
          `${dropped ? ` — **dropped:** ${dropped.problems.join('; ')}` : ''}`,
      );
      w();
      const code = field(q, 'code');
      if (typeof code === 'string' && code !== '') {
        w('```' + String(field(q, 'codeLanguage') ?? ''));
        w(code);
        w('```');
        w();
      }
      const content = (field(q, 'content') ?? {}) as {
        options?: { text?: string; correct?: boolean; kind?: string; language?: string }[];
        correct?: boolean;
        accepted?: string[];
      };
      if (Array.isArray(content.options)) {
        for (const option of content.options) {
          const body =
            option.kind === 'code'
              ? `\`${String(option.text).replace(/\n/g, ' ⏎ ')}\``
              : String(option.text);
          const noLanguage = option.kind === 'code' && !option.language ? '  ← *no language*' : '';
          w(`- ${option.correct ? '**✔**' : '○'} ${body}${noLanguage}`);
        }
      } else if (typeof content.correct === 'boolean') {
        w(`- Answer: **${content.correct ? 'True' : 'False'}**`);
      } else if (Array.isArray(content.accepted)) {
        w(`- Accepts: ${content.accepted.map((a) => `\`${a}\``).join(', ')}`);
      }
      w();
      const explanation = field(q, 'explanation');
      if (typeof explanation === 'string' && explanation !== '') {
        w(`> ${explanation}`);
        w();
      }
      const run = r.ran.find((x) => x.prompt === field(q, 'prompt'));
      if (run) {
        w(
          `*Ran it:* Python printed \`${JSON.stringify(run.printed)}\`, marked \`${JSON.stringify(run.marked)}\`` +
            ` — ${run.agrees ? (run.formattingOnly ? 'agrees, though laid out differently' : 'agrees') : '**disagrees**'}.`,
        );
        w();
      }
    });
  }

  const missing = results.filter((r) => r.failure).length;
  w('## What this does not settle');
  w();
  if (missing > 0) {
    w(`${missing} of ${results.length} model/topic pairs never answered, so the grid has holes.`);
    w('Draw nothing from a column a model was never able to fill.');
    w();
  }
  w('`gemini-3.6-flash` is rationed at twenty requests a day, so it runs out fast and is');
  w('usually the thinnest column here. One afternoon of a congested free tier is a data');
  w('point, not a finding — re-run this across a few days before treating it as settled.');

  return out.join('\n');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The free tier is congested enough that a single 503 would leave a hole in
 * the matrix, and a comparison with missing cells compares nothing. Each
 * model gets several goes at each topic before the cell is given up on.
 */
async function askUntilAnswered(model: string, topic: string): Promise<Checked> {
  let last = await askOne(model, topic);
  for (let attempt = 2; attempt <= 4 && last.failure; attempt += 1) {
    await sleep(6_000 * (attempt - 1));
    last = await askOne(model, topic);
  }
  return last;
}

const results: Checked[] = [];
for (const topic of TOPICS) {
  for (const model of MODELS) {
    const checked = await askUntilAnswered(model, topic);
    results.push(checked);
    const right = checked.ran.filter((r) => r.agrees).length;
    const sloppy = checked.ran.filter((r) => r.formattingOnly).length;
    const verdict = checked.failure
      ? `FAILED ${checked.failure}`
      : `${checked.kept}/${checked.questions.length} usable, ` +
        `${right}/${checked.ran.length} output answers right` +
        `${sloppy > 0 ? ` (${sloppy} right but mislaid out)` : ''}, ` +
        `${checked.ms}ms`;
    console.log(`${model.padEnd(22)} ${topic.slice(0, 42).padEnd(44)} ${verdict}`);
  }
}

writeFileSync(
  new URL('../model-comparison.json', import.meta.url),
  JSON.stringify(results, null, 2),
  'utf8',
);
writeFileSync(new URL('../model-comparison.md', import.meta.url), renderReport(results), 'utf8');
console.log('\nRaw results in model-comparison.json, the readable version in model-comparison.md');
