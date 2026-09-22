import { score, type Questions, type ScoreCriteria } from "@typesafe-ai/sdk";
import type { Spectrum } from "./types";

/**
 * What a clue is for. The hidden target is deliberately absent: code compares
 * Jev's score with the target after the call.
 */
export const GAME_NOTE =
  "In Wavelength, a player gives a short clue so that teammates will point at a hidden spot on a " +
  "spectrum between two poles. The clue is a hint, not an example of either pole. Place it where a " +
  "typical adult, playing in good faith, would point after hearing it, using ordinary associations. " +
  "A stretch, a pun, or specialist knowledge does not count. The hidden target is not in this state.";

/** Spectrum, poles, and clues only. No target field, no target value. */
export function scoreState(spectrum: Spectrum, clues: readonly string[]) {
  return {
    game: GAME_NOTE,
    left: spectrum.left,
    right: spectrum.right,
    clues: clues.slice(),
  };
}

function rubric(spectrum: Spectrum): ScoreCriteria {
  const levels = spectrum.levels.map((level) => ({ what: level.what, examples: [...level.examples] }));
  const [a, b, c, d, e] = levels;
  if (!a || !b || !c || !d || !e) throw new Error("a spectrum needs five levels");
  return [a, b, c, d, e];
}

export function scoreQuestions(spectrum: Spectrum, clues: readonly string[]): Questions {
  const criteria = rubric(spectrum);
  const questions: Questions = {};
  clues.forEach((clue, i) => {
    questions[`c${i}`] = score(
      `Hearing the clue \`clues[${i}]\` ("${clue}"), where would a typical player point on the spectrum ` +
        `from \`left\` ("${spectrum.left}") to \`right\` ("${spectrum.right}")? ` +
        "The first level is the left pole. The last level is the right pole.",
      criteria,
    );
  });
  return questions;
}
