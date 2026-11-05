# Generating quizzes with an LLM — the plan

A design for turning a teacher's prompt into a quiz. Nothing here is built yet.
Decisions marked **OPEN** need Ben's answer before the first line of code.

This builds on `SPEC.md`; where it contradicts the spec, it says so.

---

## 0. The problem that comes first: there is no server

This has to be settled before any of the three questions in the brief, because
it decides where everything else lives.

ExitCode is a Vite single-page app. Everything in `src/` runs in the student's
or teacher's browser. Vite inlines `VITE_*` variables into the bundle at build
time — that is exactly why the Supabase anon key works the way it does, and why
changing it on Vercel needs a redeploy.

An Anthropic API key cannot go there. `VITE_ANTHROPIC_API_KEY` would be sitting
in plain text in `assets/index-*.js`, readable by anyone who opens the site,
including every student in the room. They would be spending Ben's money within
a day.

So the feature needs somewhere server-side to hold the key.

### Options

| Where | Auth story | Verdict |
| --- | --- | --- |
| **Supabase Edge Function** | Already has the teacher's JWT; can call `is_allowed_teacher()` directly | **Recommended** |
| Vercel Serverless Function | Would have to verify the Supabase JWT by hand | Workable, more glue |
| Teacher pastes their own API key | Key still ends up in the browser; every teacher needs a billing account | No |

**Recommendation: a Supabase Edge Function.**

The reasons are all about reusing what already works. The function receives the
caller's Supabase JWT in the `Authorization` header, so it can check
`is_allowed_teacher()` with the same function the app already uses — the
approved-teacher rule stays in one place rather than being re-implemented. The
API key lives in `supabase secrets`, never in the repo and never in the bundle.
Edge Functions run Deno, which runs `@anthropic-ai/sdk` directly. And it keeps
the stack at two services instead of three.

The cost is a new manual setup step, which the README will have to carry:
deploy the function, set the secret. That is a real cost — the setup list is
already seven items long — but it is unavoidable for any design that keeps the
key off the client.

### What this means

- A new top-level `supabase/functions/generate-quiz/` directory.
- `supabase/migrations/002_generation_limits.sql` for the rate-limit table (§5.1).
- The browser calls `supabase.functions.invoke('generate-quiz', ...)`, which
  attaches the session JWT automatically.
- `src/lib/` gains a thin client wrapper. **No Anthropic SDK in the browser bundle.**

---

## 1. Whole quiz, or a prompt per question?

**Recommendation: one prompt for the whole quiz, plus per-question regeneration.**

Not either/or — the second falls out of the first for free, and you need it
anyway.

### Why whole-quiz is the primary flow

A teacher thinks in quizzes, not questions. "Ten questions on Python loops for
year 9" is one thought. Making them write ten prompts turns a thirty-second job
into a five-minute one, and the ten questions would not know about each other —
you would get the same `for i in range(5)` example four times, no difficulty
progression, and no coverage of the topic as a whole. One prompt lets the model
plan the set.

### Why per-question regeneration is needed regardless

Some questions will come back wrong — factually, or just not what the teacher
wanted. The options are regenerate the whole quiz (throwing away the nine good
ones) or regenerate the one. The second is obviously right, and once it exists
it is also the repair mechanism for validation failures (§2.3). So it is not an
extra feature; it is the same code path used twice.

In the editor this is a **Regenerate** button on the selected question, which
sends the original quiz prompt plus "replace question 4, which was about X".

### The variant to keep in reserve

If quality or latency disappoint, the next move is **two-phase generation**:
first ask for a cheap outline (type, topic, difficulty per question), let the
teacher edit that, then generate each question from its outline row in
parallel. It gives the teacher control over the shape before spending the
tokens, and parallel requests finish faster than one long response.

It is more moving parts, so it is not the thing to build first. Noted here so
the first design does not paint us into a corner: keeping generation
per-question-addressable from day one is what preserves this option.

---

## 2. Getting a usable shape back

### 2.1 Use structured outputs, not "please reply in JSON"

The Messages API can constrain the response to a JSON Schema via
`output_config: { format: ... }`. That is the mechanism to use. Asking for JSON
in the prompt and parsing what comes back is the thing people did before this
existed, and it fails in the ways you would expect.

Two notes on current API behaviour, both easy to get wrong from memory:

- It is `output_config.format`. The older top-level `output_format` parameter
  is deprecated.
