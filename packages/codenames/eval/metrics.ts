/** Metrics for the offline gate. All pure; inputs are plain numbers so they are easy to test. */

/** Probability that a random positive outranks a random negative (Mann-Whitney AUC). Ties count half. */
export function auc(positives: readonly number[], negatives: readonly number[]): number | null {
  if (positives.length === 0 || negatives.length === 0) return null;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

/** Mean squared error between probabilities and 0/1 outcomes. Lower is better; 0.25 is coin-flipping. */
export function brier(pairs: readonly (readonly [p: number, outcome: boolean])[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((s, [p, o]) => s + (p - (o ? 1 : 0)) ** 2, 0) / pairs.length;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function percentile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}
