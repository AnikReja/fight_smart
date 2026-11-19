import { describe, expect, it } from 'vitest';
import { detectCombinations } from './combinations';
import { stamp, stampPrecise } from './format';
import { computeFighterStats } from './stats';
import type { Fighter, Tag } from './types';

const tag = (id: string, time: number, label: string, fighter: Fighter = 'you'): Tag =>
  ({ id, time, label, note: '', fighter });

describe('computeFighterStats', () => {
  const tags = [
    tag('a', 0, 'Jab'), tag('b', 0.5, 'Cross'),
    tag('c', 5, 'Jab'), tag('d', 5.6, 'Cross'),
    tag('e', 10, 'Hook'), tag('f', 10.4, 'Uppercut'),
    tag('g', 20, 'Slip'), tag('h', 21, 'Feint'), tag('i', 22, 'Mistake'),
    tag('x', 3, 'Jab', 'opponent'), tag('y', 3.2, 'Block', 'opponent'),
  ];
  const combos = detectCombinations(tags);
  const reviews = { 'you:a:b': 'confirmed', 'you:c:d': 'confirmed', 'you:e:f': 'rejected' } as const;

  it('counts only the selected fighter', () => {
    const you = computeFighterStats(tags, combos, reviews, 'you');
    expect(you.totalPunches).toBe(6);
    expect(you.totalDefense).toBe(1);
    expect(you.feintCount).toBe(1);
    expect(you.punchCounts).toEqual([
      { name: 'Jab', count: 2 }, { name: 'Cross', count: 2 }, { name: 'Hook', count: 1 }, { name: 'Uppercut', count: 1 },
    ]);

    const opp = computeFighterStats(tags, combos, reviews, 'opponent');
    expect(opp.totalPunches).toBe(1);
    expect(opp.defenseCounts.find(c => c.name === 'Block')?.count).toBe(1);
  });

  it('counts reviewed combinations and ranks confirmed sequences', () => {
    const you = computeFighterStats(tags, combos, reviews, 'you');
    expect(you.confirmedCombos).toBe(2);
    expect(you.rejectedCombos).toBe(1);
    expect(you.pendingCombos).toBe(0);
    expect(you.comboFrequencies).toEqual([['Jab → Cross', 2]]);
  });

  it('counts a changed combination as pending, not confirmed', () => {
    const changedTags = [...tags, tag('z', 1.2, 'Hook')];
    const you = computeFighterStats(changedTags, detectCombinations(changedTags), reviews, 'you');
    expect(you.confirmedCombos).toBe(1);
    expect(you.pendingCombos).toBe(1);
  });
});

describe('stamp', () => {
  it('formats seconds as mm:ss', () => {
    expect(stamp(0)).toBe('00:00');
    expect(stamp(65.9)).toBe('01:05');
    expect(stamp(600)).toBe('10:00');
  });
});

describe('outcomes and precise stamps', () => {
  it('computes accuracy only over punches with a known outcome', () => {
    const tags: Tag[] = [
      { ...tag('a', 0, 'Jab'), outcome: 'landed' },
      { ...tag('b', 3, 'Cross'), outcome: 'missed' },
      { ...tag('c', 6, 'Hook'), outcome: 'landed' },
      tag('d', 9, 'Jab'),
      { ...tag('e', 12, 'Slip'), outcome: 'landed' }, // not a punch, ignored
    ];
    const { outcomes } = computeFighterStats(tags, [], {}, 'you');
    expect(outcomes).toEqual({ landed: 2, blocked: 0, missed: 1, known: 3, accuracy: 2 / 3 });
    expect(computeFighterStats([tag('a', 0, 'Jab')], [], {}, 'you').outcomes.accuracy).toBeNull();
  });

  it('formats tenths of a second', () => {
    expect(stampPrecise(0)).toBe('00:00.0');
    expect(stampPrecise(65.37)).toBe('01:05.3');
    expect(stampPrecise(0.3)).toBe('00:00.3');
  });
});
