import { describe, expect, it } from 'vitest';
import { buildExport, mergeData, parseImport, SCHEMA_VERSION } from './dataFile';
import { loadVideoData } from './storage';
import type { Tag } from './types';

let n = 0;
const makeId = () => `gen${++n}`;
const tag = (id: string, time: number, label = 'Jab'): Tag => ({ id, time, label, note: '', fighter: 'you' });

describe('parseImport', () => {
  it('round-trips a v2 export', () => {
    const data = {
      tags: [{ ...tag('a', 1), outcome: 'landed' as const }],
      reviews: { 'you:a:b': 'confirmed' as const },
      rounds: [{ id: 'r1', start: 0, end: 180 }],
    };
    const file = buildExport('spar.mp4', data, new Date('2026-01-01T00:00:00Z'));
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    const parsed = parseImport(JSON.stringify(file), makeId);
    expect(parsed).toEqual({ ...data, videoName: 'spar.mp4', sourceVersion: 2, skipped: 0 });
  });

  it('reads v1 exports from the original app ({ videoName, tags })', () => {
    const v1 = { videoName: 'old.mp4', tags: [tag('b', 5, 'Cross'), { id: 'c', time: 2, label: 'Slip', note: 'x' }] };
    const parsed = parseImport(JSON.stringify(v1), makeId);
    expect(parsed.sourceVersion).toBe(1);
    expect(parsed.videoName).toBe('old.mp4');
    expect(parsed.tags.map(t => t.id)).toEqual(['c', 'b']); // sorted by time
    expect(parsed.tags[0].fighter).toBeUndefined();
    expect(parsed.reviews).toEqual({});
    expect(parsed.rounds).toEqual([]);
  });

  it('accepts a bare array of tags', () => {
    expect(parseImport(JSON.stringify([tag('a', 1)]), makeId).tags).toHaveLength(1);
  });

  it('skips malformed items instead of failing, and repairs missing or unsafe ids', () => {
    const parsed = parseImport(JSON.stringify({
      schemaVersion: 2,
      tags: [
        { time: -1, label: 'Jab' }, { time: 1 }, 'junk', { time: 'NaN', label: 'Hook' },
        { time: 3, label: 'Hook', fighter: 'ref', outcome: 'ko' },
        { id: 'has:colon', time: 4, label: 'Jab' },
      ],
      reviews: { ok: 'confirmed', bad: 'maybe' },
      rounds: [{ start: 0, end: -5 }, { nope: true }],
    }), makeId);
    expect(parsed.skipped).toBe(6);
    expect(parsed.tags).toHaveLength(2);
    expect(parsed.tags[0]).toEqual({ id: expect.stringMatching(/^gen/), time: 3, label: 'Hook', note: '' });
    expect(parsed.tags[1].id).toMatch(/^gen/);
    expect(parsed.reviews).toEqual({ ok: 'confirmed' });
    expect(parsed.rounds).toEqual([{ id: expect.stringMatching(/^gen/), start: 0 }]);
  });

  it('rejects invalid JSON, wrong shapes, and newer schema versions with clear messages', () => {
    expect(() => parseImport('{oops', makeId)).toThrow(/not valid JSON/);
    expect(() => parseImport('{"hello":1}', makeId)).toThrow(/No tags found/);
    expect(() => parseImport('{"schemaVersion":99,"tags":[]}', makeId)).toThrow(/newer FightSmart/);
  });
});

describe('mergeData', () => {
  it('adds new tags, replaces same-id tags, and never deletes existing data', () => {
    const current = { tags: [tag('a', 1), tag('b', 2)], reviews: { x: 'rejected' as const }, rounds: [{ id: 'r1', start: 0 }] };
    const incoming = { tags: [tag('b', 2.5, 'Hook'), tag('c', 0.5)], reviews: { y: 'confirmed' as const }, rounds: [] };
    const merged = mergeData(current, incoming);
    expect(merged.tags.map(t => `${t.id}:${t.label}`)).toEqual(['c:Jab', 'a:Jab', 'b:Hook']);
    expect(merged.reviews).toEqual({ x: 'rejected', y: 'confirmed' });
    expect(merged.rounds).toHaveLength(1);
    expect(merged.addedTags).toBe(1);
    expect(merged.updatedTags).toBe(1);
  });
});

describe('loadVideoData', () => {
  it('loads data saved by the original app and survives corrupt entries', () => {
    const store: Record<string, string> = {
      k: JSON.stringify([tag('a', 1)]),
      'k:reviews': '{not json',
    };
    const data = loadVideoData('k', { getItem: key => store[key] ?? null });
    expect(data.tags).toHaveLength(1);
    expect(data.reviews).toEqual({});
    expect(data.rounds).toEqual([]);
  });
});
