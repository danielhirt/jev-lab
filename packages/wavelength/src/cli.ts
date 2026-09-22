/**
 * Wavelength on Jev. The target stays in this process.
 *
 *   bun run src/cli.ts deal [seed]
 *   bun run src/cli.ts score --seed <n> <clue> [clue...]
 *
 * `score` needs TYPESAFE_API_KEY in packages/wavelength/.env (Bun loads it
 * when you run from this package).
 */
import { TypeSafeJudge } from "./judge";
import { deal, parseSeed, prepareClues } from "./round";
import { closestClue, formatDial } from "./score";
import { SPECTRA } from "./spectra";

const [cmd, ...rest] = Bun.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return rest[i + 1];
}

function positionals(): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function requireSeed(value: string | undefined, fallback: number): number {
  const seed = parseSeed(value ?? fallback);
  if (seed === null) {
    console.error("Seed must be an integer from 1 to 1000000.");
    process.exit(1);
  }
  return seed;
}

if (cmd === "deal") {
  const seed = requireSeed(positionals()[0], 7);
  const round = deal(seed);
  console.log(`seed ${round.seed}  ${round.spectrum.id}`);
  console.log(`${round.spectrum.left}  ←  target ${round.target.toFixed(2)}  →  ${round.spectrum.right}`);
  round.spectrum.levels.forEach((level, i) => console.log(`  ${i}  ${level.what}`));
} else if (cmd === "spectra") {
  for (const spectrum of SPECTRA) console.log(`${spectrum.id.padEnd(20)} ${spectrum.left}  →  ${spectrum.right}`);
} else if (cmd === "score") {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("Set TYPESAFE_API_KEY in packages/wavelength/.env and run this from that package.");
    process.exit(1);
  }
  const seed = requireSeed(flag("seed"), 7);
  const round = deal(seed);
  const prepared = prepareClues(positionals(), round.spectrum);
  if ("error" in prepared) {
    console.error(prepared.error);
    process.exit(1);
  }
  const result = await new TypeSafeJudge().score(round.spectrum, prepared.clues, round.target);
  console.log(formatDial(round.spectrum.left, round.spectrum.right, round.target, result.clues));
  console.log(`target ${round.target.toFixed(2)}   seed ${seed}   ${round.spectrum.id}\n`);
  for (const clue of result.clues) {
    const probs = clue.probabilities.map((p) => p.toFixed(2)).join(" ");
    console.log(
      `${clue.clue.padEnd(24)} ${clue.score.toFixed(2)}   ${clue.band.padEnd(8)} ${clue.points} pts   ` +
        `dist ${clue.distance.toFixed(2)}   conf ${clue.confidence.toFixed(2)}   [${probs}]`,
    );
  }
  const best = closestClue(result.clues);
  if (best) console.log(`\nclosest: ${best.clue}`);
  console.log(`${result.model}: ${result.inputTokens} tokens, $${result.costUsd.toFixed(6)}, ${result.latencyMs.toFixed(0)} ms`);
} else {
  console.log(`Usage:
  bun run src/cli.ts deal [seed]                 print a seeded spectrum and its hidden target
  bun run src/cli.ts spectra                     list the spectra
  bun run src/cli.ts score --seed <n> <clues...> score clues with Jev (needs TYPESAFE_API_KEY)`);
  process.exit(cmd ? 1 : 0);
}
