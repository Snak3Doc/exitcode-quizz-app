/** My quizzes: list, new, import, host checks, duplicate, export, delete. SPEC 3.2. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S } from '../strings';
import { TopBar } from '../components/TopBar';
import {
  createQuiz,
  deleteQuiz,
  describeWhen,
  duplicateQuiz,
  insertQuestions,
  listQuizzes,
  loadQuiz,
} from '../lib/quizzes';
import { buildQuizFile, parseQuizFile, quizFileName } from '../lib/quiz-file';
import { validateQuizForHosting, type HostingProblem } from '../lib/schema';
import { MAX_IMPORT_BYTES } from '../lib/constants';
import { GenerationError, generateQuiz } from '../lib/generate';
import { GenerateQuiz, type GenerateChoices } from './GenerateQuiz';
import type { QuizSummary } from '../lib/types';

export function MyQuizzes() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [problemsFor, setProblemsFor] = useState<{
    quizId: string;
    problems: HostingProblem[];
  } | null>(null);
  const [importProblems, setImportProblems] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingNow, setGeneratingNow] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setQuizzes(await listQuizzes());
      setError(null);
    } catch {
      setError(S.errors.loadFailed);
      setQuizzes([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(S.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  function onNewQuiz() {
    void run(async () => {
      const id = await createQuiz();
      navigate(`/teacher/quiz/${id}`);
    });
  }

  async function onGenerate(choices: GenerateChoices) {
    setGeneratingNow(true);
    setGenerateError(null);
    try {
      const outcome = await generateQuiz(choices);
      // Straight into the editor. A generated quiz is a draft, and the editor
      // is where it gets read -- hosting it unread is the thing to avoid.
      navigate(`/teacher/quiz/${outcome.quizId}`, {
        state: {
          generated: true,
          note:
            outcome.dropped.length > 0
              ? S.generate.droppedSome(outcome.kept, outcome.dropped.length)
              : null,
        },
      });
    } catch (caught) {
      // GenerationError already carries wording meant for a teacher; anything
      // else is a surprise and gets the generic line.
      setGenerateError(
        caught instanceof GenerationError ? caught.message : S.generate.unreachable,
      );
    } finally {
      setGeneratingNow(false);
    }
  }

  function onDuplicate(quizId: string) {
    void run(async () => {
      await duplicateQuiz(quizId);
      await refresh();
    });
  }

  function onDelete(quizId: string) {
    void run(async () => {
      await deleteQuiz(quizId);
      setConfirmingDelete(null);
      await refresh();
    });
  }

  function onExport(quizId: string) {
    void run(async () => {
      const quiz = await loadQuiz(quizId);
      if (!quiz) throw new Error(S.errors.quizNotFound);
      downloadJson(buildQuizFile(quiz), quizFileName(quiz.title));
    });
  }

  function onHost(quizId: string) {
    void run(async () => {
      const quiz = await loadQuiz(quizId);
      if (!quiz) throw new Error(S.errors.quizNotFound);
      const problems = validateQuizForHosting(quiz);
      if (problems.length > 0) {
        setProblemsFor({ quizId, problems });
        return;
      }
      setProblemsFor(null);
      navigate(`/teacher/host/${quizId}`);
    });
  }

  async function onImportFile(file: File) {
    setImportProblems(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportProblems([S.io.importTooBig]);
      return;
    }
    const text = await file.text();
    const result = parseQuizFile(text, file.size);
    if (!result.ok || !result.quiz) {
      setImportProblems(result.problems);
      return;
    }
    void run(async () => {
      const quizId = await createQuiz(result.quiz!.title);
      await insertQuestions(quizId, result.quiz!.questions);
      await refresh();
    });
  }

  return (
    <div className="page">
      <TopBar />
      <div className="container stack-lg">
        <div className="spread">
          <h1 className="prompt">{S.quizzes.heading}</h1>
          <div className="row-tight">
            <button type="button" className="primary" onClick={onNewQuiz} disabled={busy}>
              {S.quizzes.newQuiz}
            </button>
            <button
              type="button"
              onClick={() => {
                setGenerateError(null);
                setGenerating(true);
              }}
              disabled={busy}
            >
              {S.quizzes.generate}
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              {S.quizzes.importQuiz}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onImportFile(file);
              }}
            />
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}

        {generating && (
          <div className="narrow">
            <GenerateQuiz
              busy={generatingNow}
              error={generateError}
              onCancel={() => setGenerating(false)}
              onGenerate={(choices) => void onGenerate(choices)}
            />
          </div>
        )}

        {importProblems && (
          <div className="banner error">
            <strong>{S.io.importFailed}</strong>
            <ul>
              {importProblems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
            <div>
              <button type="button" className="ghost" onClick={() => setImportProblems(null)}>
                {S.quizzes.cancel}
              </button>
            </div>
          </div>
        )}

        {quizzes === null && <p className="dim cursor">{S.app.loading}</p>}

        {quizzes !== null && quizzes.length === 0 && (
          <div className="empty-state">{S.quizzes.empty}</div>
        )}

        {quizzes !== null && quizzes.length > 0 && (
          <div className="window flush">
            <div className="rows">
              {quizzes.map((quiz) => (
                <div key={quiz.id} className="stack" style={{ padding: 0 }}>
                  <div className="row-item">
                    <div className="row-item-main">
                      <div className="mono-lg truncate">
                        {/* The full name on hover, since a long one is cut off. */}
                        <Link to={`/teacher/quiz/${quiz.id}`} title={quiz.title}>
                          {quiz.title}
                        </Link>
                      </div>
                      <div className="hint truncate">
                        {S.quizzes.questionCount(quiz.questionCount)} ·{' '}
                        {S.quizzes.editedWhen(describeWhen(quiz.updatedAt))}
                      </div>
                    </div>
                    <div className="row-tight row-item-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => onHost(quiz.id)}
                        disabled={busy}
                      >
                        {S.quizzes.host}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/teacher/quiz/${quiz.id}`)}
                      >
                        {S.quizzes.edit}
                      </button>
                      <button type="button" onClick={() => onDuplicate(quiz.id)} disabled={busy}>
                        {S.quizzes.duplicate}
                      </button>
                      <button type="button" onClick={() => onExport(quiz.id)} disabled={busy}>
                        {S.quizzes.export}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmingDelete(quiz.id)}
                        disabled={busy}
                      >
                        {S.quizzes.delete}
                      </button>
                    </div>
                  </div>

                  {confirmingDelete === quiz.id && (
                    <div className="banner error" style={{ margin: '0 12px 12px' }}>
                      <span>{S.quizzes.deleteConfirm}</span>
                      <div className="row-tight">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setConfirmingDelete(null)}
                        >
                          {S.quizzes.cancel}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDelete(quiz.id)}
                          disabled={busy}
                        >
                          {S.quizzes.delete}
                        </button>
                      </div>
                    </div>
                  )}

                  {problemsFor?.quizId === quiz.id && (
                    <div className="banner" style={{ margin: '0 12px 12px' }}>
                      <strong>{S.quizzes.cannotHost}</strong>
                      <ul>
                        {problemsFor.problems.map((problem, i) => (
                          <li key={i}>
                            {problem.questionNumber > 0
                              ? `${S.io.questionPrefix(problem.questionNumber)}${problem.message}.`
                              : problem.message}
                          </li>
                        ))}
                      </ul>
                      <div>
                        <Link to={`/teacher/quiz/${quiz.id}`}>{S.quizzes.openInEditor}</Link>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
