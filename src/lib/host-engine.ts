/**
 * The live game, as a plain class. The host's browser is the only authority:
 * it holds the quiz with its correct answers, decides when a question ends,
 * marks every answer and builds the leaderboard. SPEC 3.6, 3.10, 3.11, 12.
 *
 * There is no React and no Supabase in here, so the whole game can be played
 * out in a unit test. Time comes in through `tick(now)` rather than timers,
 * which also keeps the grace periods deterministic.
 */

import {
  DISCONNECT_GRACE_MS,
  MAX_PLAYERS,
} from './constants';
import {
  buildLeaderboard,
  correctAnswerFor,
  isNameTaken,
  isValidName,
  normaliseName,
  scoreAnswer,
  toPublicQuestion,
} from './game-logic';
import type {
  AnswerValue,
  FullQuiz,
  GameEndedReason,
  LeaderboardEntry,
  MessageName,
  Messages,
  Player,
  PlayerOutcome,
  PublicQuestion,
  Question,
} from './types';

export type HostPhase = 'lobby' | 'question' | 'results' | 'final' | 'ended';

export interface ResultsSnapshot {
  index: number;
  total: number;
  question: Question;
  outcomes: Map<string, PlayerOutcome>;
  leaderboard: LeaderboardEntry[];
}

export interface HostView {
  phase: HostPhase;
  players: Player[];
  /** 0-based; -1 in the lobby. */
  index: number;
  total: number;
  question: Question | null;
  submitted: Set<string>;
  /**
   * The question as the students received it: shuffled where it should be,
   * and with nothing marked correct. What the projector shows.
   */
  publicQuestion: PublicQuestion | null;
  /** null on untimed questions and outside a question. */
  remainingMs: number | null;
  results: ResultsSnapshot | null;
  leaderboard: LeaderboardEntry[];
  endedReason: GameEndedReason | null;
}

type Send = <K extends MessageName>(event: K, payload: Messages[K]) => void;

export interface HostEngineOptions {
  quiz: FullQuiz;
  send: Send;
  /** Called whenever the view changes, so the screen can re-render. */
  onChange?: () => void;
  now?: () => number;
  random?: () => number;
}

interface Submission {
  answer: AnswerValue;
  elapsedMs: number;
}

export class HostEngine {
  private readonly quiz: FullQuiz;
  private readonly send: Send;
  private readonly onChange: () => void;
  private readonly now: () => number;
  private readonly random: () => number;

  private phase: HostPhase = 'lobby';
  private readonly players = new Map<string, Player>();
  private readonly totals = new Map<string, number>();
  private readonly submissions = new Map<string, Submission>();
  /** Player id -> the moment their presence went away. */
  private readonly leftAt = new Map<string, number>();
  /**
   * Players whose grace has run out, once the game is under way.
   *
   * They keep their place and their score: a laptop that sleeps, drops its
   * wifi or gets refreshed should not cost a student the game. The class is
   * not kept waiting for them, and they rejoin by coming back with the same
   * player id. In the lobby a dropped player is removed instead -- they never
   * really started.
   */
  private readonly away = new Set<string>();

  private index = -1;
  /**
   * Exactly what was broadcast to the students for the current question.
   *
   * Kept because the projector must show the same thing they do. The order of
   * an "order the lines" question is shuffled when it is sent; without this
   * the projector would read the quiz instead and put the lines in their
   * correct order, which is the answer.
   */
  private publicQuestion: PublicQuestion | null = null;
  private questionStartedAt = 0;
  private questionEndsAt: number | null = null;
  private results: ResultsSnapshot | null = null;
  private endedReason: GameEndedReason | null = null;

