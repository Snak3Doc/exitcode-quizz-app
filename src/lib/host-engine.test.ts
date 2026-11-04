import { beforeEach, describe, expect, it } from 'vitest';
import { HostEngine } from './host-engine';
import { DISCONNECT_GRACE_MS, MAX_PLAYERS } from './constants';
import type { FullQuiz, MessageName, Messages, Question } from './types';

// ---------- a game to play ----------

function question(
  id: string,
  type: Question['type'],
  content: Record<string, unknown>,
  extra: Partial<Question> = {},
): Question {
  return {
    id,
    quizId: 'z1',
    position: 0,
    type,
    prompt: `Prompt ${id}`,
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content,
    ...extra,
  };
}

const mcContent = {
  options: [
    { id: 'o1', kind: 'text', text: 'right', correct: true },
    { id: 'o2', kind: 'text', text: 'wrong', correct: false },
  ],
};

function quizWith(questions: Question[]): FullQuiz {
  return {
    id: 'z1',
    title: 'Test quiz',
    createdAt: '',
    updatedAt: '',
    questions: questions.map((q, i) => ({ ...q, position: i })),
  };
}

/** An engine with a clock we drive by hand and every message it sent. */
function makeEngine(quiz: FullQuiz) {
  const sent: Array<{ event: MessageName; payload: unknown }> = [];
  let now = 1_000_000;

  const engine = new HostEngine({
    quiz,
    send: (event, payload) => sent.push({ event, payload }),
    now: () => now,
    // A fixed "random" keeps shuffles predictable.
    random: () => 0.42,
  });

  return {
    engine,
    sent,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
      engine.tick(now);
    },
    setNow(value: number) {
      now = value;
    },
    last<K extends MessageName>(event: K): Messages[K] | undefined {
      for (let i = sent.length - 1; i >= 0; i -= 1) {
        if (sent[i].event === event) return sent[i].payload as Messages[K];
      }
      return undefined;
    },
    all(event: MessageName) {
      return sent.filter((m) => m.event === event).map((m) => m.payload);
    },
    clear() {
      sent.length = 0;
    },
  };
}

function join(h: ReturnType<typeof makeEngine>, playerId: string, name: string) {
  h.engine.handleJoinRequest({ playerId, name });
}

const twoQuestionQuiz = () =>
  quizWith([
    question('q1', 'mc_single', mcContent),
    question('q2', 'true_false', { correct: true }),
  ]);

// ---------- lobby ----------

describe('lobby and joining', () => {
  let h: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    h = makeEngine(twoQuestionQuiz());
  });

  it('starts in the lobby with nobody and cannot start', () => {
    expect(h.engine.view().phase).toBe('lobby');
    expect(h.engine.view().players).toEqual([]);
    expect(h.engine.canStart()).toBe(false);
    h.engine.start();
    expect(h.engine.view().phase).toBe('lobby');
  });

  it('accepts a player and tells everyone', () => {
    join(h, 'p1', 'Sam');
    expect(h.last('join_accepted')).toEqual({
      playerId: 'p1',
      players: [{ id: 'p1', name: 'Sam' }],
    });
    expect(h.last('players')).toEqual({ players: [{ id: 'p1', name: 'Sam' }] });
    expect(h.engine.canStart()).toBe(true);
  });

  it('tidies up the name it stores', () => {
    join(h, 'p1', '  Sam   Lee  ');
    expect(h.engine.view().players[0].name).toBe('Sam Lee');
  });

  it('rejects a name that is already taken, whatever the capitals', () => {
    join(h, 'p1', 'Sam');
    join(h, 'p2', 'SAM');
    expect(h.last('join_rejected')).toEqual({ playerId: 'p2', reason: 'name_taken' });
    expect(h.engine.view().players).toHaveLength(1);
  });

  it('rejects a name the rules do not allow', () => {
    join(h, 'p1', 'Sam<script>');
    expect(h.last('join_rejected')).toEqual({ playerId: 'p1', reason: 'bad_name' });
    join(h, 'p2', '   ');
    expect(h.last('join_rejected')).toEqual({ playerId: 'p2', reason: 'bad_name' });
  });

  it('rejects joins once the game has started', () => {
    join(h, 'p1', 'Sam');
    h.engine.start();
    join(h, 'p2', 'Linh');
    expect(h.last('join_rejected')).toEqual({ playerId: 'p2', reason: 'started' });
  });

  it('rejects joins past the safety cap', () => {
    for (let i = 0; i < MAX_PLAYERS; i += 1) join(h, `p${i}`, `Player${i}`);
    expect(h.engine.view().players).toHaveLength(MAX_PLAYERS);
    join(h, 'one-too-many', 'Extra');
    expect(h.last('join_rejected')).toEqual({
      playerId: 'one-too-many',
      reason: 'full',
    });
  });

  it('answers a repeated join request the same way', () => {
    join(h, 'p1', 'Sam');
    h.clear();
    join(h, 'p1', 'Sam');
    expect(h.last('join_accepted')?.playerId).toBe('p1');
    expect(h.engine.view().players).toHaveLength(1);
  });
});

