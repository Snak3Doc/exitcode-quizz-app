/** Shared data shapes for quizzes, questions and the live game. SPEC 5.3, 12. */

export const QUESTION_TYPES = [
  'mc_single',
  'mc_multi',
  'true_false',
  'short_text',
  'fill_blank',
  'order_lines',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CODE_LANGUAGES = [
  'python',
  'javascript',
  'html',
  'css',
  'plaintext',
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export type TimingMode = 'wait' | 'timed';

// ---------- content shapes (questions.content) ----------

export type OptionKind = 'text' | 'code';

export interface ChoiceOption {
  id: string;
  kind: OptionKind;
  /** Only present when kind === 'code'. */
  language?: CodeLanguage;
  text: string;
  correct: boolean;
}

export interface ChoiceContent {
  options: ChoiceOption[];
}

export interface TrueFalseContent {
  correct: boolean;
}

export interface ShortTextContent {
  accepted: string[];
  caseSensitive: boolean;
}

export interface FillBlankContent {
  language: CodeLanguage;
  snippet: string;
  wordBank: string[];
  /** Blank number (as a string) -> the correct word. */
  answers: Record<string, string>;
}

export interface OrderLine {
  id: string;
  text: string;
}

export interface OrderLinesContent {
  language: CodeLanguage;
  /** In the CORRECT order. */
  lines: OrderLine[];
}

export type QuestionContent =
  | ChoiceContent
  | TrueFalseContent
  | ShortTextContent
  | FillBlankContent
  | OrderLinesContent;

/** A question as the app holds it in memory (camelCase). */
export interface Question {
  id: string;
  quizId: string;
  position: number;
  type: QuestionType;
  prompt: string;
  code: string | null;
  codeLanguage: CodeLanguage | null;
  timingMode: TimingMode;
  timeLimitSeconds: number | null;
  explanation: string | null;
  /** Shape depends on `type`; drafts may be incomplete. */
  content: Record<string, unknown>;
  /**
   * When the generator wrote this question, if it did. Cleared the moment a
   * person edits it, so null means a human has had a hand in this one.
   *
   * It records whether someone *looked*, not whether the question is *right* —
   * nothing in the app can check that a generated snippet really prints what
   * its answer claims.
   */
  generatedAt: string | null;
}

export interface QuizSummary {
  id: string;
  title: string;
  updatedAt: string;
  questionCount: number;
}

export interface Quiz {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface FullQuiz extends Quiz {
  questions: Question[];
}

// ---------- database row shapes (snake_case, as Postgres returns them) ----------

export interface QuizRow {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  code: string | null;
  code_language: CodeLanguage | null;
  timing_mode: TimingMode;
  time_limit_seconds: number | null;
  explanation: string | null;
  content: Record<string, unknown>;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- live game ----------

export interface Player {
  id: string;
  name: string;
  /**
   * Their laptop has stopped answering: a dropped connection, a closed lid, a
   * refresh. They keep their score and may come back. The teacher sees it so
   * they know why someone is not answering, and the game does not wait for
   * them.
   */
  away?: boolean;
}

export type AnswerValue =
  /** mc_single: option id */
  | string
  /** mc_multi: option ids, order_lines: line ids in the student's order */
  | string[]
  /** true_false */
  | boolean
  /** fill_blank: blank number -> chosen word */
  | Record<string, string>;

export type Outcome = 'correct' | 'partial' | 'wrong' | 'none';

export interface PlayerOutcome {
  playerId: string;
  status: Outcome;
  base: number;
  bonus: number;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  total: number;
  rank: number;
}

/** Question content with every correct answer removed, as students receive it. */
export type PublicContent =
  | { options: Array<Omit<ChoiceOption, 'correct'>> }
  | Record<string, never>
  | { accepted?: never }
  | { language: CodeLanguage; snippet: string; wordBank: string[] }
  | { language: CodeLanguage; lines: OrderLine[] };

export interface PublicQuestion {
  index: number;
  total: number;
  type: QuestionType;
  prompt: string;
  code?: string;
  codeLanguage?: CodeLanguage;
  content: Record<string, unknown>;
  timing: { mode: TimingMode; remainingMs?: number };
}

/** The correct answer, in a shape the results screens can render. */
export type CorrectAnswer =
  | { type: 'mc_single' | 'mc_multi'; optionIds: string[]; options: Array<Omit<ChoiceOption, 'correct'>> }
  | { type: 'true_false'; correct: boolean }
  | { type: 'short_text'; accepted: string[]; caseSensitive: boolean }
  | {
      type: 'fill_blank';
      language: CodeLanguage;
      snippet: string;
      answers: Record<string, string>;
    }
  | { type: 'order_lines'; language: CodeLanguage; lines: OrderLine[] };

// ---------- realtime messages (SPEC 12) ----------

export type JoinRejectReason = 'name_taken' | 'started' | 'full' | 'bad_name';
export type GameEndedReason = 'cancelled' | 'finished' | 'host_left';

export interface Messages {
  join_request: { playerId: string; name: string };
  join_accepted: { playerId: string; players: Player[] };
  join_rejected: { playerId: string; reason: JoinRejectReason };
  players: { players: Player[] };
  question: PublicQuestion;
  submit: { playerId: string; questionIndex: number; answer: AnswerValue };
  progress: { submitted: number; total: number };
  results: {
    index: number;
    total: number;
    correct: CorrectAnswer;
    explanation?: string;
    outcomes: PlayerOutcome[];
    leaderboard: LeaderboardEntry[];
  };
  final: { leaderboard: LeaderboardEntry[] };
  removed: { playerId: string };
  /**
   * Where the game is, for a student who has just come back.
   *
   * Sent only in reply to a rejoin, so nobody else's screen is disturbed.
   * Everyone receives it, as with every message here, and ignores one that
   * names a different player.
   */
  state: {
    playerId: string;
    phase: 'lobby' | 'question' | 'results' | 'final';
    players: Player[];
    /** The question they should be looking at, when one is open. */
    question: PublicQuestion | null;
    /** True when they already answered this one before they dropped. */
    submitted: boolean;
    /** Only when the game has finished, so they see the result and not a
     *  waiting screen that will never change. */
    leaderboard: LeaderboardEntry[] | null;
  };
  game_ended: { reason: GameEndedReason };
}

export type MessageName = keyof Messages;
