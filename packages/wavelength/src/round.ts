import { mulberry32 } from "./rng";
import { SPECTRA } from "./spectra";
import { MAX_CLUE_LENGTH, MAX_CLUES, type Round, type Spectrum } from "./types";

export function deal(seed: number): Round {
  const rand = mulberry32(seed);
  const spectrum = SPECTRA[Math.floor(rand() * SPECTRA.length)]!;
  const target = Math.round(rand() * 400) / 100;
  return { seed, spectrum, target };
}

export function parseSeed(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return null;
  return n;
}

export function normalizeClue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Code owns legality. A clue may not repeat a pole; the poles are already on the dial. */
export function clueError(clue: string, spectrum: Spectrum): string | null {
  if (!clue) return "Enter a clue.";
  if (clue.length > MAX_CLUE_LENGTH) return "Keep a clue under 40 characters.";
  if (!/\p{L}/u.test(clue)) return "Use a word or a short phrase.";
  const hay = ` ${clue.toLowerCase()} `;
  for (const pole of [spectrum.left, spectrum.right]) {
    if (hay.includes(` ${pole.toLowerCase()} `)) return `That clue repeats a pole. The poles are already "${spectrum.left}" and "${spectrum.right}".`;
  }
  return null;
}

export function prepareClues(raw: readonly string[], spectrum: Spectrum): { clues: string[] } | { error: string } {
  if (raw.length === 0) return { error: "Add a clue." };
  if (raw.length > MAX_CLUES) return { error: "Score up to 8 clues at once." };
  const clues: string[] = [];
  for (const item of raw) {
    const clue = normalizeClue(item);
    const error = clueError(clue, spectrum);
    if (error) return { error };
    if (clues.some((c) => c.toLowerCase() === clue.toLowerCase())) return { error: `"${clue}" is already on the list.` };
    clues.push(clue);
  }
  return { clues };
}
