import { Navigate, Route, Routes } from 'react-router-dom';
import { S } from './strings';

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
    <Routes>
      <Route path="/" element={<Soon name="Join" />} />
      <Route path="/play/:code" element={<Soon name="Play" />} />
      <Route path="/teacher" element={<Soon name="Teacher" />} />
      <Route path="/teacher/quiz/:quizId" element={<Soon name="Quiz editor" />} />
      <Route path="/teacher/host/:quizId" element={<Soon name="Host" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
