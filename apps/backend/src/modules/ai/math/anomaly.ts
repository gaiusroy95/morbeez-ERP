// Exception detection (AI System "worth a look"): robust statistics, so a
// single wild value can't hide the others. A robust z-score uses the median
// and the median absolute deviation, which one outlier barely moves.

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** 0.6745 × (x − median) / MAD; when MAD is 0, fall back to the mean absolute deviation, then to 0. */
export function robustZ(x: number, xs: number[]): number {
  const m = median(xs);
  let d = mad(xs);
  if (d === 0) {
    const meanAbs = xs.reduce((s, v) => s + Math.abs(v - m), 0) / (xs.length || 1);
    if (meanAbs === 0) return 0;
    return (x - m) / (1.2533 * meanAbs);
  }
  return (0.6745 * (x - m)) / d;
}

/** The values whose robust z is at least `threshold` above the rest, with their z. */
export function highOutliers<T>(items: T[], value: (t: T) => number, threshold: number, minSamples: number): { item: T; z: number }[] {
  if (items.length < minSamples) return [];
  const xs = items.map(value);
  return items.map((item) => ({ item, z: robustZ(value(item), xs) })).filter((r) => r.z >= threshold);
}
