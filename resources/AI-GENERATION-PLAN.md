# Generating quizzes with an LLM — the plan

A design for turning a teacher's prompt into a quiz. Nothing here is built yet.

Five of the six open decisions are settled (§6). The sixth — the daily cap —
waits on step 0 of the build order, which is reading the real free-tier quota
rather than trusting a published figure.

This builds on `SPEC.md`; where it contradicts the spec, it says so.

---

## 0. The problem that comes first: there is no server

This has to be settled before any of the three questions in the brief, because
it decides where everything else lives.

ExitCode is a Vite single-page app. Everything in `src/` runs in the student's
or teacher's browser. Vite inlines `VITE_*` variables into the bundle at build
time — that is exactly why the Supabase anon key works the way it does, and why
changing it on Vercel needs a redeploy.

An LLM API key cannot go there. `VITE_GEMINI_API_KEY` would be sitting in plain
text in `assets/index-*.js`, readable by anyone who opens the site, including
every student in the room.

**A free key does not make this safe — it makes it worse.** The instinct is
that a leaked free key costs nothing, so who cares. But the free tier's limit
is a few hundred requests a day for the whole project (§5.1), and a scraped key
is found by bots within hours. The first teacher to try generating a quiz
before a lesson would find the day's quota already spent by strangers, with no
way to tell why. On a paid key the damage is a bill you can cap; on a free key
it is a tool that silently stops working.

So the feature needs somewhere server-side to hold the key.

### Options

| Where | Auth story | Verdict |
| --- | --- | --- |
| **Supabase Edge Function** | Already has the teacher's JWT; can call `is_allowed_teacher()` directly | **Recommended** |
| Vercel Serverless Function | Would have to verify the Supabase JWT by hand | Workable, more glue |
| Teacher pastes their own API key | Key still ends up in the browser; every teacher needs a billing account | No |

**Decided: a Supabase Edge Function.**

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

**Resolved by the spike, 2026-11-05: whole-quiz generation works.**

`scripts/spike-gemini-schema.ts` asked Gemini for a two-question mixed-type
quiz against the union schema and got back an `mc_single` with a proper
`options` array and an `order_lines` with its `lines` in the correct order,
each `content` matching its own declared `type`. The output is kept as a
fixture in `src/lib/generation.test.ts` and converts into questions that pass
`checkQuestion()` with no problems at all.

So the worry in §2.2 did not materialise, and the quota pressure that pushed
the other way mostly evaporates with it: **a quiz is one request, not ten.**
Even at the low end of the reported free-tier range that is a usable number of
quizzes a day.

Per-question regeneration is still built, for the reason it always was — it is
the repair path — but it is no longer load-bearing for the architecture.

---

## 2. Getting a usable shape back

### 2.1 Constrain the output with a schema, don't ask for JSON in prose

Whichever provider we land on, the mechanism is the same in principle: hand the
API a schema and have it constrain generation, rather than writing "reply in
JSON" in the prompt and parsing whatever arrives.

On the **Gemini API** that is `responseMimeType: "application/json"` plus
`responseSchema` on the generation config. On **OpenRouter** it is the
OpenAI-style `response_format` with a JSON Schema — but support is
**per-model**, not universal, so a free model has to be checked for it before
being chosen (§5.1).

Asking for JSON in the prompt is the fallback if neither is available for the
model we end up on, and it is a meaningfully worse fallback: it moves the whole
burden onto the validate-and-repair loop in §2.3.

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

**The union problem.** A quiz is an array of questions, and a question is a
discriminated union of six different `content` shapes. That is the hardest
thing to express in a constrained-decoding schema, and the schema dialects
these APIs accept are subsets of JSON Schema with their own limits on `anyOf`
and discriminators.

**Spiked, and it works.** Gemini accepted `anyOf` over three different content
schemas inside an array of questions, and filled each one in correctly against
its sibling `type` field. No `$ref`, no `allOf`, no `additionalProperties` —
the dialect handles a plain union of object schemas.

The fallbacks are recorded in case it ever stops working: generate one question
at a time with its type fixed, so each call has a single flat schema; or
failing that, flatten every type-specific field to optional and let
`checkQuestion()` do the real work.

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

**Decided: all six, from the start.** The six are not equally generatable:

- `mc_single`, `true_false`, `short_text` — straightforward.
- `mc_multi` — fine, but needs good distractors (§4.4).
- `fill_blank`, `order_lines` — **the risky two.** Fiddly formats that models
  get wrong in specific, predictable ways (§4.1, §4.2), and a free Flash-tier
  model will get them wrong more often than a paid one.

