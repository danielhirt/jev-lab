/**
 * Small CLI for poking at the engine.
 *   bun run src/cli.ts board <seed>                 print a seeded board with its key
 *   bun run src/cli.ts judge <clue> --seed <n>      judge one clue against that board (live, needs TYPESAFE_API_KEY)
 */
import { newBoard, unrevealed } from "./board";
import { clueRejection } from "./legality";
import { TypeSafeJudge } from "./judge";
import { evaluateClue, guessOrder } from "./scorer";
import { DEFAULT_THRESHOLDS } from "./types";

const [cmd, ...rest] = Bun.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
};

const mark = { red: "R", blue: "B", neutral: "·", assassin: "X" } as const;

if (cmd === "board") {
  const board = newBoard(Number(rest[0] ?? "1"));
  console.log(`seed ${board.seed}, ${board.startingTeam} starts`);
  for (let r = 0; r < 5; r++) {
    console.log(board.cards.slice(r * 5, r * 5 + 5).map((c) => `${mark[c.kind]} ${c.word.padEnd(10)}`).join(" "));
  }
} else if (cmd === "judge" && rest[0]) {
  const clue = rest[0];
  const board = newBoard(Number(flag("seed", "1")));
  const words = unrevealed(board).map((c) => c.word);
  const illegal = clueRejection(clue, words);
  if (illegal) { console.error(`illegal clue: ${illegal}`); process.exit(1); }
  const judgment = await new TypeSafeJudge().judge(clue, words);
  const kind = new Map(board.cards.map((c) => [c.word, c.kind]));
  for (const w of judgment.words.slice().sort((a, b) => b.p - a.p)) {
    console.log(`${mark[kind.get(w.word)!]} ${w.word.padEnd(10)} p=${w.p.toFixed(2)} first=${w.first.toFixed(2)}`);
  }
  const team = board.startingTeam;
  const evaluation = evaluateClue(judgment, board, team, DEFAULT_THRESHOLDS);
  console.log(`\nas ${team}: ${evaluation.rejected ? `rejected (${evaluation.rejected})` : `${clue.toUpperCase()} ${evaluation.number} -> ${evaluation.targets.join(", ")}`}`);
  console.log(`guess order: ${guessOrder(judgment, DEFAULT_THRESHOLDS).map((w) => w.word).join(" > ") || "(nothing clears the bar)"}`);
  console.log(`${judgment.model}: ${judgment.inputTokens} tokens, $${judgment.costUsd.toFixed(6)}, ${judgment.latencyMs.toFixed(0)} ms`);
} else {
  console.log("usage: cli board <seed> | cli judge <clue> --seed <n>");
  process.exit(2);
}
