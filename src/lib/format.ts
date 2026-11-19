/** Formats seconds as mm:ss (floors partial seconds). */
export function stamp(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

/** Formats seconds as mm:ss.t (tenths, floored). Punches last ~0.2s, so whole seconds are too coarse for tags. */
export function stampPrecise(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10 + 1e-6);
  return `${stamp(tenths / 10)}.${tenths % 10}`;
}
