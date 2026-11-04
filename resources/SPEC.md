Markdown · SPEC.md

# ExitCode — Project Spec

> **ExitCode** is the working title. Define it once as a constant (`APP_NAME = "ExitCode"` in `src/strings.ts`) and use that constant everywhere the app name is shown (page title, headers, sign-in and join screens), so it can be changed in one place if the name changes. The name comes from a program finishing successfully with exit code `0`.

## 1. Overview

A live classroom quiz web app for practising programming. A teacher signs in, builds quizzes (including questions and answers that contain syntax-highlighted code), and hosts one on a projector. Students join on their own laptops with a 6-character share code and a name (no account), answer each question, and see results and a leaderboard after every question.

Audience: one teacher (Ben) plus any colleagues he approves, and classes of 1 to 8 students on laptops. The one thing it must do well is run a smooth live game where code questions are easy to read and answer.

Only teachers have accounts. Only quizzes are stored. Games exist only while they are running and nothing from a game is saved.

## 2. Tech Stack

Everything is free tier with no credit card required.

| Area | Choice | Why it fits |
| --- | --- | --- |
| Language | TypeScript | Shared types for the realtime messages and the question data shapes prevent a whole class of bugs. |
| Frontend | React 18 + Vite + React Router | Good for a UI that updates live as answers arrive. Static build, so it deploys free anywhere. |
| Syntax highlighting | `highlight.js` (core build, register only `python`, `javascript`, `xml` for HTML, `css`, `plaintext`) | Small, works on static text, easy to theme dark. |
| Drag and drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Used for reordering questions, order-the-lines editor, and the student order-the-lines answer. Works with keyboard too. |
| Styling | Plain CSS with CSS variables (no CSS framework) | Terminal theme needs a small, consistent set of tokens; no extra tooling. |
| Backend | None of our own. Supabase only | No server to run or pay for. |
| Database | Supabase Postgres | Stores teachers' quizzes and questions plus the allowed-teachers list. Row-level security keeps each teacher's quizzes private. |
| Auth | Supabase Auth: email + password (with email confirmation) and Google sign-in | Both sign-in options Ben asked for. Google sign-in is the easy option for colleagues. |
| Live game | Supabase Realtime: Broadcast + Presence | Students never touch the database. The host's browser runs the game and talks to students over a realtime channel named after the share code. Presence detects who is connected. |
| Hosting | Vercel (Hobby plan), deployed from a GitHub repo | Free, no credit card, pairs well with a Vite app and Supabase. |
| Testing | Vitest for the pure game logic | Scoring and marking are easy to get subtly wrong and easy to unit test. |

Supabase region: choose Singapore (closest to Vietnam) unless Ben prefers Sydney.

## 3. Core Features (v1 scope)

### 3.1 Teacher: accounts

- **Sign in** with Google or email + password. Email sign-up requires email confirmation (Supabase "Confirm email" must be on). Sign-in is not possible until the email is confirmed.
- **Approved teachers only.** After any sign-in the app calls the database function `is_allowed_teacher()`. If it returns false, the app signs the user out and shows "This email isn't on the approved teacher list." The same rule is enforced by the database for every read and write (section 5), so hiding screens is not the protection.
- **Sign out** button in the top bar.
- Email matching is case-insensitive.

### 3.2 Teacher: My quizzes

- List of the signed-in teacher's own quizzes only, newest edited first: title, question count, last edited.
- Toolbar: **+ New quiz** (creates an untitled quiz and opens the editor), **Import quiz file**.
- Per quiz: **Host**, **Edit**, **Duplicate**, **Export**, **Delete**.
- **Delete** shows an inline confirmation in the row ("Delete this quiz? This can't be undone." with Cancel and Delete). It is never a browser dialog.
- **Duplicate** copies the quiz and all its questions into a new quiz titled "Copy of {title}" (truncated to 100 characters) and refreshes the list.
- **Export** downloads a `.quiz.json` file (format in 5.4).
- **Import** accepts a `.quiz.json` file up to 1 MB, validates it with the same rules as the editor, and creates a new quiz owned by the importer. On any problem it shows what is wrong ("Question 3: missing correct answer") and creates nothing.
- Empty state: "No quizzes yet. Click '+ New quiz' or import a quiz file."
- **Host** runs the hosting checks (3.5) first. If the quiz is incomplete, the row shows the problems with a link to the editor and the game is not created.

### 3.3 Teacher: quiz editor

- Quiz title (1 to 100 characters).
- **Autosave**: changes save automatically about one second after typing stops. A tag shows "Saving…" then "Saved". Drafts with incomplete questions can always be saved.
- Question list (left): each row shows position, prompt preview, type tag, drag handle, duplicate and delete buttons. Drag to reorder (positions rewritten as 0..n-1). Duplicate inserts a copy directly after the original. Delete removes immediately with an inline confirm. **+ Add question** appends a new question (default type: multiple choice, one answer). Maximum 50 questions per quiz (enforced in the UI and the importer).
- Question form (right), in this order:
  1. Question type dropdown (changing type resets the answer area after a confirm if it already has content).
  2. Question text (required to host, max 2000 characters).
  3. Optional single code block: language dropdown (Python, JavaScript, HTML, CSS, Plain text), code textarea (max 4000 characters) with a live syntax-highlighted preview. "Remove code block" clears it.
  4. Answer area (changes by type, see 3.4).
  5. Timing: radio **Wait for everyone** or **Timed**. Timed shows a seconds number box (whole number 5 to 300, default 30) and quick-pick buttons 10, 20, 30, 60, 120.
  6. Optional explanation (max 2000 characters), shown on the results screen.
