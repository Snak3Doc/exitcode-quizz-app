/**
 * The projector: lobby, question, results and final. All the teacher's
 * controls live here, on the laptop plugged into the projector. SPEC 3.6.
 *
 * The game itself is the HostEngine; this screen only draws it and passes on
 * clicks. Refreshing or closing this tab ends the game.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { S } from '../strings';
import { GameChannel, HOST_PRESENCE_KEY, findFreeShareCode } from '../lib/channel';
import { HostEngine, type HostView } from '../lib/host-engine';
import { loadQuiz } from '../lib/quizzes';
import { correctAnswerFor, generateShareCode, ordinal } from '../lib/game-logic';
import { validateQuizForHosting } from '../lib/schema';
import {
  AnswerPreview,
  CorrectAnswerView,
  QuestionBody,
  ResultMark,
} from '../components/QuestionView';
import type { FullQuiz, LeaderboardEntry } from '../lib/types';

export function HostGame() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();

  const [quiz, setQuiz] = useState<FullQuiz | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<HostView | null>(null);

  const engineRef = useRef<HostEngine | null>(null);
  const channelRef = useRef<GameChannel | null>(null);

  // ---------- set the game up once ----------

  useEffect(() => {
    let cancelled = false;
    let channel: GameChannel | null = null;

    async function create() {
      try {
        const loaded = await loadQuiz(quizId);
        if (!loaded) throw new Error(S.errors.quizNotFound);
        // Checked again here: the quiz may have changed since My quizzes.
        if (validateQuizForHosting(loaded).length > 0) {
          throw new Error(S.quizzes.cannotHost);
        }
        if (cancelled) return;
        setQuiz(loaded);

        const shareCode = await findFreeShareCode(() => generateShareCode());
        if (cancelled) return;

        channel = new GameChannel({
          code: shareCode,
          presenceKey: HOST_PRESENCE_KEY,
          onPresenceJoin: (key) => engineRef.current?.handlePresenceJoin(key),
          onPresenceLeave: (key) => engineRef.current?.handlePresenceLeave(key),
        });

        const engine = new HostEngine({
          quiz: loaded,
          send: (event, payload) => channel?.send(event, payload),
          onChange: () => setView(engineRef.current?.view() ?? null),
        });
        engineRef.current = engine;

        channel.on('join_request', (payload) => engine.handleJoinRequest(payload));
        channel.on('submit', (payload) => engine.handleSubmit(payload));

        await channel.subscribe();
        if (cancelled) return;
        // Presence last: once the host is visible, students may join.
        await channel.track({ role: 'host' });
        if (cancelled) return;

        channelRef.current = channel;
        setCode(shareCode);
        setView(engine.view());
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : S.host.gameCreateFailed);
      }
    }

    void create();

    return () => {
      cancelled = true;
      // Closing or refreshing the host tab ends the game.
      engineRef.current?.end('host_left');
      void channel?.leave();
      engineRef.current = null;
      channelRef.current = null;
    };
  }, [quizId]);

  // ---------- the clock ----------

  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.tick(Date.now());
      setView(engine.view());
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Best effort: tell the students before the tab goes away.
  useEffect(() => {
    function onLeave() {
      channelRef.current?.send('game_ended', { reason: 'host_left' });
    }
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const leave = useCallback(() => {
    engineRef.current?.end('cancelled');
    navigate('/teacher');
  }, [navigate]);

  // ---------- screens ----------

  if (error) {
    return (
      <main className="centre-page projector">
        <div className="banner error">{error}</div>
        <button type="button" onClick={() => navigate('/teacher')}>
          {S.host.backToMyQuizzes}
        </button>
      </main>
    );
  }

  if (!quiz || !code || !view) {
    return (
      <main className="centre-page projector">
        <p className="dim cursor">{S.host.creatingGame}</p>
      </main>
    );
  }

  if (view.phase === 'lobby') {
    return <Lobby quiz={quiz} code={code} view={view} onStart={() => engineRef.current?.start()} onCancel={leave} />;
  }

  if (view.phase === 'question' && view.question) {
    return (
      <QuestionScreen
        view={view}
        onShowResults={() => engineRef.current?.showResultsNow()}
      />
    );
  }

  if (view.phase === 'results' && view.results) {
    return (
      <ResultsScreen view={view} onNext={() => engineRef.current?.next()} />
    );
  }

  if (view.phase === 'final') {
    return <FinalScreen leaderboard={view.leaderboard} onDone={leave} />;
  }

  return (
    <main className="centre-page projector">
      <p className="dim">{S.host.notSaved}</p>
      <button type="button" onClick={() => navigate('/teacher')}>
        {S.host.backToMyQuizzes}
      </button>
    </main>
  );
}

// ---------- lobby ----------

function Lobby({
  quiz,
  code,
  view,
  onStart,
  onCancel,
}: {
  quiz: FullQuiz;
  code: string;
  view: HostView;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <main className="container stack-lg projector">
      <div className="window">
        <div className="title-bar">{S.app.name}</div>
        <div className="body big-centre">
          <p className="dim" style={{ margin: 0 }}>
            {S.host.joinInstructions(window.location.host)}
          </p>
          <div className="share-code cursor">{code.split('').join(' ')}</div>
          <p style={{ margin: 0 }}>
            {S.host.quizLine(quiz.title, quiz.questions.length)}
          </p>
        </div>
      </div>

      <div className="window">
        <div className="title-bar">{S.host.playersJoined(view.players.length)}</div>
        <div className="body">
          {view.players.length === 0 ? (
            <p className="dim cursor">{S.host.noPlayersYet}</p>
          ) : (
            <div className="chips">
              {view.players.map((player) => (
                <span key={player.id} className="chip">
                  {player.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="row">
        <button
          type="button"
          className="primary big"
          disabled={view.players.length === 0}
          onClick={onStart}
        >
          {S.host.startGame}
        </button>
        <button type="button" onClick={onCancel}>
          {S.host.cancelGame}
        </button>
        {view.players.length === 0 && <span className="hint">{S.host.startHint}</span>}
      </div>
    </main>
  );
}

// ---------- question ----------

function QuestionScreen({
  view,
  onShowResults,
}: {
  view: HostView;
  onShowResults: () => void;
}) {
  const question = view.question!;
  return (
    <main className="container stack-lg projector">
      <div className="spread">
        <h1>{S.play.questionOf(view.index + 1, view.total)}</h1>
        <div className="row-tight">
          <span className="tag accent">{S.types[question.type]}</span>
          {view.remainingMs !== null && <Countdown remainingMs={view.remainingMs} />}
          <span className="dim">
            {S.host.submittedCount(view.submitted.size, view.players.length)}
          </span>
        </div>
      </div>

      <div className="window">
        <div className="body">
          <QuestionBody
            prompt={question.prompt}
            code={question.code}
            codeLanguage={question.codeLanguage}
          />
        </div>
      </div>

      <div className="window">
        <div className="body">
          <AnswerPreview
            type={question.type}
            content={publicContentForProjector(view)}
          />
        </div>
      </div>

      <div className="window">
        <div className="title-bar">{S.host.whoHasAnswered}</div>
        <div className="body">
          <div className="chips">
            {view.players.map((player) => (
              <span key={player.id} className="chip">
                {player.name}
                {view.submitted.has(player.id) ? (
                  <span className="mark correct">✓ {S.host.submitted}</span>
                ) : (
                  <span className="dim">{S.host.waiting}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <button type="button" className="primary big" onClick={onShowResults}>
          {S.host.showResultsNow}
        </button>
      </div>
    </main>
  );
}

/**
 * The projector shows the same content the students got, without the answers.
 * Order-the-lines is shown in the teacher's order, since every student has a
 * different shuffle and the class needs one shared reference.
 */
