/** Single byte ranges used by video elements for seeking. Multiple/malformed
 * ranges are ignored (full 200); valid but unsatisfiable ranges produce 416. */
export function videoByteRange(header: unknown, size: number):
  { start: number; end: number } | 'unsatisfiable' | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) ||
      (last !== undefined && !Number.isSafeInteger(last))) return undefined;
  if (size === 0 || (first === undefined && last === 0) ||
      (first !== undefined && (first >= size || (last !== undefined && last < first)))) {
    return 'unsatisfiable';
  }
  return first === undefined
    ? { start: Math.max(0, size - last!), end: size - 1 }
    : { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
