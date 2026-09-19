import { describe, expect, test } from "bun:test";
import { newBoard, remaining, reveal, unrevealed } from "../src/board";

describe("newBoard", () => {
  test("is deterministic per seed", () => {
    const a = newBoard(42);
    const b = newBoard(42);
    expect(a).toEqual(b);
    expect(newBoard(43).cards.map((c) => c.word)).not.toEqual(a.cards.map((c) => c.word));
  });

  test("has the standard composition", () => {
    for (const seed of [1, 2, 3, 1000]) {
      const board = newBoard(seed);
      const other = board.startingTeam === "red" ? "blue" : "red";
      expect(board.cards).toHaveLength(25);
      expect(new Set(board.cards.map((c) => c.word)).size).toBe(25);
      expect(remaining(board, board.startingTeam)).toBe(9);
      expect(remaining(board, other)).toBe(8);
      expect(remaining(board, "neutral")).toBe(7);
      expect(remaining(board, "assassin")).toBe(1);
    }
  });
});

describe("reveal", () => {
  test("marks one card and leaves the rest", () => {
    const board = newBoard(7);
    const word = board.cards[0]!.word;
    const after = reveal(board, word);
    expect(unrevealed(after)).toHaveLength(24);
    expect(after.cards[0]!.revealed).toBe(true);
    expect(board.cards[0]!.revealed).toBe(false);
  });

  test("rejects a word that is not on the board", () => {
    expect(() => reveal(newBoard(7), "not-a-word")).toThrow();
  });
});
