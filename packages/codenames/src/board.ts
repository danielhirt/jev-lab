import { mulberry32, shuffle } from "./rng";
import type { Board, Card, CardKind, Team } from "./types";
import { WORDS } from "./words";

export const BOARD_SIZE = 25;

/** Standard Codenames layout: starting team 9, other team 8, 7 bystanders, 1 assassin. */
export function layout(startingTeam: Team): CardKind[] {
  const other: Team = startingTeam === "red" ? "blue" : "red";
  return [
    ...Array<CardKind>(9).fill(startingTeam),
    ...Array<CardKind>(8).fill(other),
    ...Array<CardKind>(7).fill("neutral"),
    "assassin",
  ];
}

/**
 * Cooperative layout, for one team against the board: 9 agents to find, 15 bystanders, 1 assassin.
 * Bystanders take the other team's kind so the scorer's opponent ceiling applies to all of them,
 * which is the right rule when any wrong guess ends the turn.
 */
export function coopLayout(team: Team): CardKind[] {
  const other: Team = team === "red" ? "blue" : "red";
  return [...Array<CardKind>(9).fill(team), ...Array<CardKind>(15).fill(other), "assassin"];
}

export interface BoardOptions {
  words?: readonly string[];
  /** Cooperative single-team board; the starting team is the one to find. */
  coop?: boolean;
}

export function newBoard(seed: number, options: BoardOptions | readonly string[] = {}): Board {
  const opts: BoardOptions = Array.isArray(options) ? { words: options as readonly string[] } : (options as BoardOptions);
  const words = opts.words ?? WORDS;
  if (new Set(words).size < BOARD_SIZE) throw new Error("word list needs 25 distinct words");
  const rand = mulberry32(seed);
  const startingTeam: Team = rand() < 0.5 ? "red" : "blue";
  const picked = shuffle(words, rand).slice(0, BOARD_SIZE);
  const kinds = shuffle(opts.coop ? coopLayout(startingTeam) : layout(startingTeam), rand);
  const cards: Card[] = picked.map((word, i) => ({ word, kind: kinds[i]!, revealed: false }));
  return { seed, startingTeam, cards };
}

export function unrevealed(board: Board): Card[] {
  return board.cards.filter((c) => !c.revealed);
}

export function reveal(board: Board, word: string): Board {
  const cards = board.cards.map((c) => (c.word === word ? { ...c, revealed: true } : c));
  if (cards.every((c, i) => c === board.cards[i])) throw new Error(`no card named ${word}`);
  return { ...board, cards };
}

export function remaining(board: Board, kind: CardKind): number {
  return board.cards.filter((c) => c.kind === kind && !c.revealed).length;
}