// ---------- questions ----------

describe('running a question', () => {
  let h: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    join(h, 'p2', 'Linh');
    h.clear();
  });

  it('sends the question without its correct answers', () => {
    h.engine.start();
    const sent = h.last('question');
    expect(sent?.index).toBe(0);
    expect(sent?.total).toBe(2);
    expect(sent?.timing).toEqual({ mode: 'wait' });
    const options = (sent?.content as { options: Array<Record<string, unknown>> }).options;
    for (const option of options) expect(option).not.toHaveProperty('correct');
  });

  it('counts submissions and ends once everyone has answered', () => {
    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    expect(h.last('progress')).toEqual({ submitted: 1, total: 2 });
    expect(h.engine.view().phase).toBe('question');

    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o2' });
    expect(h.engine.view().phase).toBe('results');
  });

  it('ignores a second answer, a stranger and the wrong question number', () => {
    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o2' });
    h.engine.handleSubmit({ playerId: 'nobody', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 7, answer: 'o1' });

    expect(h.last('progress')).toEqual({ submitted: 1, total: 2 });
    // The first answer is the one that counts.
    h.engine.showResultsNow();
    const outcomes = h.last('results')!.outcomes;
    expect(outcomes.find((o) => o.playerId === 'p1')!.status).toBe('correct');
  });

  it('ignores answers that arrive after the question ended', () => {
    h.engine.start();
    h.engine.showResultsNow();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    expect(h.engine.view().results?.outcomes.get('p1')?.status).toBe('none');
  });

  it('marks everyone with no answer when the teacher moves on early', () => {
    h.engine.start();
    h.engine.showResultsNow();
    const results = h.last('results')!;
    expect(results.outcomes.map((o) => o.status)).toEqual(['none', 'none']);
    expect(results.leaderboard.every((entry) => entry.total === 0)).toBe(true);
  });

  it('sends the correct answer and the explanation only on the results', () => {
    const quiz = quizWith([
      question('q1', 'mc_single', mcContent, { explanation: 'Because.' }),
    ]);
    const g = makeEngine(quiz);
    join(g, 'p1', 'Sam');
    g.engine.start();
    expect(g.last('question')).not.toHaveProperty('explanation');

    g.engine.showResultsNow();
    const results = g.last('results')!;
    expect(results.explanation).toBe('Because.');
    expect(results.correct).toMatchObject({ type: 'mc_single', optionIds: ['o1'] });
  });

  it('leaves out the explanation when there is none', () => {
    h.engine.start();
    h.engine.showResultsNow();
    expect(h.last('results')).not.toHaveProperty('explanation');
  });
});

// ---------- timed questions ----------

describe('timed questions', () => {
  function timedGame() {
    const quiz = quizWith([
      question('q1', 'mc_single', mcContent, {
        timingMode: 'timed',
        timeLimitSeconds: 30,
      }),
    ]);
    const h = makeEngine(quiz);
    join(h, 'p1', 'Sam');
    join(h, 'p2', 'Linh');
    h.clear();
    return h;
  }

  it('sends how long is left and counts down', () => {
    const h = timedGame();
    h.engine.start();
    expect(h.last('question')?.timing).toEqual({ mode: 'timed', remainingMs: 30_000 });

    h.advance(10_000);
    expect(h.engine.view().remainingMs).toBe(20_000);
  });

  it('ends the question when the timer reaches zero', () => {
    const h = timedGame();
    h.engine.start();
    h.advance(29_999);
    expect(h.engine.view().phase).toBe('question');
    h.advance(1);
    expect(h.engine.view().phase).toBe('results');
  });

  it('still ends early when everyone has answered', () => {
    const h = timedGame();
    h.engine.start();
    h.advance(5_000);
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o1' });
    expect(h.engine.view().phase).toBe('results');
  });

  it('pays a speed bonus measured by the host, not the student', () => {
    const h = timedGame();
    h.engine.start();
    h.advance(6_000); // a fifth of the way through
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o2' });

    const outcomes = h.last('results')!.outcomes;
    expect(outcomes.find((o) => o.playerId === 'p1')).toMatchObject({
      status: 'correct',
      base: 1000,
      bonus: 400,
    });
    expect(outcomes.find((o) => o.playerId === 'p2')).toMatchObject({
      status: 'wrong',
      base: 0,
      bonus: 0,
    });
  });

  it('pays no bonus on an untimed question', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    expect(h.last('results')!.outcomes[0]).toMatchObject({ base: 1000, bonus: 0 });
  });
});

// ---------- the whole game ----------

