/**
 * @vitest-environment jsdom
 *
 * Reading a generated question and moving on marks it read.
 *
 * This is the one bit of the unread flag that could not be checked by hand
 * without generating a quiz, so it is worth a test with the data layer mocked:
 * the question is whether leaving a question actually saves, not whether the
 * badge disappears from the screen.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FullQuiz, Question } from '../lib/types';

const updateQuestion = vi.fn<(question: Question) => Promise<void>>(async () => {});
const loadQuiz = vi.fn<(quizId: string) => Promise<FullQuiz | null>>();

vi.mock('../components/TopBar', () => ({
  TopBar: ({ left }: { left?: React.ReactNode }) => <div>{left}</div>,
}));

vi.mock('../lib/generate', () => ({
  GenerationError: class extends Error {},
  regenerateQuestion: vi.fn(),
}));

vi.mock('../lib/quizzes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/quizzes')>();
  return {
    ...actual,
    loadQuiz: (quizId: string) => loadQuiz(quizId),
    updateQuestion: (question: Question) => updateQuestion(question),
    renameQuiz: vi.fn(async () => {}),
    insertQuestion: vi.fn(),
    deleteQuestion: vi.fn(async () => {}),
    savePositions: vi.fn(async () => {}),
  };
});

const { QuizEditor } = await import('./QuizEditor');

function question(position: number, generatedAt: string | null): Question {
  return {
    id: `q${position}`,
    quizId: 'z1',
    position,
    type: 'true_false',
    prompt: `Question ${position + 1}`,
    code: null,
    codeLanguage: null,
    timingMode: 'wait',
    timeLimitSeconds: null,
    explanation: null,
    content: { correct: true },
    generatedAt,
  };
}

const UNREAD = '2026-11-05T00:00:00Z';

function renderEditor(quiz: FullQuiz) {
  loadQuiz.mockResolvedValue(quiz);
  render(
    <MemoryRouter initialEntries={['/teacher/quiz/z1']}>
      <Routes>
        <Route path="/teacher/quiz/:quizId" element={<QuizEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

const quiz: FullQuiz = {
  id: 'z1',
  title: 'A quiz',
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  questions: [question(0, UNREAD), question(1, UNREAD), question(2, UNREAD)],
};

beforeEach(() => {
  updateQuestion.mockClear();
  loadQuiz.mockReset();
});

describe('moving off a generated question', () => {
  it('marks the one you left as read, and not the one you moved to', async () => {
    const user = userEvent.setup();
    renderEditor(quiz);
    await screen.findByText('1. Question 1');

    // Question 1 opens by itself. Moving to question 2 means question 1 has
    // been looked at; question 2 has not.
    await user.click(screen.getByText('2. Question 2'));

    await waitFor(() => expect(updateQuestion).toHaveBeenCalled(), { timeout: 3000 });
    const saved = updateQuestion.mock.calls.map((c) => c[0]);
    expect(saved.map((q) => q.id)).toEqual(['q0']);
    expect(saved[0].generatedAt).toBeNull();
  });

  it('does not mark anything read just by opening the quiz', async () => {
    renderEditor(quiz);
    await screen.findByText('1. Question 1');

    // Selecting a question is not reading it, so nothing is saved until the
    // teacher moves on. Clearing on the way in would make the badge vanish
    // before they had looked at anything.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it('leaves a question that was already read alone', async () => {
    const user = userEvent.setup();
    renderEditor({
      ...quiz,
      questions: [question(0, null), question(1, UNREAD), question(2, UNREAD)],
    });
    await screen.findByText('1. Question 1');

    await user.click(screen.getByText('2. Question 2'));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it('marks each one read as the teacher works down the list', async () => {
    const user = userEvent.setup();
    renderEditor(quiz);
    await screen.findByText('1. Question 1');

    await user.click(screen.getByText('2. Question 2'));
    await user.click(screen.getByText('3. Question 3'));

    await waitFor(
      () => {
        const ids = updateQuestion.mock.calls.map((c) => c[0].id);
        expect(ids).toContain('q0');
        expect(ids).toContain('q1');
      },
      { timeout: 3000 },
    );
    // The one still open has not been left yet.
    const ids = updateQuestion.mock.calls.map((c) => c[0].id);
    expect(ids).not.toContain('q2');
  });
});