  constructor(options: HostEngineOptions) {
    this.quiz = options.quiz;
    this.send = options.send;
    this.onChange = options.onChange ?? (() => {});
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  // ---------- what the screen reads ----------

  view(): HostView {
    const question = this.index >= 0 ? (this.quiz.questions[this.index] ?? null) : null;
    return {
      phase: this.phase,
      // Carries the away flag, so the teacher can see why a name is not
      // answering rather than waiting on a laptop that has gone.
      players: this.playerList(),
      index: this.index,
      total: this.quiz.questions.length,
      question,
      publicQuestion: this.publicQuestion,
      submitted: new Set(this.submissions.keys()),
      remainingMs:
        this.phase === 'question' && this.questionEndsAt !== null
          ? Math.max(0, this.questionEndsAt - this.now())
          : null,
      results: this.results,
      leaderboard: this.currentLeaderboard(),
      endedReason: this.endedReason,
    };
  }

  private currentLeaderboard(): LeaderboardEntry[] {
    return buildLeaderboard(
      [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        total: this.totals.get(player.id) ?? 0,
      })),
    );
  }

  private changed() {
    this.onChange();
  }

  private broadcastPlayers() {
    this.send('players', { players: this.playerList() });
  }

  private playerList(): Player[] {
    return [...this.players.values()].map((player) =>
      this.away.has(player.id) ? { ...player, away: true } : player,
    );
  }

  private broadcastProgress() {
    this.send('progress', {
      submitted: this.submissions.size,
      // Only the laptops still listening. Counting a student whose connection
      // has gone would leave the class waiting on someone who cannot answer.
      total: this.connectedCount(),
    });
  }

  private connectedCount(): number {
    return this.players.size - this.away.size;
  }

  // ---------- joining ----------

  handleJoinRequest(request: Messages['join_request']): void {
    const { playerId } = request;
    if (!playerId) return;

    // A player we already know is coming back: a dropped reply, a refresh, a
    // laptop that went to sleep. They keep their score and their place.
    const existing = this.players.get(playerId);
    if (existing) {
      this.leftAt.delete(playerId);
      this.away.delete(playerId);
      this.send('join_accepted', { playerId, players: this.playerList() });
      // Where the game has got to, so they land where the class is rather
      // than on a waiting screen until the next question.
      this.sendState(playerId);
      this.broadcastPlayers();
      if (this.phase === 'question') this.broadcastProgress();
      this.changed();
      return;
    }

    if (this.phase !== 'lobby') {
      this.send('join_rejected', { playerId, reason: 'started' });
      return;
    }
    if (this.players.size >= MAX_PLAYERS) {
      this.send('join_rejected', { playerId, reason: 'full' });
      return;
    }

    const name = normaliseName(request.name ?? '');
    if (!isValidName(name)) {
      this.send('join_rejected', { playerId, reason: 'bad_name' });
      return;
    }
    // First request wins when two students pick the same name at once.
    if (isNameTaken(name, [...this.players.values()])) {
      this.send('join_rejected', { playerId, reason: 'name_taken' });
      return;
    }

    this.players.set(playerId, { id: playerId, name });
    this.totals.set(playerId, 0);
    this.leftAt.delete(playerId);

    this.send('join_accepted', { playerId, players: [...this.players.values()] });
    this.broadcastPlayers();
    this.changed();
  }

  // ---------- presence ----------

  /** Someone's presence appeared. Anyone we don't know about has been removed. */
  handlePresenceJoin(playerId: string): void {
    if (playerId === 'host') return;
    if (this.players.has(playerId)) {
      // Back again -- briefly away, or away long enough to have been counted
      // out. Either way they are listening again.
      const wasAway = this.leftAt.delete(playerId) || this.away.delete(playerId);
      if (wasAway) {
        this.broadcastPlayers();
        if (this.phase === 'question') this.broadcastProgress();
        this.changed();
      }
      return;
    }
    if (this.phase !== 'lobby') {
      this.send('removed', { playerId });
    }
  }

  /** Presence went away. The player is only removed after the grace period. */
  handlePresenceLeave(playerId: string): void {
    if (playerId === 'host') return;
    if (!this.players.has(playerId)) return;
    if (!this.leftAt.has(playerId)) {
      this.leftAt.set(playerId, this.now());
      this.changed();
    }
  }

  private removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.totals.delete(playerId);
    this.submissions.delete(playerId);
    this.leftAt.delete(playerId);
    this.send('removed', { playerId });
    this.broadcastPlayers();
  }

  // ---------- the clock ----------

  /**
   * Called often by the screen. Removes players whose grace has run out and
   * ends a timed question at zero.
   */
  tick(now: number = this.now()): void {
    if (this.phase === 'ended' || this.phase === 'final') return;

    let removedSomeone = false;
    for (const [playerId, when] of [...this.leftAt.entries()]) {
      if (now - when < DISCONNECT_GRACE_MS) continue;

      if (this.phase === 'lobby') {
        // Nothing to lose yet, and a ghost in the lobby holds their name.
        this.removePlayer(playerId);
      } else {
        // Keep them and their score; just stop waiting for them.
        this.leftAt.delete(playerId);
        this.away.add(playerId);
        this.broadcastPlayers();
      }
      removedSomeone = true;
    }

    if (removedSomeone && this.phase === 'question') {
      this.broadcastProgress();
      // One of the players we were waiting for may have been the last one.
      if (this.everyoneHasSubmitted()) {
        this.endQuestion();
        return;
      }
    }

    if (
      this.phase === 'question' &&
      this.questionEndsAt !== null &&
      now >= this.questionEndsAt
    ) {
      this.endQuestion();
      return;
    }

    if (removedSomeone) this.changed();
  }

  // ---------- running the game ----------

  canStart(): boolean {
    return this.phase === 'lobby' && this.players.size > 0;
  }

  start(): void {
    if (!this.canStart()) return;
    this.beginQuestion(0);
  }

  private beginQuestion(index: number): void {
    const question = this.quiz.questions[index];
    if (!question) {
      this.finish();
      return;
    }

    this.index = index;
    this.phase = 'question';
    this.results = null;
    this.submissions.clear();
    this.questionStartedAt = this.now();
    this.questionEndsAt =
      question.timingMode === 'timed' && question.timeLimitSeconds
        ? this.questionStartedAt + question.timeLimitSeconds * 1000
        : null;

    // Built once and kept, so the projector and the students are reading the
    // same thing rather than two shuffles of it.
    this.publicQuestion = toPublicQuestion(
      question,
      index,
      this.quiz.questions.length,
      this.questionEndsAt === null
        ? undefined
        : this.questionEndsAt - this.questionStartedAt,
      this.random,
    );
    this.send('question', this.publicQuestion);
    this.broadcastProgress();
    this.changed();
  }

  handleSubmit(message: Messages['submit']): void {
    if (this.phase !== 'question') return;
    const { playerId, questionIndex, answer } = message;
    if (questionIndex !== this.index) return;
    if (!this.players.has(playerId)) return;
    // Answers lock on submit: the first one is the only one.
    if (this.submissions.has(playerId)) return;

    this.submissions.set(playerId, {
      answer,
      elapsedMs: Math.max(0, this.now() - this.questionStartedAt),
    });

    this.broadcastProgress();
    this.changed();

    if (this.everyoneHasSubmitted()) this.endQuestion();
  }

  /** True only when there is at least one player and all of them have answered. */
  /**
   * Tell one returning student where the game is.
   *
   * Sent to everyone, like every message here, and ignored by anyone it does
   * not name -- which is why it is this rather than re-broadcasting the
   * question. Re-sending the question would wipe the half-typed answer of
   * every student who is in the middle of one.
   */
  private sendState(playerId: string): void {
    if (this.phase === 'ended') return;
    this.send('state', {
      playerId,
      phase: this.phase,
      players: this.playerList(),
      question: this.phase === 'question' ? this.publicQuestion : null,
      submitted: this.submissions.has(playerId),
      leaderboard: this.phase === 'final' ? this.currentLeaderboard() : null,
    });
  }

  private everyoneHasSubmitted(): boolean {
    // Nobody connected means nobody to wait for, and nothing to end.
    if (this.connectedCount() === 0) return false;
    for (const playerId of this.players.keys()) {
      // A student who is away cannot answer, so the class is not held up by
      // them. Their answer still counts if they come back in time.
      if (this.away.has(playerId)) continue;
      if (!this.submissions.has(playerId)) return false;
    }
    return true;
  }

  /** The teacher's "Show results now". Works even with nobody connected. */
  showResultsNow(): void {
    if (this.phase !== 'question') return;
    this.endQuestion();
  }

  private endQuestion(): void {
    const question = this.quiz.questions[this.index];
    if (!question) return;

    this.phase = 'results';
    this.questionEndsAt = null;

    const outcomes: PlayerOutcome[] = [];
    const byPlayer = new Map<string, PlayerOutcome>();

    for (const player of this.players.values()) {
      const submission = this.submissions.get(player.id);
      const score = scoreAnswer(
        question,
        submission?.answer,
        submission?.elapsedMs ?? 0,
      );
      this.totals.set(player.id, (this.totals.get(player.id) ?? 0) + score.points);
      const outcome: PlayerOutcome = {
        playerId: player.id,
        status: score.status,
        base: score.base,
        bonus: score.bonus,
      };
      outcomes.push(outcome);
      byPlayer.set(player.id, outcome);
    }

    const leaderboard = this.currentLeaderboard();
    this.results = {
      index: this.index,
      total: this.quiz.questions.length,
      question,
      outcomes: byPlayer,
      leaderboard,
    };

    this.send('results', {
      index: this.index,
      total: this.quiz.questions.length,
      correct: correctAnswerFor(question),
      ...(question.explanation ? { explanation: question.explanation } : {}),
      outcomes,
      leaderboard,
    });
    this.changed();
  }

  isLastQuestion(): boolean {
    return this.index >= this.quiz.questions.length - 1;
  }

  next(): void {
    if (this.phase !== 'results') return;
    if (this.isLastQuestion()) this.finish();
    else this.beginQuestion(this.index + 1);
  }

  finish(): void {
    if (this.phase === 'final' || this.phase === 'ended') return;
    this.phase = 'final';
    this.questionEndsAt = null;
    this.send('final', { leaderboard: this.currentLeaderboard() });
    this.changed();
  }

  /** Cancel from the lobby, or Back to my quizzes at the end. */
  end(reason: GameEndedReason = 'cancelled'): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.endedReason = reason;
    this.questionEndsAt = null;
    this.send('game_ended', { reason });
    this.changed();
  }
}
