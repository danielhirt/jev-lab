import type { Questions } from "@typesafe-ai/sdk";

/**
 * One request per clue: 25 nouls (absolute: does this clue reach this word?) and one choice
 * (relative: which word would a guesser reach for first?). Both read the same small state.
 * The rules of the game are not in the state; only what a "connection" means, so the model
 * judges association and code judges everything else.
 */
export const GAME_NOTE =
  "In Codenames a spymaster says one word as a clue and a guesser looks for the board words it " +
  "points at. A clue connects to a word when a typical adult player would readily see a link: " +
  "shared meaning, a category the word belongs to, a common phrase or compound they form, or a " +
  "strong everyday association. A link that needs a stretch, a pun, or specialist knowledge does not count.";

export function judgeState(clue: string, words: readonly string[]) {
  return { game: GAME_NOTE, clue: clue.toUpperCase(), board: words.map((w) => w.toUpperCase()) };
}

export function judgeQuestions(clue: string, words: readonly string[]): Questions {
  const questions: Questions = {};
  const CLUE = clue.toUpperCase();
  words.forEach((raw, i) => {
    const word = raw.toUpperCase();
    questions[word] = {
      type: "noul",
      instructions: `Would a typical guesser connect the clue \`clue\` ("${CLUE}") to the board word \`board[${i}]\` ("${word}")?`,
      criteria: {
        true: `A typical player would readily link "${CLUE}" and "${word}" by meaning, category, a common phrase, or a strong everyday association.`,
        false: `A typical player would not think of "${word}" on hearing "${CLUE}"; any link is absent, a stretch, or needs specialist knowledge.`,
      },
    };
  });
  questions.first = {
    type: "choice",
    instructions: `Which board word would a typical guesser pick first on hearing the clue \`clue\` ("${CLUE}")?`,
    criteria: Object.fromEntries(words.map((w) => [w.toUpperCase(), null])),
  };
  return questions;
}