- Forcing a tool call (`tool_choice: {type: "any"}`) returns a **400** on
  Claude Opus 5.5. The old "define a tool and force it to get JSON" trick is
  gone. Structured outputs is the replacement.

### 2.2 Derive the schema from the Zod schema we already have

`src/lib/schema.ts` already describes every question type. Hand-writing a
second JSON Schema for the API would mean two definitions drifting apart, and
the drift would show up as questions that generate fine and then fail to
import.

Generate the JSON Schema from the existing Zod schema instead. Zod 3 needs
`zod-to-json-schema` for this (Zod 4 has `z.toJSONSchema` built in; we are on
3.25.76 and **not** upgrading as part of this).

The shape to generate is the existing `.quiz.json` envelope from
`src/lib/quiz-file.ts` — `QuizFile` without `format` and `version`, which the
server fills in. This means generated quizzes travel the same path as imported
ones, and the import tests already cover most of it.

### 2.3 Structured output is not enough — validate, then repair

Structured outputs guarantees the response **fits the schema**. It does not
guarantee the quiz is **valid**. These are different:

| Schema-valid but wrong | Caught by |
| --- | --- |
| `mc_single` with two options marked correct | `checkQuestion()` |
| `fill_blank` whose word bank is missing a blank's answer | `checkQuestion()` |
| Blanks numbered 1, 2, 4 | `findBlanks()` / `checkQuestion()` |
| `order_lines` with only one line | `checkQuestion()` |
| A timed question with `timeLimitSeconds: 4` | `checkQuestion()` |

So the pipeline is:

```
generate → structured output (well-formed)
         → checkQuestion() per question (valid)
         → repair pass for failures, capped at one retry
         → drop whatever still fails, and say so
```

The repair pass is worth doing because `checkQuestion()` already returns
human-readable problems — the same strings the importer shows, like
"Question 3: missing correct answer". Those go straight back to the model as
the repair instruction. No new error vocabulary needed.

**Cap the repair at one retry.** An uncapped loop is how a generation feature
turns into a runaway bill.

### 2.4 Do not ask the model for ids

`ChoiceOption` and the lines of `order_lines` both carry an `id`. Asking a
model to invent unique ids is a dependable source of duplicates and collisions,
and the ids carry no meaning the model needs: correctness is a boolean on the
option, and line order is array order.

So the generation schema should **omit ids entirely**, and the function should
mint them with `crypto.randomUUID()` after parsing, before validation. Fewer
tokens, fewer failure modes, and the ids stay the plumbing they were meant to
be.

---

## 3. Who decides timing, option count and type?

**The teacher owns the shape. The model owns the content.**

Letting the model choose everything produces erratic results — one question
timed at 10 seconds and the next at 120, with no pedagogical reason. These are
teaching decisions, and they are also the parameters that make validation
predictable.

| Knob | Decided by | Default | Why |
| --- | --- | --- | --- |
| Question count | Teacher | 10 | Capped at `MAX_QUESTIONS_PER_QUIZ` (50); see §5.1 for a lower practical cap |
| Question types | Teacher (multi-select) | See below | Pedagogical choice, and some types generate much worse than others |
| Timing | Teacher, one policy for the quiz | **Untimed** | See below |
| Time limit, if timed | Teacher | 30s (`DEFAULT_TIME_LIMIT_SECONDS`) | One value for the quiz; per-question tuning is what the editor is for |
| Options per MC question | Model, within 2–6 | Bias to 4 | Genuinely content-dependent — some questions have three plausible distractors, some have five |
| Code language | Model, from the 5 registered | — | Must follow the question's subject |
| Explanation | Model, always | — | Cheap, and it is what students read on the results screen |

### Why untimed by default

Three reasons, in order of weight:

1. **Timing changes the scoring.** The speed bonus only applies to timed
   questions (`scoreAnswer` in `game-logic.ts`). Defaulting to timed silently
   turns every generated quiz into a race.
2. "Wait for everyone" is the gentler classroom default, and the slowest
   student sets the pace rather than being cut off.
3. A model has no idea how long a question takes a particular class.

A teacher who wants a race can switch the whole quiz to timed in the form, or
set individual questions in the editor.

### Which types to allow by default

**OPEN — needs a decision.** The honest position is that the six types are not
equally generatable:

- `mc_single`, `true_false`, `short_text` — straightforward.
- `mc_multi` — fine, but needs good distractors (§4.4).
- `fill_blank`, `order_lines` — **the risky two.** Fiddly formats that models
  get wrong in specific, predictable ways (§4.1, §4.2).

