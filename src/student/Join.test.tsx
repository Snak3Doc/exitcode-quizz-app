/**
 * @vitest-environment jsdom
 *
 * The join screen, which is also where a teacher finds their way in.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Join } from './Join';
import { S } from '../strings';

function renderJoin() {
  return render(
    <MemoryRouter>
      <Join />
    </MemoryRouter>,
  );
}

describe('the join screen', () => {
  it('asks a student for a code and a name', () => {
    renderJoin();
    expect(screen.getByLabelText(S.join.codeLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(S.join.nameLabel)).toBeInTheDocument();
  });

  it('offers teachers a way to their own screens', () => {
    renderJoin();
    // Students have no account, so this link is only useful to a teacher —
    // and the database, not the app, is what keeps everyone else out.
    const link = screen.getByRole('link', { name: S.join.teacherSignIn });
    expect(link).toHaveAttribute('href', '/teacher');
  });
});
