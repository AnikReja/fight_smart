import { mergeData } from './dataFile';
import type { VideoData } from './dataFile';

export type Reconciled = { data: VideoData; pushToServer: boolean; source: 'empty' | 'browser' | 'server' | 'merged' };

const isEmpty = (d: VideoData) => d.tags.length === 0 && d.rounds.length === 0 && Object.keys(d.reviews).length === 0;

function sameData(a: VideoData, b: VideoData): boolean {
  const key = (d: VideoData) => JSON.stringify({
    tags: [...d.tags].sort((x, y) => x.id.localeCompare(y.id)),
    rounds: [...d.rounds].sort((x, y) => x.id.localeCompare(y.id)),
    reviews: Object.fromEntries(Object.entries(d.reviews).sort()),
  });
  return key(a) === key(b);
}

/**
 * Ids deleted in this browser that the server may still have. Without these, a merge can't tell
 * "deleted here" from "added elsewhere", so a tag deleted while the server was unreachable came back.
 * Kept until a save to the server succeeds (then the server no longer has them).
 */
export type Deletions = { tags: string[]; rounds: string[]; reviews: string[] };
export const NO_DELETIONS: Deletions = { tags: [], rounds: [], reviews: [] };

const ids = (d: VideoData) => ({
  tags: d.tags.map(t => t.id),
  rounds: d.rounds.map(r => r.id),
  reviews: Object.keys(d.reviews),
});

/**
 * Updates the deletion record after an edit: ids present before and missing after are added; ids that are
 * present again (re-imported) are removed, so an import can bring a deleted tag back on purpose.
 */
export function recordDeletions(before: VideoData, after: VideoData, existing: Deletions): Deletions {
  const b = ids(before);
  const a = ids(after);
  const update = (field: keyof Deletions) => {
    const now = new Set(a[field]);
    const out = new Set(existing[field].filter(id => !now.has(id)));
    for (const id of b[field]) if (!now.has(id)) out.add(id);
    return [...out];
  };
  return { tags: update('tags'), rounds: update('rounds'), reviews: update('reviews') };
}

/** Removes ids that were already sent to the server from the record (used after a successful save). */
export function forgetDeletions(current: Deletions, sent: Deletions): Deletions {
  const minus = (x: string[], y: string[]) => { const gone = new Set(y); return x.filter(id => !gone.has(id)); };
  return { tags: minus(current.tags, sent.tags), rounds: minus(current.rounds, sent.rounds), reviews: minus(current.reviews, sent.reviews) };
}

export const hasDeletions = (d: Deletions) => d.tags.length + d.rounds.length + d.reviews.length > 0;

/** The server's data without anything this browser deleted. */
function withoutDeleted(server: VideoData, deleted: Deletions): VideoData {
  const tags = new Set(deleted.tags);
  const rounds = new Set(deleted.rounds);
  const reviews = new Set(deleted.reviews);
  return {
    tags: server.tags.filter(t => !tags.has(t.id)),
    rounds: server.rounds.filter(r => !rounds.has(r.id)),
    reviews: Object.fromEntries(Object.entries(server.reviews).filter(([id]) => !reviews.has(id))),
  };
}

/**
 * Decide what a video's data should be when it is opened and both the browser and the server may have some.
 *
 * 1. Drop from the server's copy anything this browser deleted (see `Deletions`).
 * 2. Only one side has data → use it (and upload it if it was the browser's).
 * 3. Both have data → merge without deleting anything else; for the same tag/round id, the browser's version
 *    wins because edits happen in the browser first. Upload if the result differs from what the server has.
 */
export function reconcile(browser: VideoData, server: VideoData, deleted: Deletions = NO_DELETIONS): Reconciled {
  const remote = withoutDeleted(server, deleted);
  const removed = !sameData(remote, server); // the server still has deletions that must be sent
  if (isEmpty(browser) && isEmpty(remote)) return { data: browser, pushToServer: removed, source: removed ? 'browser' : 'empty' };
  if (isEmpty(remote)) return { data: browser, pushToServer: true, source: 'browser' };
  if (isEmpty(browser)) return { data: remote, pushToServer: removed, source: 'server' };
  const { tags, reviews, rounds } = mergeData(remote, browser);
  const merged = { tags, reviews, rounds };
  const changed = !sameData(merged, server);
  return { data: merged, pushToServer: changed, source: sameData(merged, remote) ? 'server' : 'merged' };
}
