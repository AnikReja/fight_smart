import { parseImport } from './dataFile';
import type { VideoData } from './dataFile';
import type { Deletions } from './sync';

/**
 * localStorage layout (unchanged from the original app, plus `:rounds`):
 *   {key}          → Tag[]
 *   {key}:reviews  → Reviews
 *   {key}:rounds   → Round[]
 *   {key}:deleted  → Deletions (ids deleted here that the library server may still have)
 * The `corneriq:` prefix is kept so data saved before the FightSmart rename still loads.
 */
export function videoStorageKey(file: { name: string; size: number; lastModified: number }): string {
  return `corneriq:tags:${file.name}:${file.size}:${file.lastModified}`;
}

/** Loads and validates saved data for a video. Corrupt entries load as empty instead of crashing the app. */
export function loadVideoData(key: string, storage: Pick<Storage, 'getItem'> = localStorage): VideoData {
  const read = (suffix: string) => {
    try {
      return JSON.parse(storage.getItem(key + suffix) || 'null');
    } catch {
      return null;
    }
  };
  // Run saved data through the same validation as imports.
  const parsed = parseImport(JSON.stringify({
    schemaVersion: 2,
    tags: Array.isArray(read('')) ? read('') : [],
    reviews: read(':reviews') ?? {},
    rounds: read(':rounds') ?? [],
  }));
  return { tags: parsed.tags, reviews: parsed.reviews, rounds: parsed.rounds };
}

export type SaveField = 'tags' | 'reviews' | 'rounds' | 'deleted';
const SUFFIX: Record<SaveField, string> = { tags: '', reviews: ':reviews', rounds: ':rounds', deleted: ':deleted' };

/** Returns false if the browser refused to save (storage full or disabled). */
export function saveField(key: string, field: SaveField, value: unknown, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(key + SUFFIX[field], JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Loads the deletion record for a video; anything malformed loads as "no deletions". */
export function loadDeletions(key: string, storage: Pick<Storage, 'getItem'> = localStorage): Deletions {
  let raw: unknown = null;
  try { raw = JSON.parse(storage.getItem(key + SUFFIX.deleted) || 'null'); } catch { /* corrupt */ }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { tags: list(r.tags), rounds: list(r.rounds), reviews: list(r.reviews) };
}
