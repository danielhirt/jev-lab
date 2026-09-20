/**
 * Threshold tuning on cached judgments: no network, no spend.
 *
 *   bun run eval/tune.ts data/salt-duet.jsonl [--cache data/cache-jev-latest-full.json]
 *
 * Every cached human clue is put through `evaluateClue` as if the spymaster had proposed it:
 * friendly words are the board minus the words the giver had to avoid, Duet's assassins are
 * assassins, and its bystanders take the opponent ceiling, as on the cooperative board.
 * For each policy we report how many clues it accepts, how many of those are for two or more
 * words, and what the human guesser then did: picked a word to avoid, or picked an assassin.
 * A good policy accepts more multi-word clues without raising those two rates.
 */
import { evaluateClue } from "../src/scorer";
import { DEFAULT_THRESHOLDS, type Board, type Judgment, type Thresholds } from "../src/types";
import { readRows } from "./dataset";

const argv = Bun.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback; };
const path = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!path) { console.error("usage: bun run eval/tune.ts <rows.jsonl> [--cache data/cache-jev-latest-full.json]"); process.exit(2); }

const cache = (await Bun.file(flag("cache", "data/cache-jev-latest-full.json")).json()) as Record<string, Judgment>;
const rows = (await readRows(path)).flatMap((row) => {
  const judgment = cache[JSON.stringify([row.clue.toLowerCase(), row.board.map((w) => w.toLowerCase())])];
  if (!judgment || !row.avoid) return [];
  const avoid = new Set(row.avoid), assassins = new Set(row.assassins ?? []);
  const board: Board = { seed: 0, startingTeam: "red", cards: row.board.map((word) => ({ word, revealed: false, kind: assassins.has(word) ? "assassin" : avoid.has(word) ? "blue" : "red" })) };
  const guess = row.guesses[0]!;
  return [{ judgment, board, bad: avoid.has(guess), assassin: assassins.has(guess) }];
});

const policies: [string, Thresholds][] = [["default", DEFAULT_THRESHOLDS]];
for (const assassinMax of [0.1, 0.2, 0.3, 0.4, 0.5]) for (const opponentMax of [0.4, 0.55, 0.7, 0.85]) {
  if (assassinMax === DEFAULT_THRESHOLDS.assassinMax && opponentMax === DEFAULT_THRESHOLDS.opponentMax) continue;
  policies.push([`assassin <= ${assassinMax}, opponent <= ${opponentMax}`, { ...DEFAULT_THRESHOLDS, assassinMax, opponentMax }]);
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
console.log(`${rows.length} cached clues; human guess hit a word to avoid on ${pct(rows.filter((r) => r.bad).length, rows.length)}, an assassin on ${pct(rows.filter((r) => r.assassin).length, rows.length)}\n`);
console.log("| policy | accepted | for 2+ words | avoid-word guess | assassin guess | same, 2+ words |\n| --- | --- | --- | --- | --- | --- |");
const lines = policies.map(([name, t]) => {
  const ok = rows.filter((r) => evaluateClue(r.judgment, r.board, "red", t).rejected === null);
  const multi = ok.filter((r) => evaluateClue(r.judgment, r.board, "red", t).number >= 2);
  return { name, ok: ok.length, multi: multi.length, bad: ok.filter((r) => r.bad).length, assassin: ok.filter((r) => r.assassin).length, multiBad: multi.filter((r) => r.bad).length, multiAssassin: multi.filter((r) => r.assassin).length };
});
for (const l of lines) console.log(`| ${l.name} | ${pct(l.ok, rows.length)} | ${pct(l.multi, rows.length)} | ${pct(l.bad, l.ok)} | ${pct(l.assassin, l.ok)} | ${pct(l.multiBad, l.multi)} / ${pct(l.multiAssassin, l.multi)} |`);
