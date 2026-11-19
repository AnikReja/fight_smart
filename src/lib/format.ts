/** Formats seconds as mm:ss (floors partial seconds). */
export function stamp(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
