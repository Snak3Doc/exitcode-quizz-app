/**
 * Every piece of UI text lives here so the app can be translated in one place.
 * (Vietnamese interface is a stretch goal — SPEC section 4.)
 */

export const APP_NAME = 'ExitCode';

export const S = {
  app: {
    name: APP_NAME,
    loading: 'Loading…',
  },

  // ---------- Teacher: sign in ----------
  signIn: {
    google: 'Continue with Google',
    or: 'or',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    createAccount: 'Create account with email',
    checkInbox: 'Check your inbox to confirm your email.',
    notApproved: "This email isn't on the approved teacher list.",
    signOut: 'Sign out',
    emailAndPasswordRequired: 'Enter an email and a password.',
    passwordTooShort: 'Password must be at least 6 characters.',
  },

  // ---------- Teacher: my quizzes ----------
  quizzes: {
    heading: 'My quizzes',
    newQuiz: '+ New quiz',
    importQuiz: 'Import quiz file',
    host: 'Host',
    edit: 'Edit',
    duplicate: 'Duplicate',
    export: 'Export',
    delete: 'Delete',
    cancel: 'Cancel',
    deleteConfirm: "Delete this quiz? This can't be undone.",
    empty: "No quizzes yet. Click '+ New quiz' or import a quiz file.",
    questionCount: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
    editedWhen: (when: string) => `edited ${when}`,
    cannotHost: "This quiz isn't ready to host:",
    openInEditor: 'Open in editor',
    untitled: 'Untitled quiz',
    copyOf: (title: string) => `Copy of ${title}`,
    generate: 'Generate a quiz',
  },

  // ---------- Teacher: generating a quiz ----------
  generate: {
    heading: 'Generate a quiz',
    topicLabel: 'What should the quiz be about?',
    topicPlaceholder: 'Python for loops and range(), for beginners',
    countLabel: 'How many questions?',
    typesLabel: 'Question types',
    timingLabel: 'Timing',
    waitForEveryone: 'Wait for everyone',
    timed: 'Timed',
    secondsLabel: 'Seconds',
    submit: 'Generate',
    working: 'Writing questions…',
    cancel: 'Cancel',

    missingTopic: 'Say what the quiz should be about.',
    missingTypes: 'Choose at least one question type.',

    /** Shown above the editor once a generated quiz opens. */
    draftNotice:
      'These questions were written by a machine and nobody has read them yet. ' +
      'Check each one before you host it — especially that the answers are right.',
    droppedSome: (kept: number, dropped: number) =>
      `Kept ${kept} ${kept === 1 ? 'question' : 'questions'}. ` +
      `${dropped} came back unusable and ${dropped === 1 ? 'was' : 'were'} left out.`,
    noneUsable: 'Nothing usable came back. Try again, or rewrite the topic.',

    // Failures, by the code the function returns.
    unavailable:
      'The generator is busy right now. Try again in a minute, or build the quiz by hand.',
    // Worth saying apart from the one above. These run out for the day, not
    // for a moment, and "try again later" had teachers coming back every few
    // minutes for the best part of an hour to a request that could not work.
    outOfQuotaToday:
      "Today's free generations are used up. They reset overnight — until then, " +
      'build the quiz by hand or duplicate an old one.',
    topicBlocked:
      'The generator refused this topic. Trying again will not help, but rewording it ' +
      'usually does.',
    tooLong:
      'The answer was cut off before it finished. Ask for fewer questions and try again.',
    serverBusy:
      'The server was out of time for this one. Try again — the next attempt starts fresh.',
    failed: 'Generation did not work this time. Try again.',
    saveFailed:
      'The questions were written but could not be saved. Nothing was lost on your side — ' +
      'check that the database has had the latest migration run against it.',
    notApproved: 'This account is not approved to generate quizzes.',
    misconfigured:
      'Generation is not set up on the server. The API key or the function is missing.',
    signedOut: 'Your sign-in has expired. Reload the page and sign in again.',
    tookTooLong:
      'Generation took too long and was cut off. Try again, or ask for fewer questions.',
    // The last resort, so it says only what is actually known. Naming the
    // teacher's connection was wrong often enough to be worth not saying:
    // a server that answers with something unrecognised is not their wi-fi.
    unreachable: 'Generation did not work and did not say why. Try again.',
  },

  // ---------- Teacher: editor ----------
  editor: {
    backToQuizzes: '← My quizzes',
    titleLabel: 'Quiz title',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Not saved',
    hostThisQuiz: 'Host this quiz',
    questions: 'Questions',
    addQuestion: '+ Add question',
    gotIt: 'Got it',
    markRead: 'Mark as read',
    markReadTitle: "Clear the Unread badge. Use it when you have checked the question and it's right.",
    regenerate: 'Rewrite',
    regenerateHeading: 'Rewrite this question',
    regenerateNoteLabel: 'What should change? (optional)',
    regenerateNotePlaceholder: 'Make it harder, or use a list instead of a loop',
    regenerateHint:
      'Saying what you want works far better than asking for something different — ' +
      'without it you tend to get another question just as arbitrary as this one.',
    regenerateSubmit: 'Rewrite it',
    regenerating: 'Rewriting…',
    unreviewed: 'Unread',
    unreviewedTitle:
      'Written by the generator and not read by anyone yet. Editing it clears this.',
    noQuestions: 'No questions yet. Click + Add question.',
    duplicateQuestion: 'Duplicate question',
    deleteQuestion: 'Delete question',
    deleteQuestionConfirm: 'Delete?',
    dragToReorder: 'Drag to reorder',
    questionForm: 'Question',
    typeLabel: 'Type',
    typeChangeConfirm:
      'Changing the question type will clear the answers you have written. Continue?',
    promptLabel: 'Question text',
    promptPlaceholder: 'What does this code print?',
    codeBlock: 'Optional code block',
    addCodeBlock: '+ Add code block',
    removeCodeBlock: 'Remove code block',
    languageLabel: 'Language',
    codePlaceholder: 'for i in range(3):\n    print(i * 2)',
    preview: 'Preview',
    answerArea: 'Answer',
    timing: 'Timing',
    waitForEveryone: 'Wait for everyone',
    timed: 'Timed',
    secondsLabel: 'Seconds',
    secondsHint: '(5 to 300)',
    quickPick: 'Quick:',
    explanation: 'Explanation (optional)',
    explanationPlaceholder: 'Shown to everyone on the results screen.',
    explanationHint: 'Shown on the results screen.',
    selectAQuestion: 'Select a question on the left, or add one.',
    maxQuestions: (max: number) => `Maximum ${max} questions per quiz.`,
    problemsHeading: "This quiz isn't ready to host:",
  },

  // ---------- Teacher: answer editors ----------
  answers: {
    addOption: '+ Add option',
    removeOption: 'Remove option',
    optionCountHint: '(2 to 6 options)',
    markCorrectSingle: 'Choose the one correct answer.',
    markCorrectMulti: 'Tick every correct answer.',
    kindText: 'Text',
    kindCode: 'Code',
    optionPlaceholder: 'Option text',
    trueLabel: 'True',
    falseLabel: 'False',
    trueFalseHint: 'Pick which one is correct. The two options are fixed.',
    acceptedLabel: 'Accepted',
    addAccepted: '+ Add accepted answer',
    removeAccepted: 'Remove accepted answer',
    caseSensitive: 'Case-sensitive',
    shortTextHint:
      'Capitals and extra spaces are ignored unless Case-sensitive is ticked.',
    snippetLabel: 'Code with blanks',
    snippetHint: 'Write blanks as {{1}}, {{2}} and so on. Up to 6 blanks.',
    wordBank: 'Word bank',
    addWord: '+ Add word',
    newWordPlaceholder: 'New word',
    removeWord: 'Remove word',
    blankAnswer: (n: number) => `Blank ${n} answer`,
    choose: 'choose',
    linesLabel: 'Lines in the correct order',
    addLine: '+ Add line',
    removeLine: 'Remove line',
    orderLinesHint:
      'Lines are in the CORRECT order here. Students see them shuffled. Indentation is kept and is fixed.',
  },

  // ---------- Import / export ----------
  io: {
    importFailed: "That file couldn't be imported:",
    importTooBig: 'That file is bigger than 1 MB.',
    importNotJson: "That file isn't valid JSON.",
    importWrongFormat: "That isn't a quiz file for this app.",
    importNewerVersion:
      'That quiz file was made by a newer version of this app.',
    importNoQuestions: 'The file has no questions.',
    importTooManyQuestions: (max: number) =>
      `The file has more than ${max} questions.`,
    questionPrefix: (n: number) => `Question ${n}: `,
  },

  // ---------- Student: join ----------
  join: {
    codeLabel: 'Game code',
    codePlaceholder: 'ABC123',
    nameLabel: 'Your name',
    namePlaceholder: 'Your name',
    joinGame: 'Join game',
    joining: 'Joining…',
    notFound: "We can't find a game with that code.",
    nameTaken: 'That name is taken. Pick another.',
    alreadyStarted: 'This game has already started.',
    gameFull: 'This game is full.',
    unreachable: "Couldn't reach the game. Try again.",
    badName:
      "A name can use letters, numbers, spaces and . , ' - _ ! and must be 1 to 20 characters.",
    missingCode: 'Enter the game code.',
    missingName: 'Enter your name.',
    teacherSignIn: 'Sign in as teacher',
  },

  // ---------- Student: in game ----------
  play: {
    youreIn: (name: string) => `You're in, ${name}`,
    waitingForStart: 'Waiting for the teacher to start…',
    players: 'Players',
    questionOf: (n: number, total: number) => `Question ${n} of ${total}`,
    selectAllThatApply: 'Select all that apply.',
    typeYourAnswer: 'Type your answer',
    dragIntoOrder: 'Drag the lines into order.',
    submitAnswer: 'Submit answer',
    answerSubmitted: 'Answer submitted',
    waitingForOthers: (submitted: number, total: number) =>
      `Waiting for the others… (${submitted} of ${total})`,
    cannotChange: "The answer can't be changed.",
    correct: 'Correct!',
    partlyCorrect: 'Partly correct',
    notQuite: 'Not quite',
    noAnswer: 'No answer',
    points: (n: number) => `+${n} points`,
    speedBonus: (n: number) => `+${n} speed bonus`,
    correctAnswer: 'Correct answer',
    yourRank: (rank: string) => `Your rank: ${rank}`,
    total: (n: number) => `Total: ${n}`,
    waitingForTeacher: 'Waiting for the teacher to continue…',
    gameOver: 'Game over',
    finishedWith: (rank: string, points: number) =>
      `You finished ${rank} with ${points} points`,
    joinAnotherGame: 'Join another game',
    leftHeading: "You've left this game",
    leftBody: "You can't rejoin a game that has started.",
    teacherLeftHeading: 'The game has ended',
    teacherLeftBody: 'The teacher closed the game.',
    backToJoin: 'Back to join screen',
    connecting: 'Connecting…',
  },

  // ---------- Projector / host ----------
  host: {
    /**
     * Split rather than one string, so the address can be coloured like the
     * code. It is the other half of the same instruction, and a student
     * reading a projector should be able to find both at a glance.
     */
    joinInstructionsBefore: 'Go to',
    joinInstructionsAfter: 'and enter this code',
    quizLine: (title: string, questions: number) =>
      `Quiz: ${title} — ${questions} ${questions === 1 ? 'question' : 'questions'}`,
    playersJoined: (n: number) => `Players joined (${n})`,
    noPlayersYet: 'Waiting for students to join…',
    startGame: 'Start game',
    startHint: 'Start is enabled once at least one player has joined.',
    cancelGame: 'Cancel game',
    submittedCount: (submitted: number, total: number) =>
      `${submitted} of ${total} submitted`,
    whoHasAnswered: 'Who has answered',
    submitted: 'submitted',
    waiting: 'waiting…',
    away: 'lost connection',
    showResultsNow: 'Show results now',
    resultsHeading: (n: number, total: number) =>
      `Question ${n} of ${total} · Results`,
    theQuestion: 'The question',
    correctAnswer: 'Correct answer',
    explanation: 'Explanation',
    leaderboard: 'Leaderboard',
    colRank: '#',
    colName: 'Name',
    colThisQ: 'This Q',
    colTotal: 'Total',
    marksKey: '✓ right · ½ partial · ✗ wrong · – no answer',
    nextQuestion: 'Next question',
    finishGame: 'Finish game',
    topThree: 'Top three',
    everyoneElse: 'Everyone else',
    backToMyQuizzes: 'Back to my quizzes',
    notSaved: 'Results are not saved.',
    creatingGame: 'Creating game…',
    gameCreateFailed: "Couldn't create the game. Try again.",
    noPlayersLeft: 'All players have left the game.',
    answerPlaceholder: 'Students type their answer',
  },

  // ---------- Shared labels ----------
  types: {
    mc_single: 'Multiple choice',
    mc_multi: 'Multi answer',
    true_false: 'True / False',
    short_text: 'Short text',
    fill_blank: 'Fill in the blank',
    order_lines: 'Order the lines',
  },

  typesLong: {
    mc_single: 'Multiple choice (one answer)',
    mc_multi: 'Multiple choice (several answers)',
    true_false: 'True / False',
    short_text: 'Short text answer',
    fill_blank: 'Fill in the blank (code)',
    order_lines: 'Order the lines',
  },

  languages: {
    python: 'Python',
    javascript: 'JavaScript',
    html: 'HTML',
    css: 'CSS',
    plaintext: 'Plain text',
  },

  errors: {
    generic: 'Something went wrong. Try again.',
    loadFailed: "Couldn't load that. Try again.",
    quizNotFound: "That quiz doesn't exist, or it isn't yours.",
  },
} as const;
