import { DEFENSE_ACTIONS, PUNCH_ACTIONS } from './actions';
import { resolveReview } from './combinations';
import type { Combination, Fighter, Reviews, Tag } from './types';

export type Count = { name: string; count: number };

export type FighterStats = {
  punchCounts: Count[];
  defenseCounts: Count[];
  totalPunches: number;
  totalDefense: number;
  feintCount: number;
  confirmedCombos: number;
  rejectedCombos: number;
  /** Combinations with no decision, or whose decision is out of date because their tags changed. */
  pendingCombos: number;
  /** Confirmed combinations grouped by punch sequence, most frequent first. */
  comboFrequencies: [string, number][];
};

export function countActions(events: Tag[], actions: readonly string[]): Count[] {
  return actions.map(name => ({ name, count: events.filter(t => t.label === name).length }));
}

export function computeFighterStats(tags: Tag[], combos: Combination[], reviews: Reviews, fighter: Fighter): FighterStats {
  const fighterTags = tags.filter(t => t.fighter === fighter);
  const punchCounts = countActions(fighterTags, PUNCH_ACTIONS);
  const defenseCounts = countActions(fighterTags, DEFENSE_ACTIONS);

  let confirmedCombos = 0;
  let rejectedCombos = 0;
  let pendingCombos = 0;
  const frequencies: Record<string, number> = {};

  for (const combo of combos) {
    if (combo.fighter !== fighter) continue;
    const { state } = resolveReview(combo, reviews);
    if (state === 'confirmed') {
      confirmedCombos++;
      const name = combo.punches.join(' → ');
      frequencies[name] = (frequencies[name] || 0) + 1;
    } else if (state === 'rejected') rejectedCombos++;
    else pendingCombos++;
  }

  return {
    punchCounts,
    defenseCounts,
    totalPunches: punchCounts.reduce((sum, c) => sum + c.count, 0),
    totalDefense: defenseCounts.reduce((sum, c) => sum + c.count, 0),
    feintCount: fighterTags.filter(t => t.label === 'Feint').length,
    confirmedCombos,
    rejectedCombos,
    pendingCombos,
    comboFrequencies: Object.entries(frequencies).sort((a, b) => b[1] - a[1]),
  };
}
