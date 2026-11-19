import { OUTCOMES } from './types';
import type { Fighter, Outcome, Reviews, Round, Tag } from './types';

/**
 * Export format, version 2. Version 1 was `{ videoName, tags }` (tags only).
 * Bump SCHEMA_VERSION and add a branch in `parseImport` whenever the shape changes.
 */
export const SCHEMA_VERSION = 2;

export type VideoData = { tags: Tag[]; reviews: Reviews; rounds: Round[] };

export type ExportFile = {
  app: 'fightsmart';
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  videoName: string;
} & VideoData;

export type ImportResult = VideoData & {
  videoName: string | null;
  sourceVersion: 1 | 2;
  /** Items that were skipped because they were malformed. */
  skipped: number;
};

export function buildExport(videoName: string, data: VideoData, now = new Date()): ExportFile {
  return { app: 'fightsmart', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), videoName, ...data };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseTag(raw: unknown, makeId: () => string): Tag | null {
  if (!isObject(raw) || !isTime(raw.time) || typeof raw.label !== 'string' || !raw.label.trim()) return null;
  const tag: Tag = {
    id: typeof raw.id === 'string' && raw.id && !raw.id.includes(':') ? raw.id : makeId(),
    time: raw.time,
    label: raw.label,
    note: typeof raw.note === 'string' ? raw.note : '',
  };
  if (raw.fighter === 'you' || raw.fighter === 'opponent') tag.fighter = raw.fighter as Fighter;
  if (OUTCOMES.includes(raw.outcome as Outcome)) tag.outcome = raw.outcome as Outcome;
  return tag;
}

function parseRound(raw: unknown, makeId: () => string): Round | null {
  if (!isObject(raw) || !isTime(raw.start)) return null;
  const round: Round = { id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(), start: raw.start };
  if (isTime(raw.end) && raw.end > raw.start) round.end = raw.end;
  return round;
}

/**
 * Validates and normalizes an imported file. Accepts:
 * - v2 exports (`schemaVersion: 2`)
 * - v1 exports (`{ videoName, tags }`) from the original app
 * - a bare array of tags
 * Malformed items are skipped and counted rather than failing the whole import.
 */
export function parseImport(json: string, makeId: () => string = () => crypto.randomUUID()): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  let rawTags: unknown[];
  let rawReviews: unknown = {};
  let rawRounds: unknown[] = [];
  let videoName: string | null = null;
  let sourceVersion: 1 | 2 = 1;

  if (Array.isArray(raw)) {
    rawTags = raw;
  } else if (isObject(raw) && Array.isArray(raw.tags)) {
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`This file was made by a newer FightSmart (schema ${raw.schemaVersion}). Please update the app.`);
    }
    rawTags = raw.tags;
    videoName = typeof raw.videoName === 'string' ? raw.videoName : null;
    if (raw.schemaVersion === 2) {
      sourceVersion = 2;
      rawReviews = raw.reviews;
      rawRounds = Array.isArray(raw.rounds) ? raw.rounds : [];
    }
  } else {
    throw new Error('No tags found. Expected a FightSmart export file.');
  }

  let skipped = 0;
  const tags: Tag[] = [];
  for (const item of rawTags) {
    const tag = parseTag(item, makeId);
    if (tag) tags.push(tag);
    else skipped++;
  }

  const reviews: Reviews = {};
  if (isObject(rawReviews)) {
    for (const [id, status] of Object.entries(rawReviews)) {
      if (status === 'confirmed' || status === 'rejected') reviews[id] = status;
      else skipped++;
    }
  }

  const rounds: Round[] = [];
  for (const item of rawRounds) {
    const round = parseRound(item, makeId);
    if (round) rounds.push(round);
    else skipped++;
  }

  tags.sort((a, b) => a.time - b.time);
  rounds.sort((a, b) => a.start - b.start);
  return { tags, reviews, rounds, videoName, sourceVersion, skipped };
}

/**
 * Merges imported data into existing data without deleting anything.
 * Items with the same id are replaced by the imported version; new ids are added.
 */
export function mergeData(current: VideoData, incoming: VideoData): VideoData & { addedTags: number; updatedTags: number } {
  const byId = new Map(current.tags.map(t => [t.id, t]));
  let addedTags = 0;
  let updatedTags = 0;
  for (const tag of incoming.tags) {
    if (byId.has(tag.id)) updatedTags++;
    else addedTags++;
    byId.set(tag.id, tag);
  }

  const roundsById = new Map(current.rounds.map(r => [r.id, r]));
  for (const round of incoming.rounds) roundsById.set(round.id, round);

  return {
    tags: [...byId.values()].sort((a, b) => a.time - b.time),
    reviews: { ...current.reviews, ...incoming.reviews },
    rounds: [...roundsById.values()].sort((a, b) => a.start - b.start),
    addedTags,
    updatedTags,
  };
}