- **Host this quiz** button in the top bar runs the hosting checks (3.5).

### 3.4 Question types

Each question is exactly one of these. Option order is always the order the teacher wrote.

1. **Multiple choice, one answer** (`mc_single`): 2 to 6 options, exactly one correct. Each option is either **Text** or a **Code block** (with its own language). Students pick one (radio buttons). Options are shown lettered A to F.
2. **Multiple choice, several answers** (`mc_multi`): 2 to 6 options, one or more correct. Same option editing as above. Students tick every option that applies (tick boxes). The student screen says "Select all that apply".
3. **True / False** (`true_false`): two fixed options; the teacher picks the correct one. Students see two big buttons (clicking one selects it; Submit locks it).
4. **Short text answer** (`short_text`): 1 to 10 accepted answers (each 1 to 100 characters) and a **Case-sensitive** tickbox (off by default). Students type an answer.
5. **Fill in the blank (code)** (`fill_blank`): a code snippet where blanks are written as `{{1}}`, `{{2}}` and so on, plus a **word bank** and the correct word for each blank. Students pick a word from a dropdown at each blank. The dropdown lists the word bank in the teacher's order.
6. **Order the lines** (`order_lines`): the teacher lists 2 to 12 lines of code in the correct order (drag to reorder). Students see the lines shuffled and drag them into order. Indentation is part of each line and is fixed; students only decide the order.

**Code blocks with text:** every question can combine text with one code block. Multiple choice options can each be text or code. This is the full extent of v1 layout flexibility (a free-form stack of blocks is a stretch goal).

### 3.5 Hosting checks (before a game can be created)

Hosting is blocked until all of these pass. Each failure is listed with the question number and a link to it:

- The quiz has at least one question.
- Every question has non-empty text.
- If a code block exists, its code is non-empty.
- Timed questions have 5 to 300 seconds.
- `mc_single` / `mc_multi`: 2 to 6 options, every option has non-empty text or code; `mc_single` has exactly one correct; `mc_multi` has at least one correct.
- `short_text`: at least one non-empty accepted answer.
- `fill_blank`: snippet is non-empty; blanks are numbered 1..n with no gaps and each number appears exactly once; at most 6 blanks; word bank has 2 to 12 unique non-empty words (each up to 30 characters); every blank has a correct word that is in the bank.
- `order_lines`: 2 to 12 lines, none empty.

### 3.6 Game flow (teacher and projector)

The projector screen is the teacher's laptop connected to the projector. All teacher controls live on that screen. Games are discarded when they end.

1. **Create game.** Clicking Host (after checks) loads the full quiz including correct answers into the host browser, generates a share code (3.8), opens the realtime channel, and shows the **Lobby**.
2. **Lobby.** Shows the site address, the share code in large type, the quiz title and question count, and the list of joined players (updates live). Buttons: **Start game** (disabled until at least one player has joined) and **Cancel game** (ends the game, returns to My quizzes). Joining closes when Start is clicked.
3. **Question.** Shows "Question N of M", type tag, the countdown (timed questions only), "X of Y submitted", the question text and code, the answer content for the type (no correct answers shown), a strip of every player with ✓ submitted or "waiting…", and a **Show results now** button.
4. **The question ends** (and results appear) as soon as any one of these happens:
   - Every connected player has submitted (applies to both Wait-for-everyone and Timed questions).
   - The timer reaches zero (timed only).
   - The teacher clicks **Show results now**. If there are zero players connected, the question does not auto-end; the teacher can still click Show results now.
5. **Results.** Shows the correct answer (the full correct set, snippet or line order for the type), the explanation if one was written, and the leaderboard: rank, name, result for this question with points earned, total score. Result marks: ✓ fully correct, ½ partial credit, ✗ answered but zero points, "– no answer". Button **Next question** (on the last question it says **Finish game**).
6. **Final.** Final leaderboard (top three highlighted, everyone else listed) and **Back to my quizzes**. Nothing is saved.

### 3.7 Game flow (student)

- **Join screen** at the site's home page: game code box, name box, **Join game**. Errors, one at a time under the button: "We can't find a game with that code." / "That name is taken. Pick another." / "This game has already started." / "This game is full." / "Couldn't reach the game. Try again." / name format errors (3.9).
- **Waiting room**: "You're in, {name}", "Waiting for the teacher to start…", and the list of joined players.
- **Question screen**: top bar with name, "Question N of M", countdown (timed only); the full question text and code; the answer controls for the type; **Submit answer** (disabled until the answer is valid: one option chosen, at least one ticked, true/false chosen, non-empty text, every blank chosen; order-the-lines is always valid because the shuffled order counts as an answer).
- **After submitting**: "Answer submitted", "Waiting for the others… (4 of 5)". Answers can't be changed.
- **Result screen**: heading "Correct!", "Partly correct", "Not quite" or "No answer"; points ("+1000 points · +350 speed bonus"); the correct answer; explanation if any; "Your rank: 2nd" and total; "Waiting for the teacher to continue…".
- **Final screen**: "Game over", "You finished 2nd with 8970 points", **Join another game** (goes to the Join screen).
- **Disconnected screen** ("You've left this game. You can't rejoin a game that has started.") and **Teacher left screen** ("The game has ended. The teacher closed the game.") each with **Back to join screen**.

