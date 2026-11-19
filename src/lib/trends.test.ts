import { describe, expect, it } from 'vitest';
import type { VideoData } from './dataFile';
import {
  METRICS, ZERO, addCounts, chronological, footageSeconds, formatDelta, latestChange, metricValue, sumCounts, videoCounts,
} from './trends';
import type { Counts } from './trends';
import type { Fighter, Outcome, Tag } from './types';

let n = 0;
const tag = (time: number, label: string, fighter: Fighter = 'you', outcome?: Outcome): Tag =>
  ({ id: `t${n++}`, time, label, note: '', fighter, ...(outcome ? { outcome } : {}) });
const data = (tags: Tag[], rounds: VideoData['rounds'] = []): VideoData => ({ tags, reviews: {}, rounds });
const metric = (id: string) => METRICS.find(m => m.id === id)!;

describe('footageSeconds', () => {
  it('uses the whole video without rounds, and null without a duration', () => {
    expect(footageSeconds(data([]), 300)).toBe(300);
    expect(footageSeconds(data([]), null)).toBeNull();
  });

  it('counts only round time when rounds are marked; an open last round runs to the end', () => {
    const rounds = [{ id: 'a', start: 10, end: 190 }, { id: 'b', start: 250 }];
    expect(footageSeconds(data([], rounds), 400)).toBe(180 + 150);
    expect(footageSeconds(data([], rounds), null)).toBeNull();
    expect(footageSeconds(data([], [{ id: 'a', start: 0, end: 120 }]), null)).toBe(120);
  });
});

describe('videoCounts', () => {
  it('counts punches, outcomes, combos, defense and reactions for one fighter', () => {
    const tags = [
      tag(1, 'Jab', 'you', 'landed'), tag(1.5, 'Cross', 'you', 'missed'), // combo of 2
      tag(10, 'Hook', 'you'), // single, no outcome
      tag(20, 'Jab', 'opponent'), tag(20.4, 'Slip'), // defended
      tag(30, 'Cross', 'opponent'), // not defended
      tag(40, 'Jab', 'opponent'), tag(41.5, 'Block'), // too late to count as a reaction
      tag(50, 'Feint'), tag(51, 'Mistake'),
    ];
    expect(videoCounts(data(tags), 120, 'you')).toEqual({
      punches: 3, landed: 1, outcomeKnown: 2, punchesInCombos: 2, defense: 2, feints: 1,
      incoming: 3, incomingDefended: 1, seconds: 120,
    });
  });
});

describe('pooling', () => {
  it('adds counts; unknown footage makes the total unknown', () => {
    const a: Counts = { ...ZERO, punches: 2, seconds: 60 };
    const b: Counts = { ...ZERO, punches: 3, seconds: null };
    expect(addCounts(a, a)).toMatchObject({ punches: 4, seconds: 120 });
    expect(sumCounts([a, b]).seconds).toBeNull();
  });

  it('pools raw counts instead of averaging percentages', () => {
    const lucky: Counts = { ...ZERO, landed: 1, outcomeKnown: 1 }; // 100%
    const normal: Counts = { ...ZERO, landed: 10, outcomeKnown: 40 }; // 25%
    expect(metricValue(metric('accuracy'), sumCounts([lucky, normal]))!.value).toBeCloseTo(11 / 41);
  });
});

describe('metricValue', () => {
  it('is null with no denominator and flags small samples', () => {
    expect(metricValue(metric('accuracy'), ZERO)).toBeNull();
    expect(metricValue(metric('punchRate'), { ...ZERO, punches: 5, seconds: null })).toBeNull();
    expect(metricValue(metric('accuracy'), { ...ZERO, landed: 2, outcomeKnown: 4 })).toEqual({ value: 0.5, num: 2, den: 4, reliable: false });
    expect(metricValue(metric('defenseRate'), { ...ZERO, incoming: 10 })).toBeNull(); // defense never tagged
    expect(metricValue(metric('defenseRate'), { ...ZERO, incoming: 10, defense: 1 })!.value).toBe(0);
    expect(metricValue(metric('punchRate'), { ...ZERO, punches: 30, seconds: 120 })).toEqual({ value: 15, num: 30, den: 2, reliable: true });
  });
});

describe('latestChange', () => {
  const s = (landed: number, known: number): Counts => ({ ...ZERO, landed, outcomeKnown: known });

  it('compares the last session with all earlier ones pooled', () => {
    const c = latestChange(metric('accuracy'), [s(2, 10), s(4, 10), s(6, 10)]);
    expect(c.latest!.value).toBeCloseTo(0.6);
    expect(c.baseline!.value).toBeCloseTo(0.3);
    expect(c.delta).toBeCloseTo(0.3);
    expect(c.reliable).toBe(true);
  });

  it('has no change with one session, and is unreliable when either side is a small sample', () => {
    expect(latestChange(metric('accuracy'), [s(2, 10)]).delta).toBeNull();
    expect(latestChange(metric('accuracy'), [s(2, 10), s(1, 2)]).reliable).toBe(false);
    expect(latestChange(metric('accuracy'), []).latest).toBeNull();
  });
});

describe('chronological and formatting', () => {
  it('orders dated sessions by date, undated ones last by creation', () => {
    const rows = [
      { id: 1, date: null, created_at: '2026-01-01' },
      { id: 2, date: '2026-03-01', created_at: '2026-01-05' },
      { id: 3, date: '2026-02-01', created_at: '2026-01-09' },
      { id: 4, date: null, created_at: '2025-12-01' },
    ];
    expect(chronological(rows).map(r => r.id)).toEqual([3, 2, 4, 1]);
  });

  it('formats percent deltas as points', () => {
    expect(formatDelta(metric('accuracy'), 0.123)).toBe('+12 pts');
    expect(formatDelta(metric('punchRate'), -1.26)).toBe('−1.3');
  });
});
