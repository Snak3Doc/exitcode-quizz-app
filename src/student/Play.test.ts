import { describe, expect, it } from 'vitest';
import { openAction } from './Play';

const CODE = 'ABC234';
const marker = { code: CODE, playerId: 'p1', name: 'Ana' };

describe('openAction', () => {
  it('joins when the tab arrives from the join screen for the first time', () => {
    expect(openAction(null, { name: 'Ana' }, CODE)).toBe('join');
  });

  it('sends a bare visit with no join details back to the join screen', () => {
    expect(openAction(null, null, CODE)).toBe('home');
  });

  it('rejoins after a refresh, keeping the same player', () => {
    // The browser restores history.state on a reload, so React Router hands
    // the page the same location.state it had before and cannot tell a
    // refresh from a fresh join. The marker can, and it carries the player id
    // the host already knows -- which is what gets their score back.
    expect(openAction(marker, { name: 'Ana' }, CODE)).toBe('rejoin');
  });

  it('rejoins even when the join details are gone', () => {
    // A closed and reopened tab: history.state is gone, the marker is not.
    expect(openAction(marker, null, CODE)).toBe('rejoin');
  });

  it('ignores a marker left over from a different game', () => {
    expect(
      openAction({ code: 'ZZZ999', playerId: 'p0', name: 'Ana' }, { name: 'Ana' }, CODE),
    ).toBe('join');
  });

  it('does not try to rejoin on a marker written before names were stored', () => {
    // Rejoining needs the name to send with the request. An older marker has
    // no name, so treat it as a fresh visitor rather than send an empty one.
    expect(
      openAction({ code: CODE, playerId: 'p1', name: '' }, { name: 'Ana' }, CODE),
    ).toBe('join');
    expect(openAction({ code: CODE, playerId: 'p1', name: '' }, null, CODE)).toBe('home');
  });
});