### 3.8 Share codes

- 6 characters, generated with `crypto.getRandomValues`, from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (leaves out `I`, `L`, `O`, `0`, `1`).
- A new code for every game. The code is the realtime channel name `game:<CODE>`.
- Before using a code the host checks that no host is already present on that channel; if one is, generate another.
- Input is case-insensitive and spaces are stripped. The code stops working when the game ends.

### 3.9 Student names

- Trimmed, internal runs of spaces collapsed to one, Unicode NFC normalised, 1 to 20 characters.
- Allowed: letters (any language, so Vietnamese diacritics work), combining marks, numbers, spaces and these punctuation marks: `. , ' - _ !`. Regex (with the `u` flag): `^[\p{L}\p{M}\p{N} .,'_!-]{1,20}$`.
- Names must be unique within a game, compared case-insensitively. A taken name is rejected at join with "That name is taken. Pick another."
- There is no rejoining (3.10), so a name only has to be unique among players currently in the game.

### 3.10 Disconnects and who can join when

- **No joining after Start.** New joins get "This game has already started."
- **No rejoining.** A student who refreshes or loses connection mid-game cannot get back in. Their old player is removed from the game after a 10-second grace period (so a momentary wifi blip does not remove them), after which they disappear from the projector and leaderboard and stop blocking the "everyone has submitted" check. The grace length is a single constant (`DISCONNECT_GRACE_MS = 10000`).
- If a removed student's page is still open and reconnects, the host tells that client it was removed and it shows the Disconnected screen. If they refresh instead, the game page remembers it was in a game (see 12) and shows the Disconnected screen.
- **Teacher disconnect ends the game.** If the host's tab is refreshed or closed, the game is over and nothing is saved. Students whose page notices the host is gone for more than 10 seconds show the Teacher left screen (unless they are already on the Final screen). Refreshing the host page creates a brand new game with a new code.

### 3.11 Marking and scoring

All marking happens in the host's browser using the quiz it loaded.

**Base points** per question: `round(1000 × fraction)` where `fraction` is 0 to 1:

| Type | Fraction |
| --- | --- |
| `mc_single`, `true_false`, `short_text` | 1 if correct, else 0 |
| `mc_multi` | `max(0, (correctTicked − wrongTicked) / totalCorrect)`. A wrong tick removes one correct tick's worth. Never below 0. |
| `fill_blank` | `correctBlanks / totalBlanks`. Wrong blanks subtract nothing. |
| `order_lines` | `linesInCorrectPosition / totalLines`, comparing the line text at each position (identical lines are interchangeable). |

No answer scores 0.

**Speed bonus:** timed questions only, and only when `fraction == 1`. `bonus = round(500 × (1 − elapsed / limit))`, clamped between 0 and 500, so it shrinks evenly from 500 at the start to 0 at the deadline. `elapsed` is measured by the host: time from the moment it broadcast the question to the moment it received that player's submission. Wait-for-everyone questions never have a bonus.

**Question points** = base + bonus. **Total** = sum of question points.

**Short text matching:** normalise both the student's answer and each accepted answer by trimming and collapsing runs of spaces into one; unless Case-sensitive is ticked, also lowercase both. Correct if the normalised answer equals any normalised accepted answer.

**Leaderboard order and ties:** total descending, then name ascending for display. Players with equal totals share a rank using standard competition ranking (1, 2, 2, 4).

## 4. Stretch Goals

Left out of v1 on purpose:

- **Saved game history and per-question analytics.** Ben chose no saved results; keeps the data model and privacy simple.
- **Rejoining and switching laptops.** Dropped to keep the realtime logic simple. Class sizes are small and stakes are low.
- **Teacher "remove player" button in the lobby.** Not needed without rejoining.
- **Shuffled options per student.** Option letters must match the projector for class discussion.
- **Speed bonus on untimed questions.** Would pressure students on questions meant for careful reading.
- **Free-form question layout** (any number of text and code blocks in any order). One optional code block covers most questions.
- **Typing into fill-in-the-blank code.** Word bank is easier to mark and quicker to answer.
- **Auto-advance after results.** Teacher clicks Next to leave time for discussion.
- **Vietnamese interface.** English only for v1; keep all UI text in one file so translation is easy later.
- **Phone layout.** Students use laptops only.
- **Images in questions, sound effects, more code languages.**
- **Teacher UI for managing the approved-teachers list.** Ben edits the table in the Supabase dashboard.
- **Blocking sign-ups from non-approved emails at the auth level** (for example a Supabase "before user created" auth hook, if available on the free plan). In v1 non-approved people can create an auth account but can read and write nothing.

## 5. Data Model

