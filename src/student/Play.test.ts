import { describe, expect, it } from 'vitest';
import { openAction } from './Play';

const CODE = 'ABC234';
const marker = { code: CODE, playerId: 'p1' };

describe('openAction', () => {
  it('joins when the tab arrives from the join screen for the first time', () => {
    expect(openAction(null, { name: 'Ana' }, CODE)).toBe('join');
  });

  it('sends a bare visit with no join details back to the join screen', () => {
    expect(openAction(null, null, CODE)).toBe('home');
  });

  it('treats a refresh as having left, even though the join details survive it', () => {
    // The browser restores history.state on a reload, so React Router hands the
    // page the same location.state it had before. Only the marker distinguishes
    // a refresh from a fresh join; without it the tab tries to rejoin and the
    // host turns it away with "already started" or "name taken".
    expect(openAction(marker, { name: 'Ana' }, CODE)).toBe('left');
  });

  it('treats a refresh as having left when the join details are gone too', () => {
    expect(openAction(marker, null, CODE)).toBe('left');
  });

  it('ignores a marker left over from a different game', () => {
    expect(openAction({ code: 'ZZZ999', playerId: 'p0' }, { name: 'Ana' }, CODE)).toBe('join');
  });
});
