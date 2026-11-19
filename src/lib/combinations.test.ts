import { describe, expect, it } from 'vitest';
import { applyReview, comboId, detectCombinations, parseComboId, resolveReview } from './combinations';
import type { Fighter, Tag } from './types';

const tag = (id: string, time: number, label: string, fighter: Fighter | undefined = 'you'): Tag =>
  ({ id, time, label, note: '', fighter });

describe('detectCombinations', () => {
  it('groups punches within the 1.5s gap into one combination', () => {
    const combos = detectCombinations([tag('a', 10, 'Jab'), tag('b', 10.8, 'Cross'), tag('c', 12.2, 'Hook')]);
    expect(combos).toHaveLength(1);
    expect(combos[0]).toMatchObject({ id: 'you:a:b:c', punches: ['Jab', 'Cross', 'Hook'], start: 10, end: 12.2 });
  });

  it('splits when the gap is larger than 1.5s, and treats exactly 1.5s as connected', () => {
    const combos = detectCombinations([
      tag('a', 0, 'Jab'), tag('b', 1.5, 'Cross'),
      tag('c', 5, 'Jab'), tag('d', 6, 'Hook'),
    ]);
    expect(combos.map(c => c.id)).toEqual(['you:a:b', 'you:c:d']);
  });

  it('ignores single punches, feints, defense, and tags without a fighter', () => {
    const combos = detectCombinations([
      tag('a', 0, 'Jab'), tag('b', 0.5, 'Feint'), tag('c', 1, 'Slip'),
      { id: 'd', time: 1.2, label: 'Cross', note: '' }, tag('e', 9, 'Hook'),
    ]);
    expect(combos).toEqual([]);
  });

  it('keeps fighters separate even when their punches interleave', () => {
    const combos = detectCombinations([
      tag('a', 0, 'Jab', 'you'), tag('x', 0.3, 'Jab', 'opponent'),
      tag('b', 0.6, 'Cross', 'you'), tag('y', 0.9, 'Hook', 'opponent'),
    ]);
    expect(combos.map(c => c.id)).toEqual(['you:a:b', 'opponent:x:y']);
  });

  it('sorts unsorted input by time', () => {
    const combos = detectCombinations([tag('b', 1, 'Cross'), tag('a', 0, 'Jab')]);
    expect(combos[0].punches).toEqual(['Jab', 'Cross']);
  });
});

describe('combo ids', () => {
  it('round-trips the legacy id format used by saved reviews', () => {
    const id = comboId('opponent', ['1f0c-aa', '2b9d-bb']);
    expect(id).toBe('opponent:1f0c-aa:2b9d-bb');
    expect(parseComboId(id)).toEqual({ fighter: 'opponent', tagIds: ['1f0c-aa', '2b9d-bb'] });
  });
});

describe('resolveReview', () => {
  const jabCross = [tag('a', 10, 'Jab'), tag('b', 10.8, 'Cross')];

  it('keeps an exact decision', () => {
    const [combo] = detectCombinations(jabCross);
    expect(resolveReview(combo, { 'you:a:b': 'confirmed' })).toEqual({ state: 'confirmed' });
  });

  it('flags a confirmed combo as changed when a punch is added (the old bug lost it silently)', () => {
    const [combo] = detectCombinations([...jabCross, tag('c', 11.5, 'Hook')]);
    expect(resolveReview(combo, { 'you:a:b': 'confirmed' }))
      .toEqual({ state: 'changed', previous: 'confirmed', staleIds: ['you:a:b'] });
  });

  it('flags a combo as changed when one of its punches is deleted', () => {
    const [combo] = detectCombinations([tag('a', 10, 'Jab'), tag('c', 11, 'Hook')]);
    expect(resolveReview(combo, { 'you:a:b:c': 'rejected' }))
      .toMatchObject({ state: 'changed', previous: 'rejected' });
  });

  it('reports mixed when overlapping decisions disagree', () => {
    const [combo] = detectCombinations([tag('a', 0, 'Jab'), tag('b', 1, 'Cross'), tag('c', 2, 'Hook'), tag('d', 3, 'Jab')]);
    const resolved = resolveReview(combo, { 'you:a:b': 'confirmed', 'you:c:d': 'rejected' });
    expect(resolved).toMatchObject({ state: 'changed', previous: 'mixed' });
  });

  it('ignores decisions from the other fighter and unrelated tags', () => {
    const [combo] = detectCombinations(jabCross);
    expect(resolveReview(combo, { 'opponent:x:y': 'confirmed', 'you:q:r': 'rejected' })).toEqual({ state: 'pending' });
  });
});

describe('applyReview', () => {
  it('replaces stale overlapping decisions with the new one and keeps unrelated ones', () => {
    const [combo] = detectCombinations([tag('a', 10, 'Jab'), tag('b', 10.8, 'Cross'), tag('c', 11.5, 'Hook')]);
    const next = applyReview({ 'you:a:b': 'confirmed', 'opponent:x:y': 'rejected' }, combo, 'confirmed');
    expect(next).toEqual({ 'you:a:b:c': 'confirmed', 'opponent:x:y': 'rejected' });
  });

  it('clears a decision on undo without mutating the input', () => {
    const [combo] = detectCombinations([tag('a', 0, 'Jab'), tag('b', 1, 'Cross')]);
    const before = { 'you:a:b': 'confirmed' as const };
    expect(applyReview(before, combo, null)).toEqual({});
    expect(before).toEqual({ 'you:a:b': 'confirmed' });
  });
});