Only two things are stored: quizzes and questions (plus the allowed-teachers list). No games, players, answers or results are stored.

### 5.1 SQL

Run this as one migration in the Supabase SQL editor.

```sql
-- ===== Allowed teachers (managed by hand in the Supabase dashboard) =====
create table public.allowed_teachers (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.allowed_teachers enable row level security;
-- No policies on purpose: nobody can read or write this table through the API.
revoke all on public.allowed_teachers from anon, authenticated;

create or replace function public.is_allowed_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_teachers
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed_teacher() from public, anon;
grant execute on function public.is_allowed_teacher() to authenticated;

-- ===== updated_at helper =====
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== Quizzes =====
create table public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'Untitled quiz' check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quizzes_owner_idx on public.quizzes (owner_id, updated_at desc);
create trigger quizzes_updated_at before update on public.quizzes
  for each row execute function public.set_updated_at();

alter table public.quizzes enable row level security;
revoke all on public.quizzes from anon;

create policy quizzes_select_own on public.quizzes for select to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_insert_own on public.quizzes for insert to authenticated
  with check (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_update_own on public.quizzes for update to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher())
  with check (owner_id = auth.uid() and public.is_allowed_teacher());
create policy quizzes_delete_own on public.quizzes for delete to authenticated
  using (owner_id = auth.uid() and public.is_allowed_teacher());

-- ===== Questions =====
create table public.questions (
  id                 uuid primary key default gen_random_uuid(),
  quiz_id            uuid not null references public.quizzes(id) on delete cascade,
  position           integer not null check (position >= 0),
  type               text not null check (type in
                       ('mc_single','mc_multi','true_false','short_text','fill_blank','order_lines')),
  prompt             text not null default '' check (char_length(prompt) <= 2000),
  code               text check (code is null or char_length(code) <= 4000),
  code_language      text check (code_language in ('python','javascript','html','css','plaintext')),
  timing_mode        text not null default 'wait' check (timing_mode in ('wait','timed')),
  time_limit_seconds integer check (time_limit_seconds between 5 and 300),
  explanation        text check (explanation is null or char_length(explanation) <= 2000),
  content            jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((code is null) = (code_language is null)),
  check ((timing_mode = 'timed') = (time_limit_seconds is not null))
);
create index questions_quiz_idx on public.questions (quiz_id, position);
create trigger questions_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

alter table public.questions enable row level security;
revoke all on public.questions from anon;

create policy questions_select_own on public.questions for select to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_insert_own on public.questions for insert to authenticated
  with check (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_update_own on public.questions for update to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()))
  with check (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
create policy questions_delete_own on public.questions for delete to authenticated
  using (public.is_allowed_teacher() and exists (
    select 1 from public.quizzes q where q.id = questions.quiz_id and q.owner_id = auth.uid()));
```

Ordering: always `order by position, created_at`. There is deliberately no unique constraint on `(quiz_id, position)`; the app rewrites positions 0..n-1 for the whole quiz after any reorder, add, duplicate or delete.

### 5.2 Access rules in plain words

| Table | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `allowed_teachers` | Nobody via the API. Read only through `is_allowed_teacher()`. | Nobody via the API (Ben uses the Supabase dashboard). | Nobody via the API. | Nobody via the API. |
| `quizzes` | Signed-in approved teacher, own rows only | Signed-in approved teacher, with `owner_id` = their own id | Own rows only; cannot change owner | Own rows only (questions cascade) |
| `questions` | Approved teacher, only if they own the parent quiz | Approved teacher, only into a quiz they own | Only in quizzes they own; cannot move a question into someone else's quiz | Only in quizzes they own |

Students and anonymous visitors have no database access at all. Students only use the realtime channel. Because the host's browser holds the answers and sends students questions without correct answers, a student can never read correct answers from the database.

### 5.3 `questions.content` shapes (by `type`)

The app validates these with one shared schema (for example Zod) in the editor, hosting checks and importer. Drafts may be incomplete, so the database only requires an object.

```jsonc
// mc_single and mc_multi
{
  "options": [
    { "id": "o1", "kind": "text", "text": "0 2 4", "correct": true },
    { "id": "o2", "kind": "code", "language": "python", "text": "len(items)", "correct": false }
  ]
}
// 2 to 6 options. kind "text": text up to 500 characters. kind "code": language required,
// text up to 1000 characters. mc_single: exactly 1 correct. mc_multi: 1 or more correct.

// true_false
{ "correct": true }

// short_text
{ "accepted": ["len", "len()"], "caseSensitive": false }
// 1 to 10 accepted answers, each 1 to 100 characters.

// fill_blank
{
  "language": "python",
  "snippet": "for i in {{1}}(3):\n    {{2}}(i)",
  "wordBank": ["range", "print", "len"],
  "answers": { "1": "range", "2": "print" }
}
// Snippet up to 2000 characters. Blanks {{1}}..{{n}}, n up to 6, each exactly once.
// Word bank 2 to 12 unique words, each up to 30 characters. Every answer is in the bank.
// The same word may be the answer to more than one blank.

// order_lines
{
  "language": "python",
  "lines": [
    { "id": "l1", "text": "def greet(name):" },
    { "id": "l2", "text": "    return \"Hi \" + name" },
    { "id": "l3", "text": "print(greet(\"Sam\"))" }
  ]
}
// 2 to 12 lines in the CORRECT order, each 1 to 120 characters. Leading spaces are kept.
```

