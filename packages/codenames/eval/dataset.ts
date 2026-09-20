/**
 * One row per human clue. `board` is what the guesser could see when the clue was given;
 * `guesses` are the words the human actually picked for it, in order; `targets` are the
 * words the clue giver meant when the source records them; `avoid` are words the giver had
 * to steer away from (opponent, bystander, assassin), when known.
 */
export interface ClueRow {
  source: string;
  game: string;
  board: string[];
  clue: string;
  number?: number;
  guesses: string[];
  targets?: string[];
  avoid?: string[];
  assassin?: string;
  /** Every assassin still on the board; Duet has up to three. */
  assassins?: string[];
}

export async function readRows(path: string): Promise<ClueRow[]> {
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ClueRow);
}

export function writeRows(path: string, rows: readonly ClueRow[]): Promise<number> {
  return Bun.write(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
