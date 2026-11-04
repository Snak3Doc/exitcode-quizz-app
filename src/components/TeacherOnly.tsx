/**
 * Shows the sign-in screen instead of a teacher screen when nobody approved is
 * signed in. The database enforces the same rule, so this is about what the
 * teacher sees, not about protection. SPEC 3.1.
 */

import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { SignIn } from '../teacher/SignIn';
import { S } from '../strings';

export function TeacherOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <main className="centre-page">
        <p className="dim cursor">{S.app.loading}</p>
      </main>
    );
  }

  if (!session) return <SignIn />;

  return <>{children}</>;
}
