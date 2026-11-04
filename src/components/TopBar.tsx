/** The teacher top bar: app name on the left, who is signed in on the right. */

import type { ReactNode } from 'react';
import { S } from '../strings';
import { useAuth } from '../lib/auth';

export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { email, signOut } = useAuth();

  return (
    <header className="topbar">
      <div className="row-tight">
        <span className="brand">{S.app.name}</span>
        {left}
      </div>
      <div className="row-tight">
        {right}
        {email && <span className="dim">{email}</span>}
        <button type="button" className="ghost" onClick={() => void signOut()}>
          {S.signIn.signOut}
        </button>
      </div>
    </header>
  );
}
