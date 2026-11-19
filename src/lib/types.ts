export type Fighter = 'you' | 'opponent';

/** A single manually tagged moment in a video. `fighter` is optional for tags saved by early versions. */
export type Tag = {
  id: string;
  time: number;
  label: string;
  note: string;
  fighter?: Fighter;
};

export type ReviewStatus = 'confirmed' | 'rejected';

/** Saved combination decisions, keyed by combination id (`fighter:tagId:tagId...`). */
export type Reviews = Record<string, ReviewStatus>;

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
