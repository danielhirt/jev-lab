import { describe, expect, test } from "bun:test";
import { newBoard } from "../src/board";
import { applyGuesses, keyFor, playGame, spymasterTurn, type Proposer } from "../src/game";
import type { Judge } from "../src/judge";
import { DEFAULT_THRESHOLDS, type Board, type Judgment } from "../src/types";

/** A judge whose opinion is a lookup table: clue -> word -> p. Unlisted pairs are 0.05. */
class TableJudge implements Judge {
  calls = 0;
  constructor(private readonly table: Record<string, Record<string, number>>) {}
  async judge(clue: string, words: readonly string[]): Promise<Judgment> {
    this.calls++;
    const row = this.table[clue] ?? {};
    const ps = words.map((w) => row[w] ?? 0.05);
    const total = ps.reduce((a, b) => a + b, 0);
    return {
      clue,
      words: words.map((w, i) => ({ word: w, p: ps[i]!, first: ps[i]! / total })),
      model: "table",
      inputTokens: 10,
      costUsd: 0.000001,
      latencyMs: 1,
    };
  }
}

class ListProposer implements Proposer {
  constructor(private readonly clues: string[]) {}
  async propose() {
    return { clues: this.clues, model: "list", costUsd: 0, latencyMs: 0 };
  }
}

const board: Board = {
  seed: 1,
  startingTeam: "red",
  cards: [
    { word: "bank", kind: "red", revealed: false },
    { word: "flow", kind: "red", revealed: false },
    { word: "boat", kind: "blue", revealed: false },
    { word: "money", kind: "blue", revealed: false },
    { word: "desert", kind: "neutral", revealed: false },
    { word: "death", kind: "assassin", revealed: false },
  ],
};

describe("keyFor", () => {
  test("splits the live board by kind for the team", () => {
    const key = keyFor(board, "blue");
    expect(key.friendly).toEqual(["boat", "money"]);
    expect(key.opponent).toEqual(["bank", "flow"]);
    expect(key.neutral).toEqual(["desert"]);
    expect(key.assassin).toBe("death");
  });
});

describe("spymasterTurn", () => {
  test("drops illegal clues, judges the rest, and picks the best legal one", async () => {
    const judge = new TableJudge({
      river: { bank: 0.9, flow: 0.85, boat: 0.3 },
      cash: { bank: 0.9, money: 0.95 },
    });
    const proposer = new ListProposer(["river", "Bank", "cash", "river", "two words"]);
    const turn = await spymasterTurn(board, "red", proposer, judge, DEFAULT_THRESHOLDS, { candidates: 5, concurrency: 2 });
    expect(turn.illegal.map((i) => i.clue)).toEqual(["bank", "two words"]);
    expect(judge.calls).toBe(2);
    expect(turn.chosen?.clue).toBe("river");
    expect(turn.chosen?.number).toBe(2);
    expect(turn.candidates.find((c) => c.clue === "cash")?.rejected).toContain("opponent");
    expect(turn.judge.pairs).toBe(12);
  });

  test("returns no clue when everything is rejected", async () => {
    const judge = new TableJudge({ grave: { bank: 0.9, death: 0.5 } });
    const turn = await spymasterTurn(board, "red", new ListProposer(["grave"]), judge, DEFAULT_THRESHOLDS);
    expect(turn.chosen).toBeNull();
  });
});

describe("applyGuesses", () => {
  const judgment = (p: Record<string, number>): Judgment => ({
    clue: "x",
    words: board.cards.map((c) => ({ word: c.word, p: p[c.word] ?? 0.05, first: 0 })),
    model: "t", inputTokens: 0, costUsd: 0, latencyMs: 0,
  });

  test("stops after the number when all guesses are right", () => {
    const out = applyGuesses(board, "red", judgment({ bank: 0.9, flow: 0.8 }), 2, DEFAULT_THRESHOLDS);
    expect(out.stop).toBe("done");
    expect(out.guesses.map((g) => g.word)).toEqual(["bank", "flow"]);
    expect(out.board.cards.filter((c) => c.revealed)).toHaveLength(2);
  });

  test("stops on the first wrong word and on the assassin", () => {
    expect(applyGuesses(board, "red", judgment({ bank: 0.9, desert: 0.8, flow: 0.75 }), 3, DEFAULT_THRESHOLDS).stop).toBe("wrong");
    expect(applyGuesses(board, "red", judgment({ death: 0.9 }), 1, DEFAULT_THRESHOLDS).stop).toBe("assassin");
    expect(applyGuesses(board, "red", judgment({}), 1, DEFAULT_THRESHOLDS).stop).toBe("nothing");
  });
});

describe("playGame", () => {
  test("ends in a stalemate when both sides pass on the same board", async () => {
    const judge = new TableJudge({});
    const log = await playGame(newBoard(3), new ListProposer(["nothing"]), judge, DEFAULT_THRESHOLDS, { candidates: 1, concurrency: 1 });
    expect(log.reason).toBe("stalemate");
    expect(log.turns).toHaveLength(2);
    expect(log.winner).toBeNull();
  });

  test("runs to a result on a real seeded board with a cooperative fake judge", async () => {
    const real = newBoard(7);
    // A judge that, for clue "team:<color>", loves every word of that color: the proposer knows the key.
    const judge: Judge = {
      async judge(clue, words) {
        const color = clue.startsWith("red") ? "red" : clue.startsWith("blue") ? "blue" : null;
        const kind = new Map(real.cards.map((c) => [c.word, c.kind]));
        return {
          clue,
          words: words.map((w) => ({ word: w, p: color && kind.get(w) === color ? 0.9 : 0.02, first: 1 / words.length })),
          model: "t", inputTokens: 0, costUsd: 0, latencyMs: 0,
        };
      },
    };
    const proposer: Proposer = { async propose(input) { return { clues: [input.friendly.length > 0 && real.cards.find((c) => c.word === input.friendly[0])!.kind === "red" ? "redclue" : "blueclue"], model: "t", costUsd: 0, latencyMs: 0 }; } };
    const log = await playGame(real, proposer, judge, DEFAULT_THRESHOLDS, { candidates: 1, concurrency: 1 });
    expect(log.winner).toBe(real.startingTeam);
    expect(log.reason).toBe("cleared");
    expect(log.turns).toHaveLength(1);
    expect(log.turns[0]!.number).toBe(9);
  });
});
