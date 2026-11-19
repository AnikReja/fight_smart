import { PUNCHES } from './actions';
import type { Combination, Fighter, ResolvedReview, ReviewStatus, Reviews, Tag } from './types';

/** Max seconds between consecutive punches by the same fighter for them to count as one combination. */
export const MAX_COMBO_GAP = 1.5;

/** The id format is `fighter:tagId:tagId...`; this format is what existing saved decisions use, so it must not change. */
export function comboId(fighter: Fighter, tagIds: string[]): string {
  return `${fighter}:${tagIds.join(':')}`;
}

export function parseComboId(id: string): { fighter: string; tagIds: string[] } {
  const [fighter, ...tagIds] = id.split(':');
  return { fighter, tagIds };
}

/**
 * Groups each fighter's punches into runs where every gap is <= maxGap seconds.
 * Runs of 2+ punches are suggested as combinations. O(n log n) for the sort, O(n) for the scan.
 */
export function detectCombinations(tags: Tag[], maxGap = MAX_COMBO_GAP): Combination[] {
  const results: Combination[] = [];

  for (const fighter of ['you', 'opponent'] as const) {
    const events = tags
      .filter(t => t.fighter === fighter && PUNCHES.has(t.label))
      .sort((a, b) => a.time - b.time);

    let sequence: Tag[] = [];
    const finish = () => {
      if (sequence.length < 2) return;
      const tagIds = sequence.map(t => t.id);
      results.push({
        id: comboId(fighter, tagIds),
        fighter,
        tagIds,
        punches: sequence.map(t => t.label),
        start: sequence[0].time,
        end: sequence[sequence.length - 1].time,
      });
    };

    for (const event of events) {
      const previous = sequence[sequence.length - 1];
      if (previous && event.time - previous.time > maxGap) {
        finish();
        sequence = [];
      }
      sequence.push(event);
    }
    finish();
  }

  return results.sort((a, b) => a.start - b.start);
}

/**
 * Matches a detected combination to saved decisions.
 * An exact id match keeps its decision. Otherwise, a decision whose tags overlap this combination
 * means the punches changed after review, so the combination is flagged instead of silently losing it.
 */
export function resolveReview(combo: Combination, reviews: Reviews): ResolvedReview {
  const exact = reviews[combo.id];
  if (exact) return { state: exact };

  const tagIds = new Set(combo.tagIds);
  const staleIds = Object.keys(reviews).filter(id => {
    const parsed = parseComboId(id);
    return parsed.fighter === combo.fighter && parsed.tagIds.some(tagId => tagIds.has(tagId));
  });
  if (staleIds.length === 0) return { state: 'pending' };

  const statuses = new Set(staleIds.map(id => reviews[id]));
  const previous = statuses.size === 1 ? [...statuses][0] : 'mixed';
  return { state: 'changed', previous, staleIds };
}

/**
 * Returns the reviews after deciding on `combo`. Any older decisions overlapping its tags are removed,
 * because the new decision replaces them. `decision = null` clears the decision (and stale ones).
 */
export function applyReview(reviews: Reviews, combo: Combination, decision: ReviewStatus | null): Reviews {
  const next = { ...reviews };
  const resolved = resolveReview(combo, reviews);
  if (resolved.state === 'changed') for (const id of resolved.staleIds) delete next[id];
  if (decision === null) delete next[combo.id];
  else next[combo.id] = decision;
  return next;
}
