import { describe, expect, it } from 'vitest';
import { followUps, insights, responses, sequences, topActions } from './patterns';
import type { Fighter, Tag } from './types';

let n = 0;
const tag = (time: number, label: string, fighter: Fighter = 'opponent'): Tag => ({ id: `t${n++}`, time, label, note: '', fighter });

describe('sequences', () => {
  it('counts consecutive actions inside chains, splitting on gaps over 1.5s', () => {
    const tags = [
      tag(0, 'Jab'), tag(0.5, 'Cross'), tag(1.0, 'Hook'), // one chain
      tag(5, 'Jab'), tag(5.6, 'Cross'), // another chain
      tag(9, 'Jab'), // alone
      tag(20, 'Slip'), tag(20.4, 'Cross'),
    ];
    const pairs = sequences(tags, 'opponent', 2);
    expect(pairs[0]).toEqual({ actions: ['Jab', 'Cross'], count: 2, evidence: [0, 5] });
    expect(pairs.map(p => p.actions.join('→'))).toEqual(['Jab→Cross', 'Cross→Hook', 'Slip→Cross']);
    expect(sequences(tags, 'opponent', 3)).toEqual([{ actions: ['Jab', 'Cross', 'Hook'], count: 1, evidence: [0] }]);
  });

  it('only uses the chosen fighter and ignores Mistake/Other notes', () => {
    const tags = [tag(0, 'Jab'), tag(0.3, 'Mistake'), tag(0.5, 'Cross', 'you'), tag(0.8, 'Hook')];
    expect(sequences(tags, 'opponent', 2)).toEqual([{ actions: ['Jab', 'Hook'], count: 1, evidence: [0] }]);
  });
});

describe('followUps', () => {
  it('reports what came next, including "nothing", with shares and evidence', () => {
    const tags = [
      tag(0, 'Jab'), tag(0.6, 'Cross'),
      tag(4, 'Jab'), tag(4.5, 'Cross'),
      tag(8, 'Jab'), tag(8.4, 'Hook'),
      tag(12, 'Jab'), // nothing after
      tag(16, 'Jab'), tag(18, 'Cross'), // too late to count as a follow-up
    ];
    const d = followUps(tags, 'opponent', 'Jab');
    expect(d.total).toBe(5);
    expect(d.outcomes.map(o => [o.action, o.count])).toEqual([['Cross', 2], [null, 2], ['Hook', 1]]);
    expect(d.outcomes[0].share).toBeCloseTo(0.4);
    expect(d.outcomes[0].evidence).toEqual([0, 4]);
  });

  it('returns an empty distribution for an action never tagged', () => {
    expect(followUps([tag(0, 'Jab')], 'opponent', 'Uppercut')).toEqual({ trigger: 'Uppercut', total: 0, outcomes: [] });
  });
});

describe('responses', () => {
  it("finds the other fighter's first action within 1s, counting same-instant tags but not earlier ones", () => {
    const tags = [
      tag(0, 'Jab'), tag(0.4, 'Slip', 'you'), tag(0.7, 'Cross', 'you'),
      tag(5, 'Jab'), tag(5, 'Block', 'you'),
      tag(10, 'Jab'), tag(9.8, 'Jab', 'you'), // earlier: not a response
      tag(15, 'Jab'), tag(16.5, 'Slip', 'you'), // too late
    ];
    const d = responses(tags, 'opponent', 'Jab');
    expect(d.total).toBe(4);
    expect(d.outcomes.map(o => [o.action, o.count])).toEqual([[null, 2], ['Block', 1], ['Slip', 1]]);
  });
});

describe('topActions and insights', () => {
  const tags: Tag[] = [];
  for (let k = 0; k < 6; k++) {
    const t0 = k * 10;
    tags.push(tag(t0, 'Jab'), tag(t0 + 0.5, k < 5 ? 'Cross' : 'Hook'), tag(t0 + 0.3, 'Slip', 'you'));
  }
  tags.push(tag(70, 'Hook'));

  it('ranks actions by frequency', () => {
    expect(topActions(tags, 'opponent')).toEqual([{ action: 'Jab', count: 6 }, { action: 'Cross', count: 5 }, { action: 'Hook', count: 2 }]);
  });

  it('turns strong, repeated patterns into evidence-backed statements', () => {
    const found = insights(tags, 'opponent');
    const texts = found.map(i => i.text);
    expect(texts).toContain('After a jab, they follow with a cross 5 of 6 times (83%)');
    expect(texts).toContain('When they jab, you answer with a slip 6 of 6 times (100%)');
    const slip = found.find(i => i.text.startsWith('When they jab'))!;
    expect(slip.evidence).toEqual([0, 10, 20, 30, 40, 50]);
    expect(slip.reliable).toBe(true);
  });

  it('does not report patterns seen fewer than 3 times', () => {
    const few = [tag(0, 'Jab'), tag(0.5, 'Cross'), tag(5, 'Jab'), tag(5.5, 'Cross')];
    expect(insights(few, 'opponent')).toEqual([]);
  });
});
