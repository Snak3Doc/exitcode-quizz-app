import { Navigate, Route, Routes } from 'react-router-dom';
import { S } from './strings';
import { AuthProvider } from './lib/auth';
import { TeacherOnly } from './components/TeacherOnly';
import { MyQuizzes } from './teacher/MyQuizzes';
import { QuizEditor } from './teacher/QuizEditor';

/** Placeholder until the screen for a route is built. */
function Soon({ name }: { name: string }) {
  return (
    <main className="centre-page">
      <div className="narrow window">
        <div className="title-bar">{S.app.name}</div>
        <div className="body">
          <h1 className="prompt">{name}</h1>
          <p className="dim">Not built yet.</p>
        </div>
      </div>
    </main>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Soon name="Join" />} />
        <Route path="/play/:code" element={<Soon name="Play" />} />
        <Route
          path="/teacher"
          element={
            <TeacherOnly>
              <MyQuizzes />
            </TeacherOnly>
          }
        />
        <Route
          path="/teacher/quiz/:quizId"
          element={
            <TeacherOnly>
              <QuizEditor />
            </TeacherOnly>
          }
        />
        <Route
          path="/teacher/host/:quizId"
          element={
            <TeacherOnly>
              <Soon name="Host" />
            </TeacherOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