Including them from day one is the right call — they are much of what makes
ExitCode worth using over a generic quiz tool — but it moves work earlier
rather than removing it. Three things stop being optional:

- **The fixture tests in §5.8 become load-bearing**, particularly the
  pre-shuffled `order_lines` case, which passes every automated check we have.
- **The prompt rules in §4.1 and §4.2 are the feature**, not boilerplate. Worked
  examples, not a sentence of description.
- **Repair churn now costs quota** (§5.1), and these two types are what drives
  it. If the quota turns out to be at the low end of the reported range, this
  is the first thing to revisit.

One piece of luck: the editor already labels the order-the-lines answer "Lines
are in the CORRECT order here. Students see them shuffled." So the review
surface for the silent failure exists — it just depends on the teacher reading
it.

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
2. **Decided: mark generated questions as unreviewed.** A `generated_at` column
   on `questions`, cleared on the first manual edit, with a badge in the
   question list. Makes "which of these have I actually checked?" answerable a
   week later, which is exactly when a teacher comes back to a quiz they
   generated in bulk. Costs a migration, and that migration is now bundled with
   the one in §5.1.

   Worth being clear about what this does and does not do. It tracks whether a
   human *looked*, not whether the question is *right* — clearing on first edit
   is a proxy, and a teacher who tweaks a typo clears the flag without checking
   the answer. It is a memory aid, not a guarantee.

Worth noting the existing hand-written quiz has a question whose lines print
`0, 1, 2, 4` under a prompt asking for `0, 1, 2, 3, 4`. Human-authored. Review
matters either way; this feature just makes more questions arrive at once.

---

## 5. Everything else that will bite

### 5.1 Quota, not cost

**Decided: this stays a free tool.** So the scarce resource is not money, it is
**requests per day**, and that changes the shape of the problem. A paid API
degrades gracefully as you use more of it; a free tier stops dead.

#### The two candidates

| | Gemini API (Google AI Studio) | OpenRouter free models |
| --- | --- | --- |
| Schema-constrained output | First-class: `responseSchema` | **Per-model** — must be checked |
| Free request cap | Per-project, published only in the AI Studio console | Officially 20/min and **50/day**, rising to 1,000/day after $10 of credit |
| Model stability | Pick a model, it stays | Free list **rotates**; models come and go |
| Failure mode | Quota exhausted | 429s from provider-side throttling at peak, and failed calls may still count |

**Recommendation: Gemini, on a Flash model**, with OpenRouter as the fallback.
Three reasons: schema-constrained output is documented and first-class rather
than per-model roulette, the free allowance appears materially larger, and the
model does not vanish from under us mid-term. A classroom tool that breaks
because a free model was delisted is worse than one that was never built.

#### The numbers are not trustworthy yet

This matters more than the recommendation. Google does not publish the free
tier's limits as a table in its API docs — they are per-project and shown in
AI Studio's own rate-limit page. Third-party write-ups for Flash models
disagree wildly, from about 20 requests a day to 1,500, and at least one report
has a project linked to billing staying pinned at the low end.

**So step one is to open AI Studio and read the actual limit for the actual
project.** Everything below depends on that number and nothing should be built
on a blog's figure.

#### What the cap does to the design

Once the real number is known, it decides things the plan currently leaves
open:

- **Whole-quiz versus per-question (§1).** At one request per quiz, almost any
  cap works. At ten requests per quiz, a 50/day cap is five quizzes a day for
  *everyone combined*.
- **There is no app-level counter.** An earlier draft had a `generation_usage`
  table counting requests per day. Dropped, for a reason worth keeping: our
  count could not match the truth. Failed calls may count against the provider,
  the quota is per project rather than per user, and anything else sharing the
  key spends from the same pool. A counter that drifts is worse than no counter,
  because it refuses work that would have succeeded.

  So the provider's own 429 is the signal, and the function turns it into a
  plain message. If one teacher ever does exhaust the day for the rest, a
  fairness cap can be added then — but that is a sharing problem, not a quota
  problem, and it should not be solved before it exists.
- **Repair retries cost quota too.** The one-retry cap from §2.3 stops being a
  cost control and becomes a quota control.

Still needed regardless:

- A per-request question cap well below the schema's 50. **20 is a sensible
  ceiling.**
