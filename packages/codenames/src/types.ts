export type Team = "red" | "blue";
export type CardKind = Team | "neutral" | "assassin";

export interface Card {
  word: string;
  kind: CardKind;
  revealed: boolean;
}

export interface Board {
  seed: number;
  startingTeam: Team;
  cards: Card[];
}

/** Jev's answers for one clue against one board word. */
export interface WordJudgment {
  word: string;
  /** Noul: P(a competent guesser connects the clue to this word). Absolute. */
  p: number;
  /** Choice: P(this is the first word a guesser would pick). Relative; sums to 1 over the board. */
  first: number;
}

export interface Judgment {
  clue: string;
  words: WordJudgment[];
  model: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/** All thresholds live here, in code, and are the only place policy is set. */
export interface Thresholds {
  /** A word at or above this counts toward the clue's number. */
  act: number;
  /** Below this a word is treated as unrelated; between here and `act` it is uncertain and never counted. */
  uncertainLow: number;
  /** A clue is rejected outright if the assassin's p is above this. */
  assassinMax: number;
  /** A clue is rejected if any opponent word's p is above this. */
  opponentMax: number;
}

/**
 * The two ceilings were set on 1,506 human clues (`eval/tune.ts`). Human guessers picked an assassin
 * no more often when Jev had it anywhere under 0.30 than under 0.10, and the rate climbed above that;
 * they picked a word to avoid more often once Jev had one above 0.55.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  act: 0.7,
  uncertainLow: 0.3,
  assassinMax: 0.3,
  opponentMax: 0.55,
};

export interface ClueEvaluation {
  clue: string;
  /** Number of friendly words at or above `act`; the number announced with the clue. */
  number: number;
  targets: string[];
  /** Non-friendly words in or above the uncertain band; the risk the clue carries. */
  risks: string[];
  score: number;
  rejected: string | null;
  judgment: Judgment;
}
