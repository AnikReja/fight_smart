import type { Round } from './types';

export type NumberedRound = Round & { number: number; effectiveEnd: number };

/** Rounds sorted by start and numbered 1..n. An open round ends where the next one starts (or never). */
export function numberRounds(rounds: Round[]): NumberedRound[] {
  const sorted = [...rounds].sort((a, b) => a.start - b.start);
  return sorted.map((round, i) => {
    const nextStart = sorted[i + 1]?.start ?? Infinity;
    const effectiveEnd = round.end !== undefined ? Math.min(round.end, nextStart) : nextStart;
    return { ...round, number: i + 1, effectiveEnd };
  });
}

/** Round number containing `time` (start inclusive, end exclusive), or null if it falls between rounds. */
export function roundAt(rounds: Round[], time: number): number | null {
  const hit = numberRounds(rounds).find(r => time >= r.start && time < r.effectiveEnd);
  return hit ? hit.number : null;
}

/** Keeps items whose time falls inside round `number`. `number = null` keeps everything. */
export function inRound<T>(items: T[], rounds: Round[], number: number | null, timeOf: (item: T) => number): T[] {
  if (number === null) return items;
  const round = numberRounds(rounds).find(r => r.number === number);
  if (!round) return [];
  return items.filter(item => {
    const t = timeOf(item);
    return t >= round.start && t < round.effectiveEnd;
  });
}

/** Minimum spacing between round starts, so a double key press doesn't create two rounds. */
const MIN_ROUND_SPACING = 1;

/**
 * Starts a round at `time`. If the previous round is still open (or ends after `time`), it is closed at `time`.
 * Returns the input unchanged if another round starts within 1 second.
 */
export function startRound(rounds: Round[], time: number, id: string): Round[] {
  if (rounds.some(r => Math.abs(r.start - time) < MIN_ROUND_SPACING)) return rounds;
  const previous = numberRounds(rounds).filter(r => r.start < time).pop();
  const next = rounds.map(r =>
    previous && r.id === previous.id && (r.end === undefined || r.end > time) ? { ...r, end: time } : r,
  );
  return [...next, { id, start: time }].sort((a, b) => a.start - b.start);
}

/** Ends whichever round contains `time`. Returns the input unchanged if `time` is outside every round. */
export function endRound(rounds: Round[], time: number): Round[] {
  const current = numberRounds(rounds).find(r => time > r.start && time < r.effectiveEnd);
  if (!current) return rounds;
  return rounds.map(r => (r.id === current.id ? { ...r, end: time } : r));
}
