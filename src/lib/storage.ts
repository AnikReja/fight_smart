import { parseImport } from './dataFile';
import type { VideoData } from './dataFile';

/**
 * localStorage layout (unchanged from the original app, plus `:rounds`):
 *   {key}          → Tag[]
 *   {key}:reviews  → Reviews
 *   {key}:rounds   → Round[]
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

export type SaveField = 'tags' | 'reviews' | 'rounds';
const SUFFIX: Record<SaveField, string> = { tags: '', reviews: ':reviews', rounds: ':rounds' };

/** Returns false if the browser refused to save (storage full or disabled). */
export function saveField(key: string, field: SaveField, value: unknown, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(key + SUFFIX[field], JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
