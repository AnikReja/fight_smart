import type { Outcome } from './types';

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
  l: 'Pull back',
  t: 'Step back',
  m: 'Mistake',
  o: 'Other',
};

/** Keys that set the outcome of the most recently added punch: Q landed, W blocked, E missed. */
export const OUTCOME_SHORTCUTS: Record<string, Outcome> = {
  q: 'landed',
  w: 'blocked',
  e: 'missed',
};

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** Assumed frame length for frame stepping. Browsers don't expose the real frame rate; 30 fps is typical for phone video. */
export const FRAME_SECONDS = 1 / 30;