For `fill_blank` the snippet lives in `content`. The question's optional `code` block is separate and can add extra context.

### 5.4 Quiz export file (`.quiz.json`)

```jsonc
{
  "format": "classroom-quiz",
  "version": 1,
  "title": "Python basics: loops",
  "questions": [
    {
      "type": "mc_single",
      "prompt": "What does this code print?",
      "code": "for i in range(3):\n    print(i * 2)",
      "codeLanguage": "python",
      "timingMode": "wait",
      "timeLimitSeconds": null,
      "explanation": "range(3) gives 0, 1, 2, so i * 2 gives 0, 2, 4.",
      "content": { "options": [ /* as in 5.3 */ ] }
    }
  ]
}
```

Array order is the question order. Import ignores unknown fields, rejects a wrong `format` or newer `version`, and caps at 50 questions.

## 6. Core Logic & Business Decisions

- **Host's browser runs the game.** Nothing about a game is saved, so there is no need for a server or a database in the live path. This keeps the build small and free. The cost is that the game is only as reliable as the teacher's laptop and wifi, which Ben accepted ("this isn't that high stakes").
- **Students never talk to the database.** They only join a realtime channel. Correct answers stay in the host's browser until the results are broadcast, so students can't read them early.
- **Approved-teachers table, enforced in the database.** The app is public on a link, so signing in is not enough. Row-level security with `is_allowed_teacher()` stops strangers using Ben's free-tier allowance. Google sign-in works for approved teachers whenever their Google email matches the table.
- **Email confirmation must stay on.** Otherwise someone could sign up with an approved person's email without owning it.
- **Both Wait-for-everyone and Timed questions end early once everyone has submitted.** Ben chose this over always waiting out the timer.
- **Speed bonus only on timed questions, and only for fully correct answers.** Untimed questions are for careful reading; bonus on partial answers would reward guessing.
- **Partial credit everywhere it makes sense** (multi-answer, order the lines, fill in the blank), scaled on the 1000 base points, so all question types follow one rule. Wrong ticks on multi-answer questions subtract so students can't tick everything.
- **Answers lock on submit.** Simple, fair, and the "who has submitted" display and speed bonus mean something.
- **Option order is fixed as written** so teacher and students can say "look at B". Order-the-lines starts shuffled (never in the correct order when the lines are distinct).
- **Indentation in order-the-lines is fixed.** Students only decide order, which keeps the question about logic and keeps the editor simple.
- **No rejoining, no joining after Start.** Much simpler realtime logic; a 10-second disconnect grace stops a brief wifi blip from ejecting someone.
- **Teacher disconnect ends the game.** Simpler than resuming state; a new game gets a new code.
- **Fresh share code per game** so two classes can run the same quiz without clashing and old codes never stay joinable.
- **Dropdown word bank for fill-in-the-blank** (not typing) because it is quick to answer and trivial to mark.
- **Player names:** Unicode letters are allowed because students may use Vietnamese names; unique case-insensitively because there is no other identity.
- **Host timestamps decide the speed bonus**, not student clocks, so skewed laptop clocks can't change scores.
- **Hosting is blocked on incomplete quizzes** so problems are found at the teacher's desk, not in front of the class.

## 7. External Services / APIs

| Service | Used for | Notes |
| --- | --- | --- |
| Supabase Auth | Teacher sign-in (email + password, Google) | Free tier. Confirm-email must be ON. Keep Supabase's default "secure email change" on. |
| Supabase Postgres | Quizzes, questions, allowed teachers | Free tier. Free projects pause after about a week of inactivity; restore from the dashboard before class if needed. |
| Supabase Realtime (Broadcast + Presence) | Live game between host and students | Free tier limits (concurrent connections, messages per second) are far above 1 to 8 students. |
| Google Cloud Console (OAuth client) | "Continue with Google" | Creating an OAuth client does not need billing. |
| Vercel (Hobby) | Hosting the static site | Free, no credit card. Hobby is for non-commercial use, which suits a classroom tool. |
| GitHub | Source repo, Vercel deploys from it | Free. |
| Email sending for confirmation emails | Email + password sign-up | See 12: Supabase's built-in email sender is limited. Colleagues can use Google sign-in instead, or a free custom SMTP provider can be added. |

## 8. Look & Feel

Ben's direction: **dark, code editor, programmer, terminal-esque.**

Dark theme only (no light theme). The builder's suggestions to fill in the details, all open to Ben's changes:

- Near-black background with off-white text and one accent colour (a terminal green or amber).
- Monospace for everything or at least headings, labels, buttons and code. A free Google Font such as JetBrains Mono or Fira Code works.
- Terminal touches: a `>` or `$` before headings, a blinking cursor in inputs and next to the share code, options shown as `[A]`, `[B]`, bordered "windows" with a small title bar.
- Semantic colours for results that don't clash with the accent: green for correct, red for wrong, amber for partial. Never rely on colour alone: results always also show ✓ / ½ / ✗ / –.
- Syntax highlighting with a dark highlight.js theme (for example `github-dark` or `atom-one-dark`).
- The projector screens must be readable from the back of a classroom: large type that scales with the screen (use `clamp()`), big share code, high contrast.
- Visible keyboard focus on every control.

