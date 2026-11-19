import { DEFENSE_ACTIONS, PUNCHES } from './actions';
import { detectCombinations } from './combinations';
import type { VideoData } from './dataFile';
import { MIN_RELIABLE } from './patterns';
import { numberRounds } from './rounds';
import type { Fighter, Tag } from './types';

/**
 * Cross-session trends: the same handful of measures computed for every session, so you can see whether
 * something is changing over time. Still plain counting over your own tags.
 *
 * Key design choice: every measure is a ratio (numerator / denominator), and comparisons *pool* the raw counts
 * instead of averaging percentages. Averaging 1/1 = 100% and 10/40 = 25% gives 62%; pooling gives 11/41 = 27%,
 * which is what actually happened. Small denominators are flagged rather than hidden.
 */

const DEFENSE: ReadonlySet<string> = new Set(DEFENSE_ACTIONS);
/** A defensive action this soon after the other fighter's punch counts as a reaction to it (same as patterns.ts). */
const REACTION_WINDOW = 1.0;

/** Raw counts for one fighter in one video (or summed over several). Counts can be added; percentages cannot. */
export type Counts = {
  punches: number;
  landed: number;
  /** Punches with any outcome recorded (accuracy is only defined over these). */
  outcomeKnown: number;
  punchesInCombos: number;
  defense: number;
  feints: number;
  /** The other fighter's punches, and how many of them this fighter reacted to with a defensive action. */
  incoming: number;
  incomingDefended: number;
  /** Seconds of footage these counts cover, or null if unknown for any video. */
  seconds: number | null;
};

export const ZERO: Counts = {
  punches: 0, landed: 0, outcomeKnown: 0, punchesInCombos: 0, defense: 0, feints: 0,
  incoming: 0, incomingDefended: 0, seconds: 0,
};

const other = (f: Fighter): Fighter => (f === 'you' ? 'opponent' : 'you');

/**
 * How much footage was actually fought. If rounds are marked, only round time counts (rest breaks and
 * warm-ups don't dilute the per-minute rates); an open last round runs to the end of the video.
 * Without rounds, the whole video counts. Null when that needs a duration we don't have.
 */
export function footageSeconds(data: VideoData, duration: number | null): number | null {
  if (data.rounds.length === 0) return duration && duration > 0 ? duration : null;
  let total = 0;
  for (const r of numberRounds(data.rounds)) {
    const end = Math.min(r.effectiveEnd, duration ?? Infinity);
    if (!Number.isFinite(end)) return null; // open round and unknown duration
    total += Math.max(0, end - r.start);
  }
  return total;
}

export function videoCounts(data: VideoData, duration: number | null, fighter: Fighter): Counts {
  const mine = (t: Tag) => t.fighter === fighter;
  const punches = data.tags.filter(t => mine(t) && PUNCHES.has(t.label));
  const theirPunches = data.tags.filter(t => t.fighter === other(fighter) && PUNCHES.has(t.label));
  const myDefense = data.tags.filter(t => mine(t) && DEFENSE.has(t.label));

  const combos = detectCombinations(data.tags).filter(c => c.fighter === fighter);

  return {
    punches: punches.length,
    landed: punches.filter(t => t.outcome === 'landed').length,
    outcomeKnown: punches.filter(t => t.outcome !== undefined).length,
    punchesInCombos: combos.reduce((sum, c) => sum + c.tagIds.length, 0),
    defense: myDefense.length,
    feints: data.tags.filter(t => mine(t) && t.label === 'Feint').length,
    incoming: theirPunches.length,
    incomingDefended: theirPunches.filter(p => myDefense.some(d => d.time >= p.time && d.time - p.time <= REACTION_WINDOW)).length,
    seconds: footageSeconds(data, duration),
  };
}

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    punches: a.punches + b.punches,
    landed: a.landed + b.landed,
    outcomeKnown: a.outcomeKnown + b.outcomeKnown,
    punchesInCombos: a.punchesInCombos + b.punchesInCombos,
    defense: a.defense + b.defense,
    feints: a.feints + b.feints,
    incoming: a.incoming + b.incoming,
    incomingDefended: a.incomingDefended + b.incomingDefended,
    seconds: a.seconds === null || b.seconds === null ? null : a.seconds + b.seconds,
  };
}