function publicContentForProjector(view: HostView): Record<string, unknown> {
  const question = view.question!;
  switch (question.type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = (question.content.options as Array<Record<string, unknown>>) ?? [];
      return {
        options: options.map(({ id, kind, language, text }) => ({
          id,
          kind,
          language,
          text,
        })),
      };
    }
    case 'fill_blank':
      return {
        language: question.content.language,
        snippet: question.content.snippet,
        wordBank: question.content.wordBank,
      };
    case 'order_lines':
      return { language: question.content.language, lines: question.content.lines };
    default:
      return {};
  }
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

// ---------- results ----------

function ResultsScreen({ view, onNext }: { view: HostView; onNext: () => void }) {
  const results = view.results!;
  const last = view.index >= view.total - 1;
  const byId = new Map(view.players.map((p) => [p.id, p.name]));

  return (
    <main className="container stack-lg projector">
      <div className="spread">
        <h1>{S.host.resultsHeading(results.index + 1, results.total)}</h1>
        <span className="tag accent">{S.types[results.question.type]}</span>
      </div>

      <div className="two-col-even">
        <div className="stack-lg">
          <div className="window">
            <div className="title-bar">{S.host.correctAnswer}</div>
            <div className="body">
              <CorrectAnswerView correct={correctAnswerFor(results.question)} />
            </div>
          </div>
          {results.question.explanation && (
            <div className="window">
              <div className="title-bar">{S.host.explanation}</div>
              <div className="body">
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {results.question.explanation}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="window">
          <div className="title-bar">{S.host.leaderboard}</div>
          <div className="body">
            <table>
              <thead>
                <tr>
                  <th>{S.host.colRank}</th>
                  <th>{S.host.colName}</th>
                  <th>{S.host.colThisQ}</th>
                  <th className="num">{S.host.colTotal}</th>
                </tr>
              </thead>
              <tbody>
                {results.leaderboard.map((entry) => {
                  const outcome = results.outcomes.get(entry.playerId);
                  const points = (outcome?.base ?? 0) + (outcome?.bonus ?? 0);
                  return (
                    <tr key={entry.playerId}>
                      <td>{entry.rank}</td>
                      <td>{byId.get(entry.playerId) ?? entry.name}</td>
                      <td>
                        <ResultMark status={outcome?.status ?? 'none'} />{' '}
                        <span className="dim">+{points}</span>
                      </td>
                      <td className="num">{entry.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">{S.host.marksKey}</p>
          </div>
        </div>
      </div>

      <div>
        <button type="button" className="primary big" onClick={onNext}>
          {last ? S.host.finishGame : S.host.nextQuestion}
        </button>
      </div>
    </main>
  );
}

// ---------- final ----------

function FinalScreen({
  leaderboard,
  onDone,
}: {
  leaderboard: LeaderboardEntry[];
  onDone: () => void;
}) {
  const top = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const places = ['first', 'second', 'third'] as const;

  return (
    <main className="container stack-lg projector">
      <h1 className="prompt">{S.play.gameOver}</h1>

      {top.length > 0 && (
        <div className="window">
          <div className="title-bar">{S.host.topThree}</div>
          <div className="body">
            <div className="podium">
              {top.map((entry, index) => (
                <div key={entry.playerId} className={`place ${places[index]}`}>
                  <div className="rank">{ordinal(entry.rank)}</div>
                  <div className="name">{entry.name}</div>
                  <div className="points">{entry.total}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div className="window">
          <div className="title-bar">{S.host.everyoneElse}</div>
          <div className="body">
            <table>
              <tbody>
                {rest.map((entry) => (
                  <tr key={entry.playerId}>
                    <td style={{ width: 60 }}>{entry.rank}</td>
                    <td>{entry.name}</td>
                    <td className="num">{entry.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="row">
        <button type="button" className="primary big" onClick={onDone}>
          {S.host.backToMyQuizzes}
        </button>
        <span className="hint">{S.host.notSaved}</span>
      </div>
    </main>
  );
}