## 9. Screens & Layout

This is the confirmed wireframe. Styling lives in section 8.

### Routes

| Route | Screen |
| --- | --- |
| `/` | Student: Join |
| `/play/:code` | Student: game (waiting room, question, result, final, disconnected, teacher left) |
| `/teacher` | Teacher: Sign in (when signed out) or My quizzes (when signed in) |
| `/teacher/quiz/:quizId` | Teacher: Quiz editor |
| `/teacher/host/:quizId` | Projector: game (lobby, question, results, final) |

The Join screen has no link to the teacher area; teachers bookmark `/teacher`. Vercel needs a rewrite so every route serves `index.html`.

### Teacher screens

**Sign in** (`/teacher`, signed out). Narrow centred column.

- Header region: app name (ExitCode).
- Sign-in card: "Continue with Google" button; "or"; email field; password field; **Sign in** button; **Create account with email** button. After email sign-up: "Check your inbox to confirm your email."
- Message area, shown only after a failed sign-in: "This email isn't on the approved teacher list."

**My quizzes** (`/teacher`, signed in).

- Top bar: app name (ExitCode) left; signed-in email and **Sign out** right.
- Toolbar: **+ New quiz**, **Import quiz file**.
- Quiz list rows: title and "N questions · edited {when}" on the left; **Host**, **Edit**, **Duplicate**, **Export**, **Delete** on the right. Inline delete confirmation. Inline hosting-check problems with a link to the editor.
- Empty state box when there are no quizzes.

**Quiz editor** (`/teacher/quiz/:quizId`).

- Top bar: **← My quizzes**, quiz title field, save tag ("Saved"), **Host this quiz**. Hosting-check problems appear in a banner under the top bar.
- Two columns (stack on narrow widths).
  - Left, question list: rows with drag handle, "N. {preview}", type tag, duplicate and delete icons; the open question is bold; **+ Add question** at the bottom.
  - Right, question form in this order: question type dropdown; question text; optional code block box (language dropdown, **Remove code block**, code field, highlighted preview); answer area; timing (Wait for everyone / Timed, seconds box, quick-pick buttons 10 20 30 60 120); explanation (optional).
- Answer areas by type:
  - `mc_single`: option rows, each with a radio (marks correct), a Text/Code dropdown (plus language dropdown for Code), the text or code field, and a remove button; **+ Add option**.
  - `mc_multi`: same rows with tick boxes.
  - `true_false`: two fixed rows (True, False) with a radio for the correct one.
  - `short_text`: accepted answer rows with remove buttons; **+ Add accepted answer**; **Case-sensitive** tickbox; helper text about forgiving marking.
  - `fill_blank`: language dropdown; snippet field (blanks written `{{1}}`, `{{2}}`); word bank chips with remove and **+ Add word**; one dropdown per blank for its correct word.
  - `order_lines`: language dropdown; draggable line rows in correct order with remove buttons; **+ Add line**; helper text that students see them shuffled.

### Projector screens (`/teacher/host/:quizId`)

**Lobby.** Join instructions box (site address, huge share code, quiz title and question count); "Players joined (N)" box with a chip per player; buttons **Start game**, **Cancel game**.

**Question.** Top strip: "Question N of M", type tag, timer chip (timed only), "X of Y submitted". Question box: text, then code block. Answer options box: lettered options in a grid (other types show their own content: True/False options, "Type your answer", the fill-in snippet with empty blanks and the word bank, or the shuffled lines). "Who has answered" strip: one chip per player with "✓ submitted" or "waiting…". **Show results now** button.

**Results.** Header: "Question N of M · Results" and type tag. Two columns: left, **Correct answer** box with the explanation box under it (only if an explanation exists); right, **Leaderboard** rows (rank, name, result and points for this question, total). Button **Next question** (last question: **Finish game**).

**Final.** Top three box, "everyone else" list, **Back to my quizzes**.

### Student screens (`/` and `/play/:code`)

**Join.** App name (ExitCode); game code field; name field; **Join game**; error message line.

**Waiting room.** "You're in, {name}"; "Waiting for the teacher to start…"; player chips.

**Question.** Top bar: name, "Question N of M", timer chip (timed only). Question text and code block. Answer controls by type: radio list (A to F, each option text or code); tick-box list with "Select all that apply"; two big True / False buttons; a text field; the snippet with a dropdown at each blank; a draggable list of lines. **Submit answer** button.

**Answer locked.** "Answer submitted"; "Waiting for the others… (X of Y)".

**Result.** Heading (Correct! / Partly correct / Not quite / No answer); points line with speed bonus if any; correct answer; explanation box if any; "Your rank" and total; "Waiting for the teacher to continue…".

**Final.** "Game over"; "You finished Nth with P points"; **Join another game**.

**Disconnected** and **Teacher left**: heading, one line of text, **Back to join screen**.

### Screen connections