export const sumCounts = (list: Counts[]): Counts => list.reduce(addCounts, ZERO);

export type MetricId = 'punchRate' | 'accuracy' | 'comboShare' | 'defenseRate' | 'feintRate';

export type Metric = {
  id: MetricId;
  label: string;
  /** What the number means, shown as a tooltip. */
  help: string;
  kind: 'percent' | 'perMinute';
  /** Numerator and denominator, or null when the denominator is unknown. */
  ratio: (c: Counts) => { num: number; den: number } | null;
  /** The denominator below which a value is flagged as a small sample. */
  minDen: number;
};

const minutes = (c: Counts) => (c.seconds === null ? null : c.seconds / 60);
const perMinute = (pick: (c: Counts) => number) => (c: Counts) => {
  const m = minutes(c);
  return m === null || m === 0 ? null : { num: pick(c), den: m };
};

export const METRICS: Metric[] = [
  {
    id: 'punchRate', label: 'Punches / min', kind: 'perMinute', minDen: 1, ratio: perMinute(c => c.punches),
    help: 'Punches tagged per minute of round time (or of the whole video if no rounds are marked).',
  },
  {
    id: 'accuracy', label: 'Accuracy', kind: 'percent', minDen: MIN_RELIABLE,
    ratio: c => ({ num: c.landed, den: c.outcomeKnown }),
    help: 'Landed ÷ punches with an outcome tagged (landed, blocked, or missed). Punches without an outcome are left out.',
  },
  {
    id: 'comboShare', label: 'In combinations', kind: 'percent', minDen: MIN_RELIABLE,
    ratio: c => ({ num: c.punchesInCombos, den: c.punches }),
    help: 'Share of punches thrown as part of a combination (2+ punches, each within 1.5 s of the last), rather than one at a time.',
  },
  {
    id: 'defenseRate', label: 'Defended', kind: 'percent', minDen: MIN_RELIABLE,
    // No defense tagged at all usually means defense wasn't being tagged, not that none happened: show "—", not 0%.
    ratio: c => (c.defense === 0 ? null : { num: c.incomingDefended, den: c.incoming }),
    help: 'Share of the other fighter\'s punches followed by a tagged defensive action (slip, block, roll…) within 1 s. Blank if no defense was tagged.',
  },
  {
    id: 'feintRate', label: 'Feints / min', kind: 'perMinute', minDen: 1, ratio: perMinute(c => c.feints),
    help: 'Feints tagged per minute of round time.',
  },
];

export type Value = { value: number; num: number; den: number; reliable: boolean } | null;

export function metricValue(metric: Metric, c: Counts): Value {
  const r = metric.ratio(c);
  if (!r || r.den === 0) return null;
  return { value: r.num / r.den, num: r.num, den: r.den, reliable: r.den >= metric.minDen };
}

export type Change = {
  latest: Value;
  /** All earlier sessions pooled together. */
  baseline: Value;
  /** latest − baseline, in the metric's units (fraction for percents). Null if either side is missing. */
  delta: number | null;
  /** True only if both sides have enough data to be worth reading. */
  reliable: boolean;
};

/** Compares the last session against all earlier ones pooled. `sessions` must be in chronological order. */
export function latestChange(metric: Metric, sessions: Counts[]): Change {
  if (sessions.length === 0) return { latest: null, baseline: null, delta: null, reliable: false };
  const latest = metricValue(metric, sessions[sessions.length - 1]);
  const baseline = sessions.length > 1 ? metricValue(metric, sumCounts(sessions.slice(0, -1))) : null;
  const delta = latest && baseline ? latest.value - baseline.value : null;
  return { latest, baseline, delta, reliable: !!latest?.reliable && !!baseline?.reliable };
}

/** Sort key for sessions: dated ones by date, undated ones after them by creation time. */
export function chronological<T extends { date: string | null; created_at: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function formatValue(metric: Metric, v: number): string {
  return metric.kind === 'percent' ? `${Math.round(v * 100)}%` : v.toFixed(1);
}

export function formatDelta(metric: Metric, d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const abs = Math.abs(d);
  return metric.kind === 'percent' ? `${sign}${Math.round(abs * 100)} pts` : `${sign}${abs.toFixed(1)}`;
}
