/**
 * Phase 0 gate: does Jev's per-word probability track how humans give and take clues?
 *
 *   bun run eval/run.ts data/salt-duet.jsonl --n 100 --repeats 20 --seed 1
 *
 * Per clue, one request judges every remaining word. We report:
 *   guess AUC   P(the human's guess outranks a random other word) under Jev's noul
 *   guess top-1 how often the word with the highest noul is the human's guess
 *   first top-1 the same, using the Choice question's argmax
 *   target AUC  P(a giver target outranks a random non-target)
 *   brier       squared error of the noul against "human guessed it"
 *   assassin    noul on the assassin words, mean and p90 (lower is safer)
 *   repeat std  std of every word's noul over R repeats of a subset (stability)
 * plus median latency and cost per request. Judgments are cached in data/cache-*.json so a rerun is free.
 */
import { CachingJudge, TypeSafeJudge, type Judge } from "../src/judge";
import type { QuestionStyle } from "../src/questions";
import { readRows, type ClueRow } from "./dataset";
import { auc, brier, mean, median, percentile, std } from "./metrics";

interface Args { path: string; n: number; repeats: number; repeatRows: number; seed: number; concurrency: number; model: string; style: QuestionStyle }

function parseArgs(argv: string[]): Args {
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  let path: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]!.startsWith("--")) i++;
    else path ??= argv[i];
  }
  if (!path) throw new Error("usage: bun run eval/run.ts <rows.jsonl> [--n 100] [--repeats 20] [--repeat-rows 10] [--seed 1] [--concurrency 4] [--model jev-latest] [--style full|compact]");
  return {
    path,
    n: Number(flag("n", "100")),
    repeats: Number(flag("repeats", "20")),
    repeatRows: Number(flag("repeat-rows", "10")),
    seed: Number(flag("seed", "1")),
    concurrency: Number(flag("concurrency", "4")),
    model: flag("model", "jev-latest"),
    style: flag("style", "full") === "compact" ? "compact" : "full",
  };
}

function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pool = items.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  return pool.slice(0, n);
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(d));

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const rows = sample(await readRows(args.path), args.n, args.seed);
  const live: Judge = new TypeSafeJudge(undefined, args.model, args.style);
  const judge = new CachingJudge(live, `data/cache-${args.model}-${args.style}.json`);

  const guessAuc: number[] = [], targetAuc: number[] = [], brierPairs: [number, boolean][] = [];
  const assassinP: number[] = [], latencies: number[] = [], costs: number[] = [];
  let guessTop1 = 0, firstTop1 = 0;

  const judged = await mapLimit(rows, args.concurrency, (row) => judge.judge(row.clue, row.board));
  judged.forEach((j, idx) => {
    const row: ClueRow = rows[idx]!;
    const p = new Map(j.words.map((w) => [w.word, w.p]));
    const guessed = new Set(row.guesses);
    const targets = new Set(row.targets ?? []);
    const g = auc(row.board.filter((w) => guessed.has(w)).map((w) => p.get(w)!), row.board.filter((w) => !guessed.has(w)).map((w) => p.get(w)!));
    if (g !== null) guessAuc.push(g);
    if (targets.size > 0) {
      const t = auc(row.board.filter((w) => targets.has(w)).map((w) => p.get(w)!), row.board.filter((w) => !targets.has(w)).map((w) => p.get(w)!));
      if (t !== null) targetAuc.push(t);
    }
    for (const w of row.board) brierPairs.push([p.get(w)!, guessed.has(w)]);
    const byNoul = j.words.slice().sort((a, b) => b.p - a.p)[0]!;
    const byFirst = j.words.slice().sort((a, b) => b.first - a.first)[0]!;
    if (guessed.has(byNoul.word)) guessTop1++;
    if (guessed.has(byFirst.word)) firstTop1++;
    if (row.assassin && p.has(row.assassin)) assassinP.push(p.get(row.assassin)!);
    if (j.latencyMs > 0) latencies.push(j.latencyMs);
    if (j.costUsd > 0) costs.push(j.costUsd);
  });

  // Stability: re-judge a small subset R times through the live judge (the cache would hide variance).
  const stabilityRows = rows.slice(0, Math.min(args.repeatRows, rows.length));
  const perWordStd: number[] = [], assassinStd: number[] = [];
  if (args.repeats > 1) {
    for (const row of stabilityRows) {
      const reps = await mapLimit(Array.from({ length: args.repeats }), args.concurrency, () => live.judge(row.clue, row.board));
      row.board.forEach((w, i) => {
        const s = std(reps.map((r) => r.words[i]!.p));
        perWordStd.push(s);
        if (w === row.assassin) assassinStd.push(s);
      });
      latencies.push(...reps.map((r) => r.latencyMs));
      costs.push(...reps.map((r) => r.costUsd));
    }
  }

  const table = [
    ["clues judged", String(rows.length)],
    ["guess AUC (noul)", fmt(mean(guessAuc))],
    ["guess top-1 (noul argmax)", fmt(guessTop1 / rows.length)],
    ["guess top-1 (choice argmax)", fmt(firstTop1 / rows.length)],
    ["target AUC (noul)", fmt(mean(targetAuc))],
    ["brier vs guessed", fmt(brier(brierPairs))],
    ["assassin noul mean / p90", `${fmt(mean(assassinP))} / ${fmt(percentile(assassinP, 0.9))}`],
    ["repeat std, all words (mean)", args.repeats > 1 ? fmt(mean(perWordStd), 4) : "skipped"],
    ["repeat std, assassin (mean / max)", args.repeats > 1 ? `${fmt(mean(assassinStd), 4)} / ${fmt(Math.max(...assassinStd), 4)}` : "skipped"],
    ["latency ms median / p90", `${fmt(median(latencies), 0)} / ${fmt(percentile(latencies, 0.9), 0)}`],
    ["cost per request USD", fmt(mean(costs), 6)],
    ["model / style", `${judged[0]?.model ?? args.model} / ${args.style}`],
    ["input tokens per request (mean)", fmt(mean(judged.map((j) => j.inputTokens)), 0)],
  ];
  console.log("| metric | value |\n| --- | --- |");
  for (const [k, v] of table) console.log(`| ${k} | ${v} |`);
}

await main();
