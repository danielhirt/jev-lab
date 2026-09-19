import { describe, expect, test } from "bun:test";
import { clueRejection, isLegalClue, stem } from "../src/legality";

const board = ["fire", "bank", "night", "horse", "apple"];

describe("clueRejection", () => {
  test("accepts an ordinary clue", () => {
    expect(clueRejection("water", board)).toBeNull();
    expect(isLegalClue("river", board)).toBe(true);
  });

  test("rejects multi-word and non-letter clues", () => {
    expect(clueRejection("ice cream", board)).not.toBeNull();
    expect(clueRejection("42", board)).not.toBeNull();
    expect(clueRejection("", board)).not.toBeNull();
  });

  test("rejects board words in any case", () => {
    expect(clueRejection("FIRE", board)).toContain("on the board");
  });

  test("rejects compounds either way", () => {
    expect(clueRejection("firefly", board)).toContain("contains");
    expect(clueRejection("nightmare", board)).toContain("contains");
    expect(clueRejection("ban", board)).toBeNull(); // a three-letter substring is not a compound
    expect(clueRejection("fires", board)).not.toBeNull();
  });

  test("rejects inflections", () => {
    expect(clueRejection("horses", board)).not.toBeNull();
    expect(clueRejection("apples", board)).not.toBeNull();
    expect(clueRejection("banking", board)).not.toBeNull();
  });

  test("stem is conservative", () => {
    expect(stem("horses")).toBe("hors");
    expect(stem("horse")).toBe("hors");
    expect(stem("bus")).toBe("bus");
  });
});
