import { describe, expect, test } from "bun:test";
import { evaluateClue, guessOrder, pickClue } from "../src/scorer";
import { DEFAULT_THRESHOLDS, type Board, type Judgment } from "../src/types";

const board: Board = {
  seed: 0,
  startingTeam: "red",
  cards: [
    { word: "bank", kind: "red", revealed: false },
    { word: "flow", kind: "red", revealed: false },
    { word: "boat", kind: "red", revealed: false },
    { word: "money", kind: "blue", revealed: false },
    { word: "desert", kind: "neutral", revealed: false },
    { word: "death", kind: "assassin", revealed: false },
  ],
};

function judgment(clue: string, p: Record<string, number>): Judgment {
  const words = Object.entries(p).map(([word, prob]) => ({ word, p: prob, first: prob / 3 }));
  return { clue, words, model: "test", inputTokens: 100, costUsd: 0, latencyMs: 0 };
}

describe("evaluateClue", () => {
  test("counts friendly words above act and lists risks", () => {
    const e = evaluateClue(
      judgment("river", { bank: 0.9, flow: 0.8, boat: 0.5, money: 0.35, desert: 0.1, death: 0.02 }),
      board, "red", DEFAULT_THRESHOLDS,
    );
    expect(e.rejected).toBeNull();
    expect(e.number).toBe(2);
    expect(e.targets).toEqual(["bank", "flow"]);
    expect(e.risks).toEqual(["money"]);
  });

  test("rejects on the assassin regardless of targets", () => {
    const e = evaluateClue(
      judgment("grave", { bank: 0.9, flow: 0.9, boat: 0.9, money: 0.1, desert: 0.1, death: 0.3 }),
      board, "red", DEFAULT_THRESHOLDS,
    );
    expect(e.rejected).toContain("assassin");
  });

  test("rejects on a strong opponent word", () => {
    const e = evaluateClue(
      judgment("cash", { bank: 0.9, flow: 0.2, boat: 0.1, money: 0.95, desert: 0.1, death: 0.0 }),
      board, "red", DEFAULT_THRESHOLDS,
    );
    expect(e.rejected).toContain("opponent");
  });

  test("rejects when nothing clears the bar", () => {
    const e = evaluateClue(
      judgment("zzz", { bank: 0.2, flow: 0.2, boat: 0.2, money: 0.1, desert: 0.1, death: 0.0 }),
      board, "red", DEFAULT_THRESHOLDS,
    );
    expect(e.rejected).toContain("no friendly word");
  });
});

describe("pickClue", () => {
  test("prefers the higher number, then the cleaner clue", () => {
    const two = evaluateClue(judgment("river", { bank: 0.9, flow: 0.8, boat: 0.1, money: 0.1, desert: 0.1, death: 0.0 }), board, "red", DEFAULT_THRESHOLDS);
    const oneClean = evaluateClue(judgment("vessel", { bank: 0.1, flow: 0.1, boat: 0.95, money: 0.0, desert: 0.0, death: 0.0 }), board, "red", DEFAULT_THRESHOLDS);
    const twoRisky = evaluateClue(judgment("current", { bank: 0.8, flow: 0.8, boat: 0.1, money: 0.35, desert: 0.35, death: 0.0 }), board, "red", DEFAULT_THRESHOLDS);
    expect(pickClue([oneClean, two, twoRisky])?.clue).toBe("river");
    expect(pickClue([])).toBeNull();
  });
});

describe("guessOrder", () => {
  test("orders by noul, stops below act, and caps at the number", () => {
    const j = judgment("river", { bank: 0.9, flow: 0.8, boat: 0.75, money: 0.35, desert: 0.1, death: 0.02 });
    expect(guessOrder(j, DEFAULT_THRESHOLDS).map((w) => w.word)).toEqual(["bank", "flow", "boat"]);
    expect(guessOrder(j, DEFAULT_THRESHOLDS, 2).map((w) => w.word)).toEqual(["bank", "flow"]);
  });
});
