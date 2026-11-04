/**
 * The quiz editor: title, question list with drag-to-reorder, and the form for
 * the open question. Everything autosaves about a second after typing stops,
 * and incomplete drafts always save. SPEC 3.3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { S } from '../strings';
import { TopBar } from '../components/TopBar';
import { QuestionForm } from './QuestionForm';
import {
  blankQuestion,
  deleteQuestion as deleteQuestionRow,
  insertQuestion,
  loadQuiz,
  renameQuiz,
  savePositions,
  updateQuestion,
} from '../lib/quizzes';
import { validateQuizForHosting, type HostingProblem } from '../lib/schema';
import {
  AUTOSAVE_DELAY_MS,
  MAX_QUESTIONS_PER_QUIZ,
  MAX_TITLE_LENGTH,
} from '../lib/constants';
import type { Question } from '../lib/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function QuizEditor() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [problems, setProblems] = useState<HostingProblem[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  /** What is waiting to be written, keyed so repeated edits collapse. */
  const pending = useRef<{ title?: string; questions: Map<string, Question> }>({
    questions: new Map(),
  });
  const timer = useRef<number | null>(null);

  // ---------- load ----------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadQuiz(quizId)
      .then((quiz) => {
        if (cancelled) return;
        if (!quiz) {
          setNotFound(true);
        } else {
          setTitle(quiz.title);
          setQuestions(quiz.questions);
          setOpenId(quiz.questions[0]?.id ?? null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  // ---------- autosave ----------

  const flush = useCallback(async () => {
    const work = pending.current;
    pending.current = { questions: new Map() };
    if (work.title === undefined && work.questions.size === 0) return;

    setSaveState('saving');
    try {
      if (work.title !== undefined) await renameQuiz(quizId, work.title);
      for (const question of work.questions.values()) {
        await updateQuestion(question);
      }
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [quizId]);

  const scheduleSave = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, AUTOSAVE_DELAY_MS);
  }, [flush]);

  // Don't lose the last second of typing when the teacher leaves the editor.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  function editTitle(next: string) {
    setTitle(next);
    pending.current.title = next;
    scheduleSave();
  }

  function editQuestion(next: Question) {
    setQuestions((current) => current.map((q) => (q.id === next.id ? next : q)));
    pending.current.questions.set(next.id, next);
    setProblems(null);
    scheduleSave();
  }

  // ---------- question list ----------

  async function addQuestion() {
    if (questions.length >= MAX_QUESTIONS_PER_QUIZ) return;
    setSaveState('saving');
    try {
      const created = await insertQuestion(blankQuestion(quizId, questions.length));
      setQuestions((current) => [...current, created]);
      setOpenId(created.id);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function duplicateQuestion(question: Question) {
    if (questions.length >= MAX_QUESTIONS_PER_QUIZ) return;
    setSaveState('saving');
    try {
      const index = questions.findIndex((q) => q.id === question.id);
      const { id: _id, ...fields } = question;
      const created = await insertQuestion({ ...fields, position: index + 1 });
      const next = [...questions];
      next.splice(index + 1, 0, created);
      setQuestions(next);
      setOpenId(created.id);
      await savePositions(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function removeQuestion(questionId: string) {
    setConfirmingDelete(null);
    setSaveState('saving');
    try {
      await deleteQuestionRow(questionId);
      const next = questions.filter((q) => q.id !== questionId);
      setQuestions(next);
      if (openId === questionId) setOpenId(next[0]?.id ?? null);
      pending.current.questions.delete(questionId);
      await savePositions(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = questions.findIndex((q) => q.id === active.id);
    const to = questions.findIndex((q) => q.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(questions, from, to).map((q, index) => ({
      ...q,
      position: index,
    }));
    setQuestions(next);
    setSaveState('saving');
    try {
      await savePositions(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  // ---------- host ----------

  async function onHost() {
    // Write anything still waiting, so the checks see what is on screen.
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    await flush();
    const found = validateQuizForHosting({ title, questions });
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    navigate(`/teacher/host/${quizId}`);
  }

  const openQuestion = useMemo(
    () => questions.find((q) => q.id === openId) ?? null,
    [questions, openId],
  );

  if (loading) {
    return (
      <div className="page">
        <TopBar />
        <main className="centre-page">
          <p className="dim cursor">{S.app.loading}</p>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page">
        <TopBar />
        <main className="centre-page">
          <div className="banner error">{S.errors.quizNotFound}</div>
          <Link to="/teacher">{S.editor.backToQuizzes}</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar
        left={
          <>
            <Link to="/teacher" className="nowrap">
              {S.editor.backToQuizzes}
            </Link>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              aria-label={S.editor.titleLabel}
              style={{ minWidth: 220 }}
              onChange={(e) => editTitle(e.target.value)}
            />
            <SaveTag state={saveState} />
          </>
        }
        right={
          <button type="button" className="primary" onClick={() => void onHost()}>
            {S.editor.hostThisQuiz}
          </button>
        }
      />

      <div className="container stack-lg">
        {problems && (
          <div className="banner">
            <strong>{S.editor.problemsHeading}</strong>
            <ul>
              {problems.map((problem, i) => (
                <li key={i}>
                  {problem.questionNumber > 0 ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        const target = questions[problem.questionNumber - 1];
                        if (target) setOpenId(target.id);
                      }}
                    >
                      {S.io.questionPrefix(problem.questionNumber)}
                      {problem.message}
                    </button>
                  ) : (
                    problem.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="two-col">
          <div className="window flush">
            <div className="title-bar">
              <span>{S.editor.questions}</span>
              <span className="dim">{questions.length}/{MAX_QUESTIONS_PER_QUIZ}</span>
            </div>
            <div className="body">
              {questions.length === 0 && (
                <div className="empty-state">{S.editor.noQuestions}</div>
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => void onDragEnd(event)}
              >
                <SortableContext
                  items={questions.map((q) => q.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="rows">
                    {questions.map((question, index) => (
                      <QuestionRow
                        key={question.id}
                        question={question}
                        index={index}
                        open={question.id === openId}
                        confirming={confirmingDelete === question.id}
                        onOpen={() => setOpenId(question.id)}
                        onDuplicate={() => void duplicateQuestion(question)}
                        onAskDelete={() => setConfirmingDelete(question.id)}
                        onCancelDelete={() => setConfirmingDelete(null)}
                        onDelete={() => void removeQuestion(question.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="stack" style={{ padding: 12 }}>
                <button
                  type="button"
                  onClick={() => void addQuestion()}
                  disabled={questions.length >= MAX_QUESTIONS_PER_QUIZ}
                >
                  {S.editor.addQuestion}
                </button>
                {questions.length >= MAX_QUESTIONS_PER_QUIZ && (
                  <p className="hint">{S.editor.maxQuestions(MAX_QUESTIONS_PER_QUIZ)}</p>
                )}
              </div>
            </div>
          </div>

          {openQuestion ? (
            <QuestionForm
              key={openQuestion.id}
              question={openQuestion}
              onChange={editQuestion}
            />
          ) : (
            <div className="empty-state">{S.editor.selectAQuestion}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveTag({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className="tag saving">{S.editor.saving}</span>;
  if (state === 'error') return <span className="tag error">{S.editor.saveFailed}</span>;
  return <span className="tag saved">{S.editor.saved}</span>;
}

function QuestionRow({
  question,
  index,
  open,
  confirming,
  onOpen,
  onDuplicate,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  question: Question;
  index: number;
  open: boolean;
  confirming: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });

  const preview = question.prompt.trim() || question.code?.trim() || '—';

  return (
    <div
      ref={setNodeRef}
      className={`row-item ${open ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={S.editor.dragToReorder}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>

      <button
        type="button"
        className="grow"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 'none',
          textAlign: 'left',
          padding: 0,
          fontWeight: open ? 700 : 400,
          minWidth: 0,
        }}
      >
        <div
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {index + 1}. {preview}
        </div>
        <div>
          <span className="tag">{S.types[question.type]}</span>
        </div>
      </button>

      {confirming ? (
        <span className="row-tight">
          <span className="hint">{S.editor.deleteQuestionConfirm}</span>
          <button type="button" className="icon" onClick={onCancelDelete}>
            {S.quizzes.cancel}
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            {S.quizzes.delete}
          </button>
        </span>
      ) : (
        <span className="row-tight">
          <button
            type="button"
            className="icon"
            title={S.editor.duplicateQuestion}
            onClick={onDuplicate}
          >
            ⧉
          </button>
          <button
            type="button"
            className="icon"
            title={S.editor.deleteQuestion}
            onClick={onAskDelete}
          >
            ✕
          </button>
        </span>
      )}
    </div>
  );
}