- Teacher: Sign in → My quizzes ↔ Quiz editor. My quizzes or editor → Host (after checks) → Lobby → Question → Results → (Next) Question … → (Finish) Final → My quizzes. Cancel game or ending the game returns to My quizzes.
- Student: Join → Waiting room → Question → Answer locked → Result → (host clicks Next) Question … → Final. Disconnected and Teacher left can interrupt any step before Final.

## 10. Implementation Order

Steps marked `[Manual Setup]` need a person in a website or dashboard; a coding agent cannot do them. Everything else can be built from code.

### Phase 0: accounts and project

1. `[Manual Setup]` Create a GitHub repository for the project.
2. `[Manual Setup]` Create a Supabase project (free plan, region Singapore). Note the project URL and the anon (public) key from Project Settings → API.
3. Scaffold a Vite + React + TypeScript app with React Router and Vitest. Add `@supabase/supabase-js`, `@dnd-kit/core`, `@dnd-kit/sortable`, `highlight.js`, and a schema library (Zod). Commit.
4. Create `.env.local` (git-ignored) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and `.env.example`. `[Manual Setup]` Paste the real values from step 2.
5. Create the folder structure: `src/lib` (supabase client, game logic), `src/teacher`, `src/student`, `src/host`, `src/components`, `src/strings.ts` (all UI text in one file).
6. Add `public/robots.txt` (`Disallow: /`) and `<meta name="robots" content="noindex">` in `index.html`. Add `vercel.json` with a rewrite sending all routes to `index.html`.

### Phase 1: database

7. Save the SQL from section 5.1 as `supabase/migrations/001_init.sql`. `[Manual Setup]` Run it in the Supabase SQL editor.
8. `[Manual Setup]` Insert Ben's email (lowercase) into `allowed_teachers` in the Table Editor.

### Phase 2: teacher sign-in

9. `[Manual Setup]` In Supabase Auth settings: enable the Email provider with "Confirm email" ON, and add `http://localhost:5173/teacher` to the redirect URLs.
10. `[Manual Setup]` In Google Cloud Console create an OAuth client (Web). Add the redirect URL shown in Supabase's Google provider settings, then paste the client ID and secret into Supabase and enable Google.
11. Build the Supabase client module, an auth context (session, loading), a protected-route wrapper, and the allow-list check (`rpc('is_allowed_teacher')`, sign out on false).
12. Build the Sign in screen (Google button, email + password, create account, error and "check your inbox" messages) and the Sign out button.

### Phase 3: quiz management

13. Define the TypeScript types and the shared Zod schema for questions and content (5.3), plus `validateQuizForHosting()` returning a list of `{questionNumber, message}` (3.5). Unit test it.
14. Build My quizzes: list, empty state, New quiz, Delete with inline confirm, Duplicate.
15. Build the editor shell: title with autosave, question list with add, duplicate, delete and drag-to-reorder (rewrite positions 0..n-1), save-status tag.
16. Build the shared code block component (language dropdown, textarea, highlighted preview) and the highlighted read-only code display component.
17. Build the common question form parts: type dropdown, question text, optional code block, timing controls (radio, seconds box 5 to 300, quick picks), explanation.
18. Build the answer editors one at a time: `mc_single`/`mc_multi` (shared component), `true_false`, `short_text`, `fill_blank`, `order_lines`.
19. Wire the **Host** checks: show problems inline on My quizzes and as a banner in the editor.
20. Build Export (download `.quiz.json`) and Import (file picker, validation, new quiz), per 5.4.

### Phase 4: pure game logic (no UI)

21. Write and unit test: share code generator, name validation and normalisation, short-text normalisation and matching, marking for all six types, speed bonus, question points, totals, leaderboard ranking with ties, shuffle for order-the-lines (never the correct order when lines are distinct).

### Phase 5: realtime game

22. Define the realtime message types in TypeScript (section 12) and a small channel wrapper around Supabase Realtime for `game:<CODE>` (presence key `host` for the host, the player id for students).
23. Build the host game engine as a state machine (`lobby` → `question` → `results` → `question` or `final`; `ended`): holds quiz, players, scores and submissions in memory; handles join requests, Start, submissions, early-end conditions, timer, Show results now, Next, Finish, Cancel, presence leaves with the grace period.
24. Build the projector Lobby and the student Join and Waiting room, including the host-presence check ("can't find a game"), join request and reply, name-taken, started and full errors.
25. Build the projector Question screen and the student Question screen with answer controls for all six types, Submit, answer-locked state and the "X of Y submitted" counter.
26. Build timed questions: host timer, students' countdown from the remaining time in the `question` message, auto-end at zero.
27. Build Results (projector and student), Next/Finish, and the Final screens.
28. Build disconnect handling: removal after grace, kicked client screen, refresh detection via `sessionStorage`, host-gone detection with grace, host `beforeunload` best-effort `game_ended`, the Disconnected and Teacher left screens.

### Phase 6: look and feel

29. Apply the terminal theme from section 8: tokens, fonts, highlight theme, projector sizing, focus styles.

### Phase 7: deploy and test

