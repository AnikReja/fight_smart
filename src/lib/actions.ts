export const PUNCH_ACTIONS = ['Jab', 'Cross', 'Hook', 'Uppercut'] as const;
export const DEFENSE_ACTIONS = ['Slip', 'Roll', 'Block', 'Catch', 'Parry', 'Pull back', 'Step back'] as const;

export const ACTION_GROUPS: Record<string, string[]> = {
  Punches: [...PUNCH_ACTIONS, 'Feint'],
  Defense: [...DEFENSE_ACTIONS],
  Other: ['Mistake', 'Other'],
};

/** Labels that can form a combination. Feints are deliberately excluded (unchanged from the original app). */
export const PUNCHES: ReadonlySet<string> = new Set(PUNCH_ACTIONS);

export const ACTION_SHORTCUTS: Record<string, string> = {
  j: 'Jab',
  c: 'Cross',
  h: 'Hook',
  u: 'Uppercut',
  f: 'Feint',
  s: 'Slip',
  r: 'Roll',
  b: 'Block',
  k: 'Catch',
  p: 'Parry',
  m: 'Mistake',
};
