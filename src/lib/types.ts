export type Fighter = 'you' | 'opponent';

/** Result of a punch. Optional: unknown is better than guessed. */
export type Outcome = 'landed' | 'blocked' | 'missed';
export const OUTCOMES: readonly Outcome[] = ['landed', 'blocked', 'missed'];

/** A single manually tagged moment in a video. `fighter` is optional for tags saved by early versions. */
export type Tag = {
  id: string;
  time: number;
  label: string;
  note: string;
  fighter?: Fighter;
  outcome?: Outcome;
};

export type ReviewStatus = 'confirmed' | 'rejected';

/** Saved combination decisions, keyed by combination id (`fighter:tagId:tagId...`). */
export type Reviews = Record<string, ReviewStatus>;

/** A round inside one video. Rounds are numbered by start time; an open round (no end) runs until the next round or the end of the video. */
export type Round = {
  id: string;
  start: number;
  end?: number;
};

export type Combination = {
  id: string;
  fighter: Fighter;
  tagIds: string[];
  punches: string[];
  start: number;
  end: number;
};

/**
 * How a detected combination relates to saved decisions:
 * - confirmed / rejected: a decision exists for exactly these tags
 * - changed: a decision exists for an overlapping set of tags (punches were added or removed since)
 * - pending: no decision touches these tags
 */
export type ResolvedReview =
  | { state: 'confirmed' | 'rejected' }
  | { state: 'changed'; previous: ReviewStatus | 'mixed'; staleIds: string[] }
  | { state: 'pending' };
