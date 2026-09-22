/** Five ordered levels, 0 at the left pole through 4 at the right. */
export const LEVELS = 5;
export const SCALE_MAX = LEVELS - 1;
export const MAX_CLUES = 8;
export const MAX_CLUE_LENGTH = 40;

export interface Level {
  what: string;
  examples: readonly string[];
}

export interface Spectrum {
  id: string;
  left: string;
  right: string;
  levels: readonly [Level, Level, Level, Level, Level];
}

export interface Round {
  seed: number;
  spectrum: Spectrum;
  /** Hidden from Jev. A position on the scale, from 0 to SCALE_MAX. */
  target: number;
}

export interface ClueScore {
  clue: string;
  /** Expected level. May sit between integers. */
  score: number;
  /** How concentrated the level probabilities are. Not whether the clue hit the target. */
  confidence: number;
  probabilities: number[];
  distance: number;
  points: number;
  band: BandLabel;
}

export type BandLabel = "bullseye" | "close" | "nearby" | "off" | "miss";

export interface LiveScore {
  clues: ClueScore[];
  model: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
}
