import { SCALE_MAX, type BandLabel, type ClueScore } from "./types";

const BANDS: readonly { maxDistance: number; points: number; label: BandLabel }[] = [
  { maxDistance: 0.35, points: 4, label: "bullseye" },
  { maxDistance: 0.75, points: 3, label: "close" },
  { maxDistance: 1.25, points: 2, label: "nearby" },
  { maxDistance: 2, points: 1, label: "off" },
  { maxDistance: Infinity, points: 0, label: "miss" },
];

export function expectedFromProbabilities(probabilities: readonly number[]): number {
  return probabilities.reduce((sum, p, i) => sum + p * i, 0);
}

export function distanceTo(target: number, score: number): number {
  return Math.abs(score - target);
}

export function bandFor(distance: number): { points: number; label: BandLabel } {
  const band = BANDS.find((b) => distance <= b.maxDistance)!;
  return { points: band.points, label: band.label };
}

export function gradeClue(clue: string, target: number, score: number, confidence: number, probabilities: number[]): ClueScore {
  const distance = distanceTo(target, score);
  const band = bandFor(distance);
  return { clue, score, confidence, probabilities, distance, points: band.points, band: band.label };
}

/** Closest clue wins. A tie keeps the earlier clue. */
export function closestClue(clues: readonly ClueScore[]): ClueScore | null {
  let best: ClueScore | null = null;
  for (const clue of clues) {
    if (!best || clue.distance < best.distance) best = clue;
  }
  return best;
}

export function formatDial(left: string, right: string, target: number, clues: readonly ClueScore[]): string {
  const width = 40;
  const at = (score: number) => Math.max(0, Math.min(width - 1, Math.round((score / SCALE_MAX) * (width - 1))));
  const ticks = Array.from({ length: width }, () => "-");
  ticks[at(target)] = "▲";
  for (const clue of clues) {
    const i = at(clue.score);
    if (ticks[i] === "-") ticks[i] = "●";
  }
  return `${left}\n${ticks.join("")}\n${right}`;
}
