import { describe, expect, test } from "bun:test";
import { scoreQuestions, scoreState } from "../src/questions";
import { deal, parseSeed, prepareClues } from "../src/round";
import { SPECTRA } from "../src/spectra";

describe("deal", () => {
  test("is deterministic and keeps the target on the scale", () => {
    const a = deal(7);
    const b = deal(7);
    expect(a).toEqual(b);
    expect(a.target).toBeGreaterThanOrEqual(0);
    expect(a.target).toBeLessThanOrEqual(4);
    expect(SPECTRA.map((s) => s.id)).toContain(a.spectrum.id);
  });

  test("different seeds can pick different spectra", () => {
    const ids = new Set(Array.from({ length: 30 }, (_, i) => deal(i + 1).spectrum.id));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("parseSeed", () => {
  test("accepts integers in range", () => {
    expect(parseSeed(7)).toBe(7);
    expect(parseSeed("12")).toBe(12);
    expect(parseSeed(0)).toBeNull();
    expect(parseSeed(1.5)).toBeNull();
    expect(parseSeed("nope")).toBeNull();
  });
});

describe("prepareClues", () => {
  const spectrum = SPECTRA[0]!;

  test("trims, rejects poles and duplicates, and caps the batch", () => {
    expect(prepareClues(["  mustard "], spectrum)).toEqual({ clues: ["mustard"] });
    expect("error" in prepareClues(["hot dog"], spectrum)).toBe(true);
    expect("error" in prepareClues(["a hot dog"], spectrum)).toBe(true);
    expect("error" in prepareClues(["mustard", "Mustard"], spectrum)).toBe(true);
    expect("error" in prepareClues([], spectrum)).toBe(true);
    expect("error" in prepareClues(Array.from({ length: 9 }, (_, i) => `clue ${i}`), spectrum)).toBe(true);
  });
});

describe("score payload", () => {
  test("asks one score per clue and leaves the target out", () => {
    const round = deal(7);
    const state = scoreState(round.spectrum, ["mustard", "pastrami"]);
    const questions = scoreQuestions(round.spectrum, ["mustard", "pastrami"]);
    expect(Object.keys(state).sort()).toEqual(["clues", "game", "left", "right"]);
    expect(JSON.stringify(questions)).not.toContain(`"target"`);
    expect(Object.keys(questions)).toEqual(["c0", "c1"]);
    const first = questions.c0;
    expect(first?.type).toBe("score");
    if (first?.type === "score") expect(first.criteria).toHaveLength(5);
  });
});
