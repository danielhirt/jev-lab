import { describe, expect, test } from "bun:test";
import { judgeQuestions, judgeState } from "../src/questions";

const words = ["bank", "flow", "death"];

describe("judgeQuestions", () => {
  test("builds one noul per word plus one choice over all words", () => {
    const q = judgeQuestions("river", words);
    expect(Object.keys(q)).toEqual(["BANK", "FLOW", "DEATH", "first"]);
    expect(q.BANK!.type).toBe("noul");
    const first = q.first!;
    expect(first.type).toBe("choice");
    if (first.type === "choice") expect(Object.keys(first.criteria)).toEqual(["BANK", "FLOW", "DEATH"]);
  });

  test("puts the literal words in the instruction, not only an index", () => {
    const q = judgeQuestions("river", words);
    const bank = q.BANK!;
    const text = String(bank.instructions);
    expect(text).toContain('"RIVER"');
    expect(text).toContain('"BANK"');
    expect(text).toContain("board[0]");
  });

  test("state carries only the note, the clue, and the board", () => {
    expect(Object.keys(judgeState("river", words))).toEqual(["game", "clue", "board"]);
  });
});
