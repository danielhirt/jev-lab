import { describe, expect, test } from "bun:test";
import { judgmentFromScores } from "../src/baseline";

const meta = { model: "m", inputTokens: 10, costUsd: 0.001, latencyMs: 5 };

describe("judgmentFromScores", () => {
  test("maps scores by word regardless of case and derives a first-pick distribution", () => {
    const j = judgmentFromScores("river", ["bank", "flow", "death"], [{ word: "BANK", p: 0.9 }, { word: "flow", p: 0.6 }, { word: "Death", p: 0 }], meta);
    expect(j.words.map((w) => w.p)).toEqual([0.9, 0.6, 0]);
    expect(j.words[0]!.first).toBeCloseTo(0.6);
    expect(j.model).toBe("m");
  });

  test("clamps out-of-range values", () => {
    const j = judgmentFromScores("x", ["a", "b"], [{ word: "a", p: 1.4 }, { word: "b", p: -0.2 }], meta);
    expect(j.words.map((w) => w.p)).toEqual([1, 0]);
  });

  test("rejects a response that skips a word", () => {
    expect(() => judgmentFromScores("x", ["a", "b"], [{ word: "a", p: 0.5 }], meta)).toThrow("left out 1");
  });
});
