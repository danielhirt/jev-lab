import type { Board, ClueEvaluation, Judgment, Team, Thresholds, WordJudgment } from "./types";

/**
 * Order the guesses a clue implies: strongest noul first, the choice as tie-break.
 * A word below `act` is never guessed; the clue's number caps the run.
 */
export function guessOrder(judgment: Judgment, thresholds: Thresholds, number?: number): WordJudgment[] {
  const ordered = judgment.words
    .filter((w) => w.p >= thresholds.act)
    .sort((a, b) => b.p - a.p || b.first - a.first);
  return number === undefined ? ordered : ordered.slice(0, number);
}

/**
 * Evaluate one clue for one team. The number is how many friendly words clear `act`;
 * the assassin and opponent limits are hard rejections; words in the uncertain band never count.
 * Score ranks eligible clues: number first, then how far the targets clear the bar,
 * minus the risk the clue carries on non-friendly words.
 */
export function evaluateClue(judgment: Judgment, board: Board, team: Team, thresholds: Thresholds): ClueEvaluation {
  const kindOf = new Map(board.cards.map((c) => [c.word.toLowerCase(), c.kind]));
  const targets: string[] = [];
  const risks: string[] = [];
  let margin = 0;
  let rejected: string | null = null;

  for (const w of judgment.words) {
    const kind = kindOf.get(w.word.toLowerCase());
    if (!kind) throw new Error(`judged word ${w.word} is not on the board`);
    if (kind === team) {
      if (w.p >= thresholds.act) {
        targets.push(w.word);
        margin += w.p - thresholds.act;
      }
      continue;
    }
    if (kind === "assassin" && w.p > thresholds.assassinMax) rejected ??= `assassin "${w.word}" at ${w.p.toFixed(2)}`;
    if (kind !== "assassin" && kind !== "neutral" && w.p > thresholds.opponentMax) {
      rejected ??= `opponent "${w.word}" at ${w.p.toFixed(2)}`;
    }
    if (w.p >= thresholds.uncertainLow) risks.push(w.word);
  }

  if (targets.length === 0) rejected ??= "no friendly word clears the act threshold";
  const score = targets.length + margin - 0.5 * risks.length;
  return { clue: judgment.clue, number: targets.length, targets, risks, score, rejected, judgment };
}

export function pickClue(evaluations: readonly ClueEvaluation[]): ClueEvaluation | null {
  const eligible = evaluations.filter((e) => e.rejected === null);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, e) => (e.score > best.score ? e : best));
}
