/**
 * The student's game at /play/:code — waiting room, question, answer locked,
 * result, final, and the two ways a game can end for them. SPEC 3.7, 3.10.
 *
 * The student never touches the database. Everything arrives over the game
 * channel, and correct answers only arrive with the results.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { S } from '../strings';
import { GameChannel } from '../lib/channel';
import {
  HOST_GONE_GRACE_MS,
  JOIN_REPLY_TIMEOUT_MS,
  SESSION_MARKER_KEY,
} from '../lib/constants';
import {
  isAnswerSubmittable,
  normaliseShareCode,
  ordinal,
} from '../lib/game-logic';
import { AnswerControls } from './AnswerControls';
import {
  CorrectAnswerView,
  QuestionBody,
  ResultMark,
} from '../components/QuestionView';
import type { PendingJoin } from './Join';
import type {
  AnswerValue,
  JoinRejectReason,
  Messages,
  Player,
  PublicQuestion,
} from '../lib/types';

type Screen =
  | 'connecting'
  | 'waiting'
  | 'question'
  | 'locked'
  | 'result'
  | 'final'
  | 'removed'
  | 'host_left'
  | 'error';

interface ResultState {
  results: Messages['results'];
  myOutcome: Messages['results']['outcomes'][number] | undefined;
  myEntry: Messages['results']['leaderboard'][number] | undefined;
}

export function Play() {
  const { code: rawCode = '' } = useParams();
  const code = normaliseShareCode(rawCode);
  const navigate = useNavigate();
  const location = useLocation();
  const pending = location.state as PendingJoin | null;

  const [screen, setScreen] = useState<Screen>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(pending?.name ?? '');
  const [players, setPlayers] = useState<Player[]>([]);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [answer, setAnswer] = useState<AnswerValue | undefined>(undefined);
  const [progress, setProgress] = useState({ submitted: 0, total: 0 });
  const [result, setResult] = useState<ResultState | null>(null);
  const [finalBoard, setFinalBoard] = useState<Messages['final'] | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const channelRef = useRef<GameChannel | null>(null);
  const playerIdRef = useRef<string>('');
  /** When the current question's countdown runs out, by this laptop's clock. */
  const deadlineRef = useRef<number | null>(null);
  const hostGoneSinceRef = useRef<number | null>(null);
  const screenRef = useRef<Screen>('connecting');
  screenRef.current = screen;

  // ---------- join ----------

  useEffect(() => {
    const action = openAction(readMarker(), pending, code);
    if (action === 'left') {
      // The marker stays until they go back to the join screen, so that this
      // effect reaches the same decision every time it runs. Clearing it here
      // would let React's development double-invoke join the game for real on
      // the second pass, behind the screen telling them they have left.
      setScreen('removed');
      return;
    }
    if (action === 'home') {
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;
    let channel: GameChannel | null = null;
    const playerId = crypto.randomUUID();
    playerIdRef.current = playerId;

    async function join() {
      try {
        channel = new GameChannel({
          code,
          presenceKey: playerId,
          onPresenceLeave: (key) => {
            if (key === 'host') hostGoneSinceRef.current = Date.now();
          },
          onPresenceJoin: (key) => {
            if (key === 'host') hostGoneSinceRef.current = null;
          },
        });

        await channel.subscribe();
        if (cancelled) return;

        const hostThere = await channel.waitForHost();
        if (cancelled) return;
        if (!hostThere) {
          setError(S.join.notFound);
          setScreen('error');
          return;
        }

        const reply = new Promise<Messages['join_accepted'] | JoinRejectReason>(
          (resolve) => {
            channel!.on('join_accepted', (payload) => {
              if (payload.playerId === playerId) resolve(payload);
            });
            channel!.on('join_rejected', (payload) => {
              if (payload.playerId === playerId) resolve(payload.reason);
            });
            window.setTimeout(() => resolve('timeout' as never), JOIN_REPLY_TIMEOUT_MS);
          },
        );

        channel.send('join_request', { playerId, name: pending!.name });
        const answered = await reply;
        if (cancelled) return;

        if (typeof answered === 'string') {
          setError(rejectionMessage(answered));
          setScreen('error');
          await channel.leave();
          channel = null;
          return;
        }

        // Only now does the host count us as connected.
        await channel.track({ playerId });
        if (cancelled) return;

        channelRef.current = channel;
        playerIdRef.current = playerId;
        setName(pending!.name);
        setPlayers(answered.players);
        setScreen('waiting');
        writeMarker({ code, playerId });

        channel.on('players', (payload) => setPlayers(payload.players));

        channel.on('question', (payload) => {
          setQuestion(payload);
          setAnswer(undefined);
          setResult(null);
          deadlineRef.current =
            payload.timing.mode === 'timed' && payload.timing.remainingMs !== undefined
              ? Date.now() + payload.timing.remainingMs
              : null;
          setRemainingMs(payload.timing.remainingMs ?? null);
          setScreen('question');
        });

        channel.on('progress', (payload) => setProgress(payload));

        channel.on('results', (payload) => {
          deadlineRef.current = null;
          setRemainingMs(null);
          setResult({
            results: payload,
            myOutcome: payload.outcomes.find((o) => o.playerId === playerId),
            myEntry: payload.leaderboard.find((e) => e.playerId === playerId),
          });
          setScreen('result');
        });

        channel.on('final', (payload) => {
          setFinalBoard(payload);
          setScreen('final');
          clearMarker();
        });

        channel.on('removed', (payload) => {
          if (payload.playerId !== playerId) return;
          setScreen('removed');
          clearMarker();
        });

        channel.on('game_ended', () => {
          if (screenRef.current === 'final') return;
          setScreen('host_left');
          clearMarker();
        });
      } catch {
        if (cancelled) return;
        setError(S.join.unreachable);
        setScreen('error');
      }
    }

    void join();

    return () => {
      cancelled = true;
      void channel?.leave();
      channelRef.current = null;
    };
    // Joining happens once, for this code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---------- countdown and noticing the teacher has gone ----------

  useEffect(() => {
    const id = window.setInterval(() => {
      if (deadlineRef.current !== null) {
        setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
      }
      const goneSince = hostGoneSinceRef.current;
      if (
        goneSince !== null &&
        Date.now() - goneSince >= HOST_GONE_GRACE_MS &&
        screenRef.current !== 'final' &&
        screenRef.current !== 'removed' &&
        screenRef.current !== 'error'
      ) {
        setScreen('host_left');
        clearMarker();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const submit = useCallback(() => {
    if (!question) return;
    const toSend =
      answer === undefined && question.type === 'order_lines'
        ? ((question.content.lines as Array<{ id: string }>) ?? []).map((l) => l.id)
        : answer;
    if (toSend === undefined) return;
    channelRef.current?.send('submit', {
      playerId: playerIdRef.current,
      questionIndex: question.index,
      answer: toSend,
    });
    setScreen('locked');
  }, [answer, question]);

  // ---------- screens ----------

  if (screen === 'connecting') {
    return (
      <main className="centre-page">
        <p className="dim cursor">{S.play.connecting}</p>
      </main>
    );
  }

  if (screen === 'error') {
    return (
      <Message
        heading={S.app.name}
        body={error ?? S.join.unreachable}
        onBack={() => navigate('/')}
      />
    );
  }

  if (screen === 'removed') {
    return (
      <Message
        heading={S.play.leftHeading}
        body={S.play.leftBody}
        onBack={() => {
          clearMarker();
          navigate('/');
        }}
      />
    );
  }

  if (screen === 'host_left') {
    return (
      <Message
        heading={S.play.teacherLeftHeading}
        body={S.play.teacherLeftBody}
        onBack={() => navigate('/')}
      />
    );
  }

  if (screen === 'waiting') {
    return (
      <main className="centre-page">
        <div className="narrow window">
          <div className="title-bar">{S.app.name}</div>
          <div className="body big-centre">
            <h1>{S.play.youreIn(name)}</h1>
            <p className="dim cursor">{S.play.waitingForStart}</p>
            <div className="chips">
              {players.map((player) => (
                <span key={player.id} className="chip">
                  {player.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'final' && finalBoard) {
    const mine = finalBoard.leaderboard.find((e) => e.playerId === playerIdRef.current);
    return (
      <main className="centre-page">
        <div className="narrow window">
          <div className="title-bar">{S.app.name}</div>
          <div className="body big-centre">
            <h1 className="prompt">{S.play.gameOver}</h1>
            {mine && (
              <p className="mono-lg">
                {S.play.finishedWith(ordinal(mine.rank), mine.total)}
              </p>
            )}
            <button type="button" className="primary" onClick={() => navigate('/')}>
              {S.play.joinAnotherGame}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'result' && result) {
    const { myOutcome, myEntry, results } = result;
    const status = myOutcome?.status ?? 'none';
    const heading = {
      correct: S.play.correct,
      partial: S.play.partlyCorrect,
      wrong: S.play.notQuite,
      none: S.play.noAnswer,
    }[status];

    return (
      <main className="container stack-lg">
        <div className="window">
          <div className="title-bar">
            <span>{name}</span>
            <span>{S.play.questionOf(results.index + 1, results.total)}</span>
          </div>
          <div className="body stack-lg">
            <div className="big-centre">
              <h1>
                <ResultMark status={status} /> {heading}
              </h1>
              <p className="points">
                {S.play.points(myOutcome?.base ?? 0)}
                {myOutcome && myOutcome.bonus > 0 && (
                  <>
                    {' · '}
                    <span className="bonus">{S.play.speedBonus(myOutcome.bonus)}</span>
                  </>
                )}
              </p>
            </div>

            <div className="window">
              <div className="title-bar">{S.play.correctAnswer}</div>
              <div className="body">
                <CorrectAnswerView correct={results.correct} />
              </div>
            </div>

            {results.explanation && (
              <div className="window">
                <div className="title-bar">{S.host.explanation}</div>
                <div className="body">
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{results.explanation}</p>
                </div>
              </div>
            )}

            {myEntry && (
              <div className="spread">
                <span>{S.play.yourRank(ordinal(myEntry.rank))}</span>
                <span className="points">{S.play.total(myEntry.total)}</span>
              </div>
            )}

            <p className="dim cursor" style={{ textAlign: 'center' }}>
              {S.play.waitingForTeacher}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'locked' && question) {
    return (
      <main className="centre-page">
        <div className="narrow window">
          <div className="title-bar">
            <span>{name}</span>
            <span>{S.play.questionOf(question.index + 1, question.total)}</span>
          </div>
          <div className="body big-centre">
            <h1>{S.play.answerSubmitted}</h1>
            <p className="dim cursor">
              {S.play.waitingForOthers(progress.submitted, progress.total)}
            </p>
            <p className="hint">{S.play.cannotChange}</p>
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'question' && question) {
    const ready = isAnswerSubmittable(question.type, question.content, answer);
    return (
      <main className="container stack-lg">
        <div className="window">
          <div className="title-bar">
            <span>{name}</span>
            <span className="row-tight">
              <span>{S.play.questionOf(question.index + 1, question.total)}</span>
              {remainingMs !== null && <Countdown remainingMs={remainingMs} />}
            </span>
          </div>
          <div className="body stack-lg">
            <QuestionBody
              prompt={question.prompt}
              code={question.code}
              codeLanguage={question.codeLanguage}
            />

            <AnswerControls
              type={question.type}
              content={question.content}
              answer={answer}
              onChange={setAnswer}
            />

            <button
              type="button"
              className="primary big"
              disabled={!ready}
              onClick={submit}
            >
              {S.play.submitAnswer}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="centre-page">
      <p className="dim cursor">{S.play.connecting}</p>
    </main>
  );
}

function Countdown({ remainingMs }: { remainingMs: number }) {
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return (
    <span className={`timer ${seconds <= 5 ? 'low' : ''}`}>
      {minutes}:{String(rest).padStart(2, '0')}
    </span>
  );
}

function Message({
  heading,
  body,
  onBack,
}: {
  heading: string;
  body: string;
  onBack: () => void;
}) {
  return (
    <main className="centre-page">
      <div className="narrow window">
        <div className="title-bar">{S.app.name}</div>
        <div className="body big-centre">
          <h1>{heading}</h1>
          <p className="dim">{body}</p>
          <button type="button" onClick={onBack}>
            {S.play.backToJoin}
          </button>
        </div>
      </div>
    </main>
  );
}

function rejectionMessage(reason: JoinRejectReason | 'timeout'): string {
  switch (reason) {
    case 'name_taken':
      return S.join.nameTaken;
    case 'started':
      return S.join.alreadyStarted;
    case 'full':
      return S.join.gameFull;
    case 'bad_name':
      return S.join.badName;
    default:
      return S.join.unreachable;
  }
}

// ---------- remembering that this tab was in a game ----------

/**
 * What a tab should do when /play/:code opens.
 *
 * A refresh loses the game: there is no rejoining. The marker, not `pending`,
 * is what says this tab has already been in this game — React Router keeps
 * location.state in history.state, which the browser restores on a reload, so
 * `pending` survives a refresh too and cannot tell a refresh from a fresh join.
 */
export function openAction(
  marker: { code: string; playerId: string } | null,
  pending: PendingJoin | null,
  code: string,
): 'left' | 'join' | 'home' {
  if (marker && marker.code === code) return 'left';
  if (!pending) return 'home';
  return 'join';
}

function writeMarker(marker: { code: string; playerId: string }) {
  try {
    sessionStorage.setItem(SESSION_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // A locked-down browser just loses the "you've left" message.
  }
}

function readMarker(): { code: string; playerId: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_MARKER_KEY);
    return raw ? (JSON.parse(raw) as { code: string; playerId: string }) : null;
  } catch {
    return null;
  }
}

function clearMarker() {
  try {
    sessionStorage.removeItem(SESSION_MARKER_KEY);
  } catch {
    // Nothing to do.
  }
}
