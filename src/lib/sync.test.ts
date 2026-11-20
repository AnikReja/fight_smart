import { describe, expect, it } from 'vitest';
import { NO_DELETIONS, forgetDeletions, reconcile, recordDeletions } from './sync';
import { loadDeletions } from './storage';
import type { VideoData } from './dataFile';
import type { Tag } from './types';

const tag = (id: string, time: number, label = 'Jab'): Tag => ({ id, time, label, note: '', fighter: 'you' });
const data = (tags: Tag[] = [], extra: Partial<VideoData> = {}): VideoData => ({ tags, reviews: {}, rounds: [], ...extra });

describe('reconcile', () => {
  it('does nothing when both sides are empty', () => {
    expect(reconcile(data(), data())).toEqual({ data: data(), pushToServer: false, source: 'empty' });
  });

  it("uploads the browser's data to an empty server (first sync of old local tags)", () => {
    const local = data([tag('a', 1)]);
    expect(reconcile(local, data())).toEqual({ data: local, pushToServer: true, source: 'browser' });
  });

  it("loads the server's data into an empty browser (another browser or cleared storage)", () => {
    const remote = data([tag('a', 1)], { rounds: [{ id: 'r1', start: 0 }] });
    expect(reconcile(data(), remote)).toEqual({ data: remote, pushToServer: false, source: 'server' });
  });

  it('does not re-upload when both sides already match, regardless of order', () => {
    const r = reconcile(data([tag('b', 2), tag('a', 1)]), data([tag('a', 1), tag('b', 2)]));
    expect(r.pushToServer).toBe(false);
    expect(r.source).toBe('server');
  });

  it('merges without losing anything, with the browser winning on the same id', () => {
    const local = data([tag('a', 1, 'Hook'), tag('c', 3)], { reviews: { 'you:a:c': 'confirmed' } });
    const remote = data([tag('a', 1, 'Jab'), tag('b', 2)], { reviews: { 'you:x:y': 'rejected' } });
    const r = reconcile(local, remote);
    expect(r.source).toBe('merged');
    expect(r.pushToServer).toBe(true);
    expect(r.data.tags.map(t => `${t.id}:${t.label}`)).toEqual(['a:Hook', 'b:Jab', 'c:Jab']);
    expect(r.data.reviews).toEqual({ 'you:x:y': 'rejected', 'you:a:c': 'confirmed' });
  });
});

describe('deletions', () => {
  const del = (tags: string[] = [], rounds: string[] = [], reviews: string[] = []) => ({ tags, rounds, reviews });

  it('records ids that disappear, and un-records ids that come back', () => {
    const before = data([tag('a', 1), tag('b', 2)], { rounds: [{ id: 'r1', start: 0 }], reviews: { 'you:a:b': 'confirmed' } });
    const after = data([tag('a', 1)]);
    expect(recordDeletions(before, after, NO_DELETIONS)).toEqual(del(['b'], ['r1'], ['you:a:b']));
    const reimported = data([tag('a', 1), tag('b', 2)]);
    expect(recordDeletions(after, reimported, del(['b', 'z']))).toEqual(del(['z']));
  });

  it('forgets only the ids that were sent', () => {
    expect(forgetDeletions(del(['a', 'b'], ['r']), del(['a']))).toEqual(del(['b'], ['r']));
  });

  it('keeps a tag deleted while the server was off deleted, and uploads the deletion', () => {
    const server = data([tag('a', 1), tag('b', 2)]);
    const browser = data([tag('a', 1)]); // deleted b offline
    const r = reconcile(browser, server, del(['b']));
    expect(r.data.tags.map(t => t.id)).toEqual(['a']);
    expect(r.pushToServer).toBe(true);
    // Without the record, the old behaviour: b comes back.
    expect(reconcile(browser, server).data.tags.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('still merges tags added elsewhere, and handles deleting everything', () => {
    const server = data([tag('a', 1), tag('new', 5)]);
    expect(reconcile(data([tag('c', 3)]), server, del(['a'])).data.tags.map(t => t.id)).toEqual(['c', 'new']); // sorted by time
    const all = reconcile(data(), data([tag('a', 1)]), del(['a']));
    expect(all).toEqual({ data: data(), pushToServer: true, source: 'browser' });
  });

  it('drops deleted rounds and combo decisions too', () => {
    const server = data([tag('a', 1)], { rounds: [{ id: 'r1', start: 0 }], reviews: { 'you:a:b': 'rejected' } });
    const r = reconcile(data([tag('a', 1)]), server, del([], ['r1'], ['you:a:b']));
    expect(r.data.rounds).toEqual([]);
    expect(r.data.reviews).toEqual({});
    expect(r.pushToServer).toBe(true);
  });

  it('loads a malformed record as no deletions', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(loadDeletions('k', store(null))).toEqual(NO_DELETIONS);
    expect(loadDeletions('k', store('{bad'))).toEqual(NO_DELETIONS);
    expect(loadDeletions('k', store('{"tags":["a",3],"rounds":"x"}'))).toEqual(del(['a']));
  });
});
