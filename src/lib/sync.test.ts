import { describe, expect, it } from 'vitest';
import { reconcile } from './sync';
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