Two defensible defaults: all six on, accepting more repair churn; or the four
easy ones on with the risky two opt-in. My recommendation is **all six on**,
because the repair loop exists precisely for this and the fill-blank format is
a big part of what makes the app worth using — but it is a quality-versus-
reliability call that belongs to Ben.

---

## 4. Where each question type will go wrong

Grounded in the real constraints in `src/lib/constants.ts`. These go in the
system prompt as explicit rules with worked examples — the generic "produce a
fill-in-the-blank question" instruction will not do it.

### 4.1 `fill_blank` — the hardest

The format is unusual and the model has no prior for it:

- Blanks are written `{{1}}`, `{{2}}`, numbered from 1 and **contiguous**.
- Anything else in double braces is literal text, not a blank. The existing
  hand-written test quiz has `{{i}}` in it, which renders to students as the
  literal characters `{{i}}` — a person made that mistake, and a model will too.
- The word bank must contain **every** correct answer, plus distractors.
  `MIN_WORD_BANK` 2, `MAX_WORD_BANK` 12, `MAX_WORD_LENGTH` 30.
- `MAX_BLANKS` is 6.
- A word bank with exactly as many words as blanks makes the question trivially
  solvable by elimination. Require at least two distractors.

### 4.2 `order_lines` — the subtle one

- Lines go in `content` in the **correct** order. `shuffleLines()` shuffles
  them for students at runtime. A model that "helpfully" pre-shuffles produces
  a question whose correct answer is scrambled, and **nothing catches this** —
  it is schema-valid and `checkQuestion()`-valid. It only shows up as students
  being marked wrong for the right answer.
- Indentation is significant and preserved. Python especially.
- `MIN_LINES` 2, `MAX_LINES` 12, `MAX_LINE_LENGTH` 120.
- The order must be genuinely unique. Two independent statements that could go
  either way make the question unfair, and again nothing catches it.

This type deserves the most prompt effort and the most scepticism.

### 4.3 `short_text`

- Several accepted answers, not one. `print()` and `print` are both reasonable.
  `MAX_ACCEPTED_ANSWERS` is 10.
- **Default case-sensitive to off.** On it causes false negatives, and the
  marking already trims whitespace and folds case unless the flag is set.
- Avoid questions whose answer is a sentence — `matchesShortText` is an exact
  comparison after normalising, not fuzzy matching.

### 4.4 `mc_multi`

- Scoring is `max(0, (correctTicked − wrongTicked) / totalCorrect)`. A wrong
  tick cancels a right one, so weak distractors are actively punishing.
- At least one correct option; two or three is the useful range.

### 4.5 `true_false`

Easy to generate, easy to generate *badly* — statements that are arguably
either. Require an unambiguous, checkable claim.

### 4.6 Code blocks

- Only `python`, `javascript`, `html`, `css`, `plaintext` are registered with
  highlight.js. A model asked about Java will happily emit `java`, which the
  schema rejects.
- `MAX_CODE_LENGTH` 4000, `MAX_SNIPPET_LENGTH` 2000.

### 4.7 The one no validator catches: being wrong

"What does this print?" is where models slip, confidently. Nothing in the
codebase can check that a generated Python snippet prints what the answer says.

Two mitigations, neither complete:

1. **The teacher reviews before hosting.** The editor is already the review
   surface and `validateQuizForHosting()` is already the gate. Generation
   should land the teacher *in the editor*, never host directly.
2. **OPEN:** mark generated questions as unreviewed — a `generated_at` column,
   cleared on first manual edit, with a badge in the question list. Makes
   "which of these have I actually checked?" answerable. Costs a migration.

Worth noting the existing hand-written quiz has a question whose lines print
`0, 1, 2, 4` under a prompt asking for `0, 1, 2, 3, 4`. Human-authored. Review
matters either way; this feature just makes more questions arrive at once.

---

## 5. Everything else that will bite

### 5.1 Cost and abuse

Approved teachers only, but an approved teacher with a stuck loop still spends
real money. Needed:

- A per-teacher daily cap, counted in a `generation_usage` table with RLS so a
  teacher can only see their own row.
- A per-request question cap well below the schema's 50. **20 is a sensible
  ceiling** — beyond that the response is long enough to be slow and the
  failure expensive.
- The one-retry repair cap from §2.3.

