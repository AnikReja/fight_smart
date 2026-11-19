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
 * Decide what a video's data should be when it is opened and both the browser and the server may have some.
 *
 * - Only one side has data → use it (and upload it if it was the browser's).
 * - Both have data → merge without deleting anything; for the same tag/round id, the browser's version wins
 *   because edits happen in the browser first. Upload if the result differs from what the server has.
 *
 * Known limit: a tag deleted in the browser while the server was off comes back from the server copy.
 * That's the safe direction (nothing is lost), and it can be deleted again.
 */
export function reconcile(browser: VideoData, server: VideoData): Reconciled {
  if (isEmpty(browser) && isEmpty(server)) return { data: browser, pushToServer: false, source: 'empty' };
  if (isEmpty(server)) return { data: browser, pushToServer: true, source: 'browser' };
  if (isEmpty(browser)) return { data: server, pushToServer: false, source: 'server' };
  const { tags, reviews, rounds } = mergeData(server, browser);
  const merged = { tags, reviews, rounds };
  return { data: merged, pushToServer: !sameData(merged, server), source: sameData(merged, server) ? 'server' : 'merged' };
}
