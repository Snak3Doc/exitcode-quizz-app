# ExitCode

A live classroom quiz app for practising programming. A teacher signs in,
builds quizzes with syntax-highlighted code, and hosts one on a projector.
Students join on their laptops with a 6-character code and a name — no account
needed — and see results and a leaderboard after every question.

The full design is in [`resources/SPEC.md`](resources/SPEC.md); the screens are
drawn in [`resources/WIREFRAME.md`](resources/WIREFRAME.md).

## How it works

Only quizzes are stored. **Games exist only while they are running and nothing
from a game is saved.**

The host's browser runs the game. It loads the quiz with its correct answers,
hands out questions over a Supabase Realtime channel named after the share
code, marks every answer and builds the leaderboard. Students never touch the
database, so they cannot read correct answers early.

```
Teacher ──sign in──▶ My quizzes ◀──▶ Quiz editor
                          │
                        Host (after checks)
                          ▼
                  Lobby ─▶ Question ─▶ Results ─▶ … ─▶ Final
                          ▲             │
Students ──join code──────┘             └──▶ their own result screen
```

## Running it locally

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>. Teachers get there from the **Sign in as
teacher** link under the join form, or by going straight to `/teacher`. The
link gives nothing away: `allowed_teachers` and the row-level security policies
decide who can read and write, so a student who follows it can sign in and
still see nothing.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm test` | The whole test suite |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built site |

## Setup you have to do by hand

The app will not work until these are done. Each one needs a person in a
website or dashboard.

### 1. Supabase project

Create a free Supabase project (region Singapore is closest to Vietnam). In
the security options leave **Enable Data API** and **Enable automatic RLS**
ticked, and leave **Automatically expose new tables** unticked — the migration
grants table access explicitly.

### 2. Environment values

Copy `.env.example` to `.env.local` and paste the real values from
**Project Settings → API**:

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon public key>
```

`.env.local` is git-ignored. Restart the dev server afterwards. Until this is
done both the sign-in and join screens say so plainly rather than failing with
a network error.

### 3. Database

Open the Supabase **SQL editor** and run the whole of
[`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql). It
creates the `quizzes`, `questions` and `allowed_teachers` tables, the
`is_allowed_teacher()` function, and the row-level security policies that keep
each teacher's quizzes private.

### 4. Approved teachers

The app is public on a link, so signing in is not enough. In the **Table
editor**, add a row to `allowed_teachers` with your email **in lowercase**.
Anyone not in this table can create an account but can read and write nothing —
the database enforces it, not the app. Add colleagues the same way.

### 5. Email sign-in

**Authentication → Sign In / Providers**: enable **Email** and make sure
**Confirm email** is ON. Without confirmation, someone could sign up using an
approved person's address without owning it.

Add these to the redirect URLs:

- `http://localhost:5173/teacher`
- `https://<your-site>/teacher` once it is deployed

> Supabase's built-in email sender is meant for testing and may only deliver to
> addresses in your Supabase organisation. Colleagues who do not receive their
> confirmation email should use Google sign-in instead, or you can add a custom
> SMTP provider.

### 6. Google sign-in

In the Google Cloud Console create an **OAuth client (Web application)**. Add
the callback URL shown in Supabase's Google provider settings as an authorised
redirect URI, then paste the client ID and secret into Supabase and enable
Google. Creating an OAuth client does not need billing.

### 7. Deploying

Import the repo into Vercel (Hobby plan), set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables, and deploy. `vercel.json`
already rewrites every route to `index.html`.

Afterwards add `https://<your-site>/teacher` to Supabase's redirect URLs, under
**Authentication → URL Configuration**, and set **Site URL** to the deployed
address. Without the redirect entry Google signs the teacher in and then sends
them somewhere else.

Google itself needs nothing new. The app asks Supabase to return to
`window.location.origin + '/teacher'`, so the redirect URI Google sees is
always the Supabase callback it already knows.

### 8. Quiz generation (optional)

A teacher can have an LLM draft a quiz from a prompt. The app works without
this; skip the section and nothing else changes.

Get a key from [Google AI Studio](https://aistudio.google.com/apikey) and put
it in `.env.local`:

```
GEMINI_API_KEY=your-key-here
```

That file is git-ignored, and because the name has no `VITE_` prefix Vite will
not put it in the browser bundle — which is the whole point. A key in the
bundle is readable by every student, and a scraped key quietly drains the day's
free quota, so the first teacher to try before a lesson finds generation dead
with no explanation.

Run [`supabase/migrations/002_generated_questions.sql`](supabase/migrations/002_generated_questions.sql)
in the SQL editor, then deploy the function that holds the key:

```bash
supabase login
supabase functions deploy generate-quiz --project-ref <your-ref> --use-api
supabase secrets set --env-file .env.local --project-ref <your-ref>
```

Two notes, both learned the hard way. `--use-api` bundles server-side, so you
do not need Docker running. And passing `--project-ref` means you can skip
`supabase link`, which otherwise asks for the database password you do not
need here.

To check it worked, this should answer `401` — deployed, and refusing anyone
who is not signed in:

```bash
curl -i -X POST https://<your-ref>.supabase.co/functions/v1/generate-quiz
```

> In PowerShell, `curl` is an alias for `Invoke-WebRequest` and will not take
> those flags. Use `curl.exe` instead, or run it from Git Bash.

Generated questions are a draft, never a finished quiz. Nothing in the app can
check that a generated snippet really prints what its answer claims, so the
editor marks them as unreviewed until you edit them, and the hosting checks
still apply.

### Before a class

Free Supabase projects pause after about a week of inactivity. Check the
project is awake in the dashboard before you teach.

## Testing a real game

Open the projector screen in one window and two or three students in separate
private windows or browser profiles. Worth trying: every question type, timed
and untimed, **Show results now**, a taken name, joining after Start, a student
refreshing mid-game, the host refreshing, every student leaving, and a
non-approved Google account being refused.

## How the code is laid out

| Path | What is in it |
| --- | --- |
| `src/strings.ts` | Every piece of UI text, in one place for translation later |
| `src/lib/types.ts` | Question and content shapes, and the realtime messages |
| `src/lib/schema.ts` | The shared Zod schema and `validateQuizForHosting()` |
| `src/lib/game-logic.ts` | Share codes, names, marking, scoring, leaderboards |
| `src/lib/host-engine.ts` | The game as a plain class — no React, no Supabase |
| `src/lib/channel.ts` | The Supabase Realtime channel wrapper |
| `src/lib/quizzes.ts`, `quiz-file.ts` | Database access, and `.quiz.json` import/export |
| `src/teacher/` | Sign in, My quizzes, the editor and the answer editors |
| `src/host/` | The projector screens |
| `src/student/` | Join and the in-game screens |
| `src/components/` | Code display, question display, shared pieces |
| `src/theme.css` | The dark terminal theme, as CSS variables |

The game logic and the host engine have no browser dependencies, so a whole
game can be played out in a unit test. That is where most of the test suite
lives; the teacher and student controls are covered by component tests that
drive them the way a person does.

## Deliberately not in version 1

No saved game history, no rejoining, no joining after Start, no phone layout,
no Vietnamese interface, no images or sound. `resources/SPEC.md` section 4
explains why each one was left out.

Because the game channel is shared, a technically skilled student could read
other students' submissions with browser tools. This is accepted for a small
supervised classroom.
