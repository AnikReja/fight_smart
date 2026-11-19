import { describe, expect, it } from 'vitest';
import { endRound, inRound, numberRounds, roundAt, startRound } from './rounds';
import type { Round } from './types';

describe('numberRounds', () => {
  it('numbers by start time and closes open rounds at the next start', () => {
    const rounds: Round[] = [{ id: 'b', start: 240 }, { id: 'a', start: 0, end: 180 }];
    expect(numberRounds(rounds)).toEqual([
      { id: 'a', start: 0, end: 180, number: 1, effectiveEnd: 180 },
      { id: 'b', start: 240, number: 2, effectiveEnd: Infinity },
    ]);
  });
});

describe('roundAt / inRound', () => {
  const rounds: Round[] = [{ id: 'a', start: 10, end: 190 }, { id: 'b', start: 250 }];

  it('finds the round for a time, with start inclusive and end exclusive', () => {
    expect(roundAt(rounds, 10)).toBe(1);
    expect(roundAt(rounds, 189.9)).toBe(1);
    expect(roundAt(rounds, 190)).toBeNull(); // rest period
    expect(roundAt(rounds, 5)).toBeNull(); // before the first round
    expect(roundAt(rounds, 999)).toBe(2);
  });

  it('filters items to one round, or returns all for null', () => {
    const times = [5, 20, 200, 300];
    expect(inRound(times, rounds, 1, t => t)).toEqual([20]);
    expect(inRound(times, rounds, 2, t => t)).toEqual([300]);
    expect(inRound(times, rounds, null, t => t)).toEqual(times);
    expect(inRound(times, rounds, 7, t => t)).toEqual([]);
  });
});

describe('startRound / endRound', () => {
  it('closes the previous open round when a new one starts', () => {
    const r = startRound(startRound([], 0, 'a'), 180, 'b');
    expect(r).toEqual([{ id: 'a', start: 0, end: 180 }, { id: 'b', start: 180 }]);
  });

  it('keeps an earlier explicit end (the rest period stays outside both rounds)', () => {
    const r = startRound([{ id: 'a', start: 0, end: 170 }], 230, 'b');
    expect(r[0]).toEqual({ id: 'a', start: 0, end: 170 });
  });

  it('ignores a second start within 1 second (double key press)', () => {
    const once = startRound([], 50, 'a');
    expect(startRound(once, 50.4, 'b')).toBe(once);
  });

  it('ends the round containing the time, and ignores times outside rounds', () => {
    const rounds: Round[] = [{ id: 'a', start: 0 }];
    expect(endRound(rounds, 180)).toEqual([{ id: 'a', start: 0, end: 180 }]);
    const closed: Round[] = [{ id: 'a', start: 0, end: 180 }];
    expect(endRound(closed, 200)).toBe(closed);
  });
});
