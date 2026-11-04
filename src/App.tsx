import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { TeacherOnly } from './components/TeacherOnly';
import { MyQuizzes } from './teacher/MyQuizzes';
import { QuizEditor } from './teacher/QuizEditor';
import { HostGame } from './host/HostGame';
import { Join } from './student/Join';
import { Play } from './student/Play';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/play/:code" element={<Play />} />
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
              <HostGame />
            </TeacherOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
