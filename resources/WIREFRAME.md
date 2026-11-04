# ExitCode Wireframe (text version)

Structure only. Each screen below is drawn in plain text so it displays the same in VS Code, any Markdown viewer, and Claude Code. Colours, fonts and styling are in `SPEC.md` section 8; the full behaviour of every screen is in `SPEC.md` sections 3 and 9. Example names, codes and questions are placeholders.

## How to read the diagrams

- A box (`+--+`) is a region of the screen. A title on the top edge names the region.
- `[ Text ]` is a button or text field. `[ Text v ]` is a dropdown. `( )` and `(o)` are radio buttons. `[ ]` and `[x]` are tick boxes. `::` is a drag handle.
- Result marks: `OK` fully correct, `1/2` partial credit, `X` wrong, `--` no answer.
- Each diagram heading ends with who sees it: Teacher (own laptop), Projector (teacher's laptop connected to the projector, with all teacher controls on it), or Student (own laptop).

## How screens connect

Teacher and projector:

```text
Sign in -> My quizzes <-> Quiz editor
My quizzes / Quiz editor -> (Host, after checks) -> Lobby -> Question -> Results
Results -> (Next question) -> Question ... -> (Finish game) -> Final -> My quizzes
A question moves to Results when: everyone has submitted, OR the timer ends
(timed only), OR the teacher clicks Show results now.
```

Student:

```text
Join -> Waiting room -> Question -> Answer locked -> Result
Result -> (teacher clicks Next) -> Question ... -> Final
Disconnected and Teacher left screens can interrupt any step before Final.
```

## Teacher screens

### Sign in (`/teacher`, signed out)

```text
+- Sign in  [Teacher] ---------------------------------------+
| +- Header -----------------------------------------------+ |
| |                        ExitCode                        | |
| +--------------------------------------------------------+ |
| +- Sign-in card -----------------------------------------+ |
| | [ Continue with Google                               ] | |
| |                           or                           | |
| | [ Email                                              ] | |
| | [ Password                                           ] | |
| | [ Sign in ]  [ Create account with email ]             | |
| | After email sign-up: 'Check your inbox to              | |
| | confirm your email.'                                   | |
| +--------------------------------------------------------+ |
| +- Shown only after a failed sign-in --------------------+ |
| | This email isn't on the approved teacher list.         | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

- Students never see this screen. They go straight to the Join screen at `/`.
- After any sign-in the app checks the approved-teachers list and signs the user out with the message shown if they are not on it.

### My quizzes (`/teacher`, signed in)

```text
+- My quizzes  [Teacher] ----------------------------------------------------+
| +- Top bar --------------------------------------------------------------+ |
| | ExitCode                               teacher@email.com  [ Sign out ] | |
| +------------------------------------------------------------------------+ |
| +- Toolbar --------------------------------------------------------------+ |
| | [ + New quiz ]  [ Import quiz file ]                                   | |
| +------------------------------------------------------------------------+ |
| +- Quiz list (this teacher's quizzes only) ------------------------------+ |
| | Python basics: loops                                                   | |
| | 10 questions - edited today                                            | |
| | [ Host ] [ Edit ] [ Duplicate ] [ Export ] [ Delete ]                  | |
| |                                                                        | |
| | HTML tags quick check                                                  | |
| | 6 questions - edited last week                                         | |
| | [ Host ] [ Edit ] [ Duplicate ] [ Export ] [ Delete ]                  | |
| +------------------------------------------------------------------------+ |
| +- Empty state (only when there are no quizzes) -------------------------+ |
| | No quizzes yet. Click '+ New quiz' or import a quiz file.              | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

- Delete asks for confirmation inline in the row ("Delete this quiz? This can't be undone." with Cancel and Delete), never in a pop-up.
- Host runs the hosting checks first. If the quiz is incomplete, the problems are listed on the row with a link to the editor.

### Quiz editor (`/teacher/quiz/:quizId`)

```text
+- Quiz editor  [Teacher] ---------------------------------------------------+
| +- Top bar --------------------------------------------------------------+ |
| | [< My quizzes] [ Python basics: loops ]      Saved  [ HOST THIS QUIZ ] | |
| +------------------------------------------------------------------------+ |
| +- Question list ----------+  +- Question form --------------------------+ |
| | > :: 1 What does this..  |  | Type: [ Multiple choice (one) v ]        | |
| |        Multiple choice   |  | Question text:                           | |
| |   :: 2 Which are vali..  |  | [ What does this code print?           ] | |
| |        Multi answer      |  | +- Optional code block ----------------+ | |
| |   :: 3 Order the line..  |  | | Language: [ Python v ] [Remove]      | | |
| |        Order lines       |  | | for i in range(3):                   | | |
| |                          |  | |     print(i * 2)                     | | |
| | [ + Add question ]       |  | | (highlighted as you type)            | | |
| |                          |  | +--------------------------------------+ | |
| | > = open question        |  | +- Answer area (by type) --------------+ | |
| | :: = drag to reorder     |  | | (see 'Answer areas' below)           | | |
| | Each row also has a      |  | +--------------------------------------+ | |
| | [copy] and an [x] button |  | +- Timing -----------------------------+ | |
| +--------------------------+  | | (o) Wait for everyone  ( ) Timed     | | |
|                               | | Seconds: [ 30 ]  (5 to 300)          | | |
|                               | | Quick: [10] [20] [30] [60] [120]     | | |
|                               | | (seconds + quick picks only show     | | |
|                               | |  when Timed is selected)             | | |
|                               | +--------------------------------------+ | |
|                               | +- Explanation (optional) -------------+ | |
|                               | | [ range(3) gives 0, 1, 2,          ] | | |
|                               | | [ so i * 2 gives 0, 2, 4.          ] | | |
|                               | +--------------------------------------+ | |
|                               +------------------------------------------+ |
+----------------------------------------------------------------------------+
```

- On narrow widths the question list stacks above the form.
- Timed shows the seconds box and quick picks; Wait for everyone hides them.
- Hosting-check problems appear in a banner under the top bar.

### Editor answer areas (replace the 'Answer area' box above)

```text
+- Editor answer areas, one per question type  [Teacher] --------------------+
| +- Multiple choice: one answer ----+  +- Multiple choice: several -------+ |
| | (o) [Text v] [Option A text ]    |  | [x] [Text v] [Option A text ]    | |
| | ( ) [Text v] [Option B text ]    |  | [ ] [Text v] [Option B text ]    | |
| | ( ) [Code v] [Py v]              |  | [x] [Text v] [Option C text ]    | |
| |     [ len(items)           ]     |  |                                  | |
| | [ + Add option ]  (2 to 6)       |  | [ + Add option ]  (2 to 6)       | |
| | (o) marks the correct answer     |  | [x] marks each correct answer    | |
| +----------------------------------+  +----------------------------------+ |
| +- True / False -------------------+  +- Short text answer --------------+ |
| | (o) True                         |  | Accepted: [ len         ] x      | |
| | ( ) False                        |  | Accepted: [ len()       ] x      | |
| |                                  |  | [ + Add accepted answer ]        | |
| | Pick which one is correct.       |  | [ ] Case-sensitive               | |
| | The two options are fixed.       |  | (otherwise capitals and extra    | |
| +----------------------------------+  |  spaces are ignored)             | |
|                                       +----------------------------------+ |
| +- Fill in the blank (code) -------+  +- Order the lines ----------------+ |
| | Language: [ Python v ]           |  | Language: [ Python v ]           | |
| | for i in {{1}}(3):               |  | :: [ def f(x):          ] x      | |
| |     {{2}}(i)                     |  | :: [     return x * 2   ] x      | |
| | Word bank:                       |  | :: [ print(f(3))        ] x      | |
| | [range x] [print x] [len x]      |  | [ + Add line ]                   | |
| | [ + Add word ]                   |  | Lines are in the CORRECT order.  | |
| | Blank 1 answer: [ range v ]      |  | Students see them shuffled.      | |
| | Blank 2 answer: [ print v ]      |  |                                  | |
| +----------------------------------+  +----------------------------------+ |
+----------------------------------------------------------------------------+
```

- Multiple choice options can each be Text or a Code block with its own language (Python, JavaScript, HTML, CSS, Plain text).
- Fill in the blank: type `{{1}}`, `{{2}}` and so on in the snippet to mark blanks.
- Order the lines: lines keep their leading spaces; indentation is fixed and students only decide the order.

## Projector screens (`/teacher/host/:quizId`)

### Lobby

```text
+- Lobby  [Projector] -------------------------------------------------------+
| +- Join instructions ----------------------------------------------------+ |
| |            Go to  your-site.vercel.app  and enter this code            | |
| | +- Share code -------------------------------------------------------+ | |
| | |                          K  7  M  2  Q  X                          | | |
| | +--------------------------------------------------------------------+ | |
| |               Quiz: Python basics: loops - 10 questions                | |
| +------------------------------------------------------------------------+ |
| +- Players joined (5) ---------------------------------------------------+ |
| | [Sam]  [Linh]  [Minh]  [Mai]  [Jake]                                   | |
| | (names appear as students join; joining closes at Start)               | |
| +------------------------------------------------------------------------+ |
| +- Teacher controls -----------------------------------------------------+ |
| | [ START GAME ]   [ Cancel game ]                                       | |
| | (Start is disabled until at least one player has joined)               | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

### Question

```text
+- Question  [Projector] ----------------------------------------------------+
| +- Top strip ------------------------------------------------------------+ |
| | Question 3 of 10   [Multiple choice]   0:24   4 of 5 submitted         | |
| | (timer only on timed questions)                                        | |
| +------------------------------------------------------------------------+ |
| +- Question -------------------------------------------------------------+ |
| | What does this code print?                                             | |
| |                                                                        | |
| |     for i in range(3):                                                 | |
| |         print(i * 2)                                                   | |
| +------------------------------------------------------------------------+ |
| +- Answer options (lettered, same order as students see) ----------------+ |
| | [A] 0 2 4                 [B] 2 4 6                                    | |
| | [C] 0 1 2                 [D] 0 2 4 6                                  | |
| | Other types show their own content here: True/False options,           | |
| | 'Type your answer', the fill-in snippet with its word bank, or         | |
| | the shuffled lines. Correct answers are never shown.                   | |
| +------------------------------------------------------------------------+ |
| +- Who has answered -----------------------------------------------------+ |
| | Sam: submitted    Linh: submitted    Minh: waiting...                  | |
| | Mai: submitted    Jake: submitted                                      | |
| +------------------------------------------------------------------------+ |
| +- Teacher control ------------------------------------------------------+ |
| | [ SHOW RESULTS NOW ]   (moves on even if some haven't answered)        | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

### Results and leaderboard

```text
+- Results and leaderboard  [Projector] -------------------------------------+
| +- Header ---------------------------------------------------------------+ |
| | Question 3 of 10 - Results   [Multiple choice]                         | |
| +------------------------------------------------------------------------+ |
| +- Correct answer ---------------+  +- Leaderboard ----------------------+ |
| | [A] 0 2 4   <- correct         |  | #  Name    This Q      Total       | |
| |                                |  | 1  Linh    OK  +1480    4120       | |
| | +- Explanation (if any) -----+ |  | 2  Sam     OK  +1350    3970       | |
| | | range(3) gives 0, 1, 2,    | |  | 3  Mai     1/2  +500    3200       | |
| | | so i * 2 gives 0, 2, 4.    | |  | 4  Jake    X      +0    2800       | |
| | +----------------------------+ |  | 5  Minh    --      0    2100       | |
| |                                |  |                                    | |
| | Other types show the full      |  | OK=right  1/2=partial  X=wrong     | |
| | correct set, snippet or        |  | --=no answer                       | |
| | line order here.               |  +------------------------------------+ |
| +--------------------------------+                                         |
| +- Teacher control ------------------------------------------------------+ |
| | [ NEXT QUESTION ]   (on the last question: [ FINISH GAME ])            | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

### Final leaderboard

```text
+- Final leaderboard  [Projector] -------------------------------------------+
| +- Top three ------------------------------------------------------------+ |
| | 2nd  Sam  8970      1st  Linh  9420      3rd  Mai  8100                | |
| +------------------------------------------------------------------------+ |
| +- Everyone else --------------------------------------------------------+ |
| | 4  Jake   7600                                                         | |
| | 5  Minh   6400                                                         | |
| +------------------------------------------------------------------------+ |
| +- Teacher control ------------------------------------------------------+ |
| | [ BACK TO MY QUIZZES ]   (results are not saved)                       | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

## Student screens (`/` and `/play/:code`)

### Join

```text
+- Join  [Student] ------------------------------------------+
| +- Join -------------------------------------------------+ |
| |                        ExitCode                        | |
| |                                                        | |
| | [ Game code                                          ] | |
| | [ Your name                                          ] | |
| |                                                        | |
| |                     [ Join game ]                      | |
| +--------------------------------------------------------+ |
| +- Error messages ---------------------------------------+ |
| | One of these shows under the button:                   | |
| | - We can't find a game with that code.                 | |
| | - That name is taken. Pick another.                    | |
| | - This game has already started.                       | |
| | - This game is full.                                   | |
| | - Couldn't reach the game. Try again.                  | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

### Waiting room

```text
+- Waiting room  [Student] ----------------------------------+
| +- Waiting room -----------------------------------------+ |
| |                     You're in, Sam                     | |
| |          Waiting for the teacher to start...           | |
| |                                                        | |
| | [Sam]  [Linh]  [Minh]                                  | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

### Question

```text
+- Question  [Student] ----------------------------------------------+
| +- Top bar ------------------------------------------------------+ |
| | Sam                                  Question 3 of 10     0:24 | |
| | (timer only on timed questions)                                | |
| +----------------------------------------------------------------+ |
| +- Question -----------------------------------------------------+ |
| | What does this code print?                                     | |
| |                                                                | |
| |     for i in range(3):                                         | |
| |         print(i * 2)                                           | |
| +----------------------------------------------------------------+ |
| +- Answer controls ----------------------------------------------+ |
| | ( ) A  0 2 4                                                   | |
| | ( ) B  2 4 6                                                   | |
| | ( ) C  0 1 2                                                   | |
| | ( ) D  0 2 4 6                                                 | |
| |                                                                | |
| | [ SUBMIT ANSWER ]  (disabled until something is chosen)        | |
| +----------------------------------------------------------------+ |
+--------------------------------------------------------------------+
```

### Answer controls by question type

```text
+- Student answer controls by type  [Student] -------------------------------+
| +- One answer ---------------------+  +- Several answers ----------------+ |
| | Radio list A to F, as in the     |  | [ ] A  Option text               | |
| | question screen above.           |  | [ ] B  Option text               | |
| | Options can be text or code.     |  | Select all that apply.           | |
| +----------------------------------+  +----------------------------------+ |
| +- True / False -------------------+  +- Short text ---------------------+ |
| | [ True ]   [ False ]             |  | [ Type your answer       ]       | |
| +----------------------------------+  +----------------------------------+ |
| +- Fill in the blank --------------+  +- Order the lines ----------------+ |
| | for i in [ range v ](3):         |  | :: print(f(3))                   | |
| |     [ choose v ](i)              |  | :: def f(x):                     | |
| | Each blank is a dropdown         |  | ::     return x * 2              | |
| | listing the word bank.           |  | Drag the lines into order.       | |
| +----------------------------------+  +----------------------------------+ |
+----------------------------------------------------------------------------+
```

### Answer locked

```text
+- Answer locked  [Student] ---------------------------------+
| +- After submitting -------------------------------------+ |
| | Sam                                   Question 3 of 10 | |
| |                                                        | |
| |                    Answer submitted                    | |
| |           Waiting for the others... (4 of 5)           | |
| |                                                        | |
| | The answer can't be changed.                           | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

### Result

```text
+- Result  [Student] ----------------------------------------+
| +- Result -----------------------------------------------+ |
| |                        Correct!                        | |
| |            +1000 points   +350 speed bonus             | |
| |                                                        | |
| | [A] 0 2 4   <- correct answer                          | |
| | +- Explanation (if any) -----------------------------+ | |
| | | range(3) gives 0, 1, 2, so i * 2                   | | |
| | | gives 0, 2, 4.                                     | | |
| | +----------------------------------------------------+ | |
| | Your rank: 2nd                             Total: 3970 | |
| |                                                        | |
| |         Waiting for the teacher to continue...         | |
| |                                                        | |
| | The heading can also read:                             | |
| | Partly correct / Not quite / No answer.                | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

### Final

```text
+- Final  [Student] -----------------------------------------+
| +- Final ------------------------------------------------+ |
| |                       Game over                        | |
| |           You finished 2nd with 8970 points            | |
| |                                                        | |
| |                 [ Join another game ]                  | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

### Disconnected and teacher left

```text
+- Disconnected and teacher left  [Student] -----------------+
| +- Disconnected -----------------------------------------+ |
| |                 You've left this game                  | |
| |       You can't rejoin a game that has started.        | |
| |                                                        | |
| |                [ Back to join screen ]                 | |
| +--------------------------------------------------------+ |
| +- Teacher left -----------------------------------------+ |
| |                   The game has ended                   | |
| |              The teacher closed the game.              | |
| |                                                        | |
| |                [ Back to join screen ]                 | |
| +--------------------------------------------------------+ |
+------------------------------------------------------------+
```