describe('moving through the game', () => {
  it('goes question, results, question, results, final', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');

    h.engine.start();
    expect(h.engine.view().index).toBe(0);
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    expect(h.engine.view().phase).toBe('results');
    expect(h.engine.isLastQuestion()).toBe(false);

    h.engine.next();
    expect(h.engine.view().phase).toBe('question');
    expect(h.engine.view().index).toBe(1);
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 1, answer: true });
    expect(h.engine.isLastQuestion()).toBe(true);

    h.engine.next();
    expect(h.engine.view().phase).toBe('final');
    expect(h.last('final')!.leaderboard).toEqual([
      { playerId: 'p1', name: 'Sam', total: 2000, rank: 1 },
    ]);
  });

  it('adds up points across questions and ranks ties together', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    join(h, 'p2', 'Linh');
    join(h, 'p3', 'Mai');

    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p3', questionIndex: 0, answer: 'o2' });

    h.engine.next();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 1, answer: true });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 1, answer: false });
    h.engine.handleSubmit({ playerId: 'p3', questionIndex: 1, answer: true });

    h.engine.next();
    expect(h.last('final')!.leaderboard).toEqual([
      { playerId: 'p1', name: 'Sam', total: 2000, rank: 1 },
      { playerId: 'p2', name: 'Linh', total: 1000, rank: 2 },
      { playerId: 'p3', name: 'Mai', total: 1000, rank: 2 },
    ]);
  });

  it('ignores Next except on the results screen', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    h.engine.next();
    expect(h.engine.view().phase).toBe('lobby');
    h.engine.start();
    h.engine.next();
    expect(h.engine.view().index).toBe(0);
  });

  it('ends the game on cancel and tells everyone why', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    h.engine.end('cancelled');
    expect(h.engine.view().phase).toBe('ended');
    expect(h.last('game_ended')).toEqual({ reason: 'cancelled' });
  });
});

// ---------- disconnects ----------

describe('disconnects', () => {
  let h: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    join(h, 'p2', 'Linh');
    h.clear();
  });

  it('keeps a player through a brief blip', () => {
    h.engine.start();
    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS - 1);
    expect(h.engine.view().players).toHaveLength(2);

    h.engine.handlePresenceJoin('p1');
    h.advance(DISCONNECT_GRACE_MS);
    expect(h.engine.view().players).toHaveLength(2);
  });

  it('removes a player once the grace has run out', () => {
    h.engine.start();
    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS);

    expect(h.engine.view().players.map((p) => p.id)).toEqual(['p2']);
    expect(h.last('removed')).toEqual({ playerId: 'p1' });
    expect(h.last('players')).toEqual({ players: [{ id: 'p2', name: 'Linh' }] });
  });

  it('a leaver stops blocking the others', () => {
    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o1' });
    expect(h.engine.view().phase).toBe('question');

    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS);

    // p2 was the only one left and had already answered.
    expect(h.engine.view().phase).toBe('results');
    expect(h.last('results')!.outcomes.map((o) => o.playerId)).toEqual(['p2']);
  });

  it('drops a removed player from the leaderboard', () => {
    h.engine.start();
    h.engine.handleSubmit({ playerId: 'p1', questionIndex: 0, answer: 'o1' });
    h.engine.handleSubmit({ playerId: 'p2', questionIndex: 0, answer: 'o1' });
    h.engine.next();
    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS);
    h.engine.showResultsNow();

    expect(h.last('results')!.leaderboard.map((e) => e.name)).toEqual(['Linh']);
  });

  it('tells a reconnecting removed student that they are out', () => {
    h.engine.start();
    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS);
    h.clear();

    h.engine.handlePresenceJoin('p1');
    expect(h.last('removed')).toEqual({ playerId: 'p1' });
  });

  it('says nothing to an unknown presence while still in the lobby', () => {
    h.engine.handlePresenceJoin('stranger');
    expect(h.all('removed')).toEqual([]);
  });

  it('ignores the host key', () => {
    h.engine.handlePresenceLeave('host');
    h.advance(DISCONNECT_GRACE_MS * 2);
    expect(h.engine.view().players).toHaveLength(2);
  });
});

// ---------- nobody connected ----------

describe('a question with nobody connected', () => {
  it('does not end on its own, but the teacher can still move on', () => {
    const h = makeEngine(twoQuestionQuiz());
    join(h, 'p1', 'Sam');
    h.engine.start();

    h.engine.handlePresenceLeave('p1');
    h.advance(DISCONNECT_GRACE_MS);

    expect(h.engine.view().players).toHaveLength(0);
    expect(h.engine.view().phase).toBe('question');

    h.engine.showResultsNow();
    expect(h.engine.view().phase).toBe('results');
    expect(h.last('results')!.outcomes).toEqual([]);
    expect(h.last('results')!.leaderboard).toEqual([]);
  });
});