- Graceful behaviour when the quota is gone: a plain "generation is unavailable
  until tomorrow" message, never a raw 429. The teacher can still build quizzes
  by hand, which is the whole existing app.

#### What the free tier actually feels like

The spike turned up something the published limits do not mention. Asking for
one small question on 2026-11-05:

- `gemini-3.8-flash` — 503, twice, five seconds apart
- `gemini-3.7-flash` — 503, and once a connection that was accepted and then
  never answered, which killed the script until it was given a timeout
- `gemini-3.6-flash` — 503
- `gemini-3.5-flash` — answered

So the newest free models are congested, and the failure is not the clean 429
the plan assumed. Three consequences for the Edge Function:

- **Try a list of models, newest first, not one.** The fallback is what got an
  answer at all. A teacher should not see generation fail because the newest
  model was busy when an older one was free.
- **Set an explicit request timeout.** An overloaded model accepts the
  connection and then goes quiet; without a timeout that surfaces minutes
  later as an unhandled error.
- **Treat 503 like 429 for the teacher.** Both mean try later. The wording in
  §5.1 covers both; the function should not expose the difference.

Also worth knowing: a retired model stays in the models list and 404s only when
called, with its replacement named in the error. `gemini-2.5-flash` did exactly
that. Reading `supportedGenerationMethods` is not enough to pick a model.

#### One thing to check before committing

Free tiers often differ from paid ones in how submitted data may be used. For a
teacher typing "year 9 Python loops" the stakes are low, but this is a school
tool, so it is worth reading the current terms rather than assuming. **Not
verified here.**

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

**Decided: English only for now.**

`SPEC.md` rules out a Vietnamese *interface* for v1. Generated *content* was a
separate question, since the classes are in Vietnam.

An earlier draft of this plan called it "awkward to retrofit once teachers have
quizzes". That was wrong, and the correction is why English-only is a safe
choice rather than a closing door: **nothing stores a language.** It would be a
generation-time prompt parameter and nothing more, so adding the field later
costs a form field and a prompt line — the same as adding it now. No migration,
no effect on existing quizzes.

Nothing in the app blocks Vietnamese content today either: prompts are free
text and the name rule already accepts any Unicode letter. So this is a
scope decision for the first version, not a constraint on the design.

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

## 6. Decisions

Five of the six are settled.

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Server side | **Supabase Edge Function** (§0) |
| 2 | Model | **Free only** — Gemini on a Flash model, OpenRouter as fallback (§5.1) |
| 3 | Default question types | **All six from the start** (§3) |
| 4 | Generated-question flag | **Yes** — `generated_at`, cleared on first edit (§4.7) |
| 5 | Content language | **English only for now** (§5.6) |
| 6 | Daily cap | **No cap of our own** — handle the provider's refusal (§5.1) |

**Decision 6 turned out not to need a number.** The question was what daily cap
to set, and the answer is none: the provider enforces its own limit
authoritatively and we cannot shadow it accurately (§5.1).

What matters instead is the behaviour when it runs out, and that is decided —
the teacher is told the day's generation is used up, and that they can try
again tomorrow or build the quiz by hand. Never a raw 429. The app without
generation is the whole app as it exists today, so this is a degraded feature
rather than a broken tool, and the message should sound like it.

---

## 7. Build order, once those are settled

**Done** (first PR on `ai-quiz-generation`):

1. ~~Migration `002`: `questions.generated_at`.~~
2. ~~Edge Function shell: CORS, JWT, `is_allowed_teacher()`, then 501.~~
3. ~~The Gemini response schema, and the conversion from what the model returns
   into what the app stores, with tests.~~

**Next:**

4. ~~**The spike.**~~ Done, 2026-11-05 — `scripts/spike-gemini-schema.ts`. The
   union works, so generation is **one request per quiz** (§1, §2.2). It also
   turned up how the free tier actually fails, which changes what the function
   has to handle (§5.1). Still outstanding from it: reading the real quota in
   AI Studio, which nothing is blocked on now that a quiz costs one request.
5. The generation call itself, schema-constrained and streamed, plus turning
   the provider's 429 into the message in §5.1.
6. The repair pass for questions that fail `checkQuestion()`, capped at one
   retry.
7. The form on My quizzes, and the handoff into the editor.
8. Per-question **Regenerate** in the editor.
9. README: the new setup step, and `supabase secrets set GEMINI_API_KEY`.

Steps 1–3 had no API dependency and are the parts the test suite can cover, so
they went first and stand alone. Everything from 5 onwards needs the key.