30. `[Manual Setup]` Import the GitHub repo into Vercel (Hobby), set the two `VITE_` environment variables, and deploy.
31. `[Manual Setup]` Add the Vercel site URL to Supabase redirect URLs (and Site URL) and to the Google OAuth client's authorized origins.
32. Test with real browsers: one teacher window, two or three student windows (use separate browser profiles or private windows). Test: every question type, timed and untimed, force results, name rules, late join, student refresh, host refresh, all-players-gone, a non-approved Google account being refused.
33. `[Manual Setup]` Before first real class, check the Supabase project is not paused.

## 11. Constraints & Non-Goals

- Desktop laptops only. No phone layout. Current Chrome, Edge, Firefox and Safari.
- English only.
- Expected class size is 1 to 8 players. A safety cap of `MAX_PLAYERS = 30` per game ("This game is full.").
- No saved game results, scores or answers. No rejoining. No joining after Start. No answer changes after submit.
- Teachers cannot see other teachers' quizzes. There is no sharing between teachers except export/import files.
- Question limits: 50 per quiz; text lengths as in 5.1 and 5.3.
- Only the six question types, one optional code block per question, five code languages (Python, JavaScript, HTML, CSS, plain text).
- Host-side scoring means the host's browser must stay open for the whole game.
- Accepted risk: because the game channel is shared, a technically skilled student could read other students' submissions or fake messages with browser tools. This is accepted for a small supervised classroom.
- Search engines are asked not to index the site (noindex meta tag and `robots.txt`). This is not privacy; access control is the allowed-teachers rule.
- Edge cases to handle: zero players when a question starts (no auto-end); a player leaving mid-question (re-check whether everyone has submitted); duplicate or late submissions (ignore after the first or after the question ends); wrong question number in a submission (ignore); two students joining with the same name at the same instant (the host decides, first request wins); host clicking Show results now with nobody having answered (everyone gets "No answer"); deleting a quiz while it is being hosted (the running game is unaffected because the quiz is already in memory).

## 12. Notes for the Builder

**Realtime protocol (Supabase Broadcast on channel `game:<CODE>`).** The host is the only authority. Suggested events:

| Event | From → to | Payload |
| --- | --- | --- |
| `join_request` | student → host | `{ playerId, name }` |
| `join_accepted` | host → that student | `{ playerId, players }` |
| `join_rejected` | host → that student | `{ playerId, reason: 'name_taken' \| 'started' \| 'full' \| 'bad_name' }` |
| `players` | host → all | `{ players: [{ id, name }] }` (sent on every change) |
| `question` | host → all | `{ index, total, type, prompt, code?, codeLanguage?, content (WITHOUT answers), timing: { mode, remainingMs? } }` |
| `submit` | student → host | `{ playerId, questionIndex, answer }` |
| `progress` | host → all | `{ submitted, total }` |
| `results` | host → all | `{ index, correct, explanation?, outcomes: [{ playerId, status, base, bonus }], leaderboard: [{ playerId, name, total, rank }] }` |
| `final` | host → all | `{ leaderboard }` |
| `removed` | host → that student | `{ playerId }` |
| `game_ended` | host → all | `{ reason }` |

- "Content without answers": strip `correct`, `accepted`, `answers`; for `order_lines` send the lines already shuffled, for `fill_blank` send the snippet and word bank only.
- Student answer shapes: `mc_single` → option id; `mc_multi` → array of option ids; `true_false` → boolean; `short_text` → string; `fill_blank` → `{ "1": "range", "2": "print" }`; `order_lines` → array of line ids in the student's order.
- Presence: the host tracks presence under key `host`; each accepted student calls `track({ playerId })` under their own player id key. The host reads presence leaves to remove players after the grace; students read the `host` key to detect the teacher leaving.
- Joining: the student subscribes to the channel and waits up to 5 seconds for the `host` presence key (not found means "We can't find a game with that code.") before sending `join_request`. Wait up to 5 seconds for the reply.
- Timer: send `remainingMs` in the `question` event and have students count down locally from their own receipt time. The host is authoritative and ignores submissions after it ends the question.
- Keep game state out of React state where possible: put the host engine in a plain TypeScript class or reducer so it can be unit tested without a browser.
- Remembering a student was in a game: on join accepted store `{ code, playerId }` in `sessionStorage`. If `/play/:code` loads with no in-memory game but that marker exists, show the Disconnected screen and clear it.

**Free-tier gotchas worth knowing:**

- **Confirmation emails:** Supabase's built-in email sender is only meant for testing. As of this writing it limits the number of emails and may only deliver to addresses that belong to your Supabase organisation. Ben himself is fine; colleagues who use email + password may not receive their confirmation email until a custom SMTP provider is set up, so tell them to use Google sign-in. Check the current Supabase docs when setting this up.
- **Paused projects:** free Supabase projects pause after about a week of inactivity. Restore from the dashboard before class.

**Small decisions the builder should make as written (change only if Ben says so):** autosave one second after typing stops; ties share a rank (1, 2, 2, 4); 10-second disconnect grace; 30-player safety cap; teachers find their area by bookmarking `/teacher`.

**Security reminders:** never put the Supabase service role key in the frontend. Only the anon key goes in `VITE_` variables. Keep email confirmation on. Do not add UI for changing a teacher's email. All access control for teachers lives in the row-level security policies in 5.1, not in the React code.