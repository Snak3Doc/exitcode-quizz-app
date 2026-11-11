/**
 * Who the top bar says is signed in.
 *
 * A teacher is often projecting this in front of a class, so their address
 * should not be on the wall behind them. These pin down that it never is,
 * whichever way they signed in.
 */

import { describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { maskEmail, signedInAs } from './auth';

function sessionWith(user: Record<string, unknown>): Session {
  return { user } as unknown as Session;
}

describe('masking an address', () => {
  it('keeps enough to tell two accounts apart and no more', () => {
    expect(maskEmail('benjaminbadham@gmail.com')).toBe('be•••@gmail.com');
    expect(maskEmail('a.teacher@school.edu.au')).toBe('a.•••@school.edu.au');
  });

  it('does not give away a short name by keeping most of it', () => {
    expect(maskEmail('jo@school.edu')).toBe('j•••@school.edu');
    expect(maskEmail('b@school.edu')).toBe('b•••@school.edu');
  });

  it('gives nothing away when there is no address to read', () => {
    expect(maskEmail('not-an-address')).toBe('•••');
    expect(maskEmail('@nolocal.com')).toBe('•••');
  });
});

describe('what to call the person signed in', () => {
  it('uses the name Google gives', () => {
    const session = sessionWith({
      email: 'benjaminbadham@gmail.com',
      user_metadata: { full_name: 'Ben Badham', name: 'Ben B' },
    });
    expect(signedInAs(session)).toBe('Ben Badham');
  });

  it('falls back to the other name Google may send', () => {
    const session = sessionWith({
      email: 'benjaminbadham@gmail.com',
      user_metadata: { name: 'Ben B' },
    });
    expect(signedInAs(session)).toBe('Ben B');
  });

  it('masks the address when signing in with a password, which carries no name', () => {
    const session = sessionWith({ email: 'benjaminbadham@gmail.com', user_metadata: {} });
    expect(signedInAs(session)).toBe('be•••@gmail.com');
  });

  it('ignores a name that is there but empty', () => {
    const session = sessionWith({
      email: 'benjaminbadham@gmail.com',
      user_metadata: { full_name: '   ' },
    });
    expect(signedInAs(session)).toBe('be•••@gmail.com');
  });

  it('says nobody when nobody is signed in', () => {
    expect(signedInAs(null)).toBeNull();
  });
});