Rough cost per 10-question quiz, from current pricing: around **2k input and 4k
output tokens**, so roughly **$0.10** on Claude Opus 5.5 ($4/$20 per MTok). On
Claude Sonnet 5.5 ($2/$10) it is about half that; on Claude Haiku 5.5
($0.10/$0.50) about a fiftieth.

**OPEN:** model choice. The default is `claude-opus-5-5` and the quality
difference shows up exactly in the fiddly formats of §4.1 and §4.2 and in not
being wrong about what code prints. Dropping to a cheaper model is a real
option and a real tradeoff, and it is Ben's call, not mine.

### 5.2 Latency

Ten questions is a lot of output — tens of seconds, not two. So:

- **Stream the response.** The SDK requires streaming for large `max_tokens`
  anyway, and it avoids HTTP timeouts.
- The teacher needs a progress indication and a **Cancel** that actually
  aborts.
- Edge Functions have a wall-clock limit. A 20-question generation needs to fit
  inside it — another argument for the cap in §5.1, and for the two-phase
  variant in §1 if we ever raise it.

### 5.3 Partial failure — a deliberate break with import

`quiz-file.ts` creates **nothing** if any question is bad. That is right for
import: the file is the teacher's own, and silently dropping two of their
questions would be worse than refusing.

Generation is a different contract. If eight of ten questions are good, throwing
them away and charging for the privilege is not a kindness.

**Recommendation: generation keeps what passes**, creates the quiz with those,
and tells the teacher plainly what was dropped and why.

This is a genuine divergence between two paths that otherwise share validation,
so it should be a conscious decision rather than an accident.

### 5.4 Interaction with the editor's autosave

The editor autosaves a second after each change. Generation writes a whole quiz
at once. It should create the quiz and its questions in **one** operation and
then open the editor on the result — not stream questions into an open editor,
which would fight the autosave and produce a mess of partial saves.

### 5.5 Prompt injection

Low risk: the teacher writes the prompt and the result lands in their own
editor. It stops being negligible if teachers paste in material from elsewhere
(a worksheet, a web page) and that text contains instructions. The blast radius
is a bad quiz rather than data loss, since the function only ever returns quiz
JSON and never executes anything. Worth one line in the system prompt telling
the model to treat the teacher's topic text as subject matter, not instructions.

### 5.6 Language

**OPEN.** `SPEC.md` rules out a Vietnamese *interface* for v1. Generated
*content* is a separate question, and the classes are in Vietnam. Should the
form offer a content language? Cheap to add now (one more field in the prompt),
awkward to retrofit once teachers have quizzes.

### 5.7 Where it lives in the UI

On **My quizzes**, beside `+ New quiz` and `Import quiz file`. Opens a form:
prompt, question count, types, timing policy. On success, straight into the
editor with the generated quiz loaded.

### 5.8 Testing

The generation call itself cannot be unit-tested without spending money and
accepting non-determinism. What *can* be tested, and should be:

- The Zod-to-JSON-Schema derivation.
- The validate-and-repair layer, against **recorded fixtures** of good and bad
  model output — including the failure modes in §4, especially a pre-shuffled
  `order_lines` and a `fill_blank` with a gap in the numbering.
- The partial-failure path from §5.3.

That keeps the test suite deterministic and offline, which is what the existing
157 tests are.

---

## 6. Decisions needed before building

1. **Supabase Edge Function** as the server side — confirm, or prefer Vercel.
2. **Model**: `claude-opus-5-5` (~$0.10/quiz) or a cheaper tier, accepting more
   repair churn on the fiddly types.
3. **Default question types**: all six, or hold back `fill_blank` and
   `order_lines` until their prompts are proven.
4. **Generated-question badge** (§4.7) — worth a migration, or not?
5. **Content language** (§5.6) — English only for now, or a language field?
6. **Daily cap per teacher** — a number.

---

## 7. Build order, once those are settled

1. Migration: `generation_usage` (+ `generated_at` if decision 4 says yes).
2. Edge Function skeleton: JWT → `is_allowed_teacher()` → rate-limit check →
   501. Deployable and testable before any model call.
3. Zod → JSON Schema derivation, with tests.
4. The generation call, with structured outputs and streaming.
5. Validate-and-repair, with fixture tests.
6. The form on My quizzes, and the handoff into the editor.
7. Per-question **Regenerate** in the editor.
8. README: the new setup step.

Steps 1–3 are worth doing first and merging on their own — they are the parts
with no API dependency and the parts that tests can actually cover.
