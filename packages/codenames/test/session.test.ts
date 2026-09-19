import { describe, expect, test } from "bun:test";
import { askClue, giveClue, guess, newGame, pass, preview, previewBaseline, TURN_LIMIT, view, type Game } from "../server/session";
import type { Judge } from "../src/judge";
import { ListProposer } from "../src/proposer";
import { DEFAULT_THRESHOLDS, type Judgment } from "../src/types";

/** Loves every agent word for any clue starting with "good", nothing otherwise. */
function judgeFor(game: Game, love: Record<string, number> = {}): Judge {
  return {
    async judge(clue, words): Promise<Judgment> {
      const kind = new Map(game.board.cards.map((c) => [c.word, c.kind]));
      const ws = words.map((w) => {
        const base = love[w] ?? (clue.startsWith("good") && kind.get(w) === game.team ? 0.9 : 0.05);
        return { word: w, p: base, first: 1 / words.length };
      });
      return { clue, words: ws, model: "t", inputTokens: 100, costUsd: 0.0001, latencyMs: 10 };
    },
  };
}

describe("view", () => {
  test("hides roles from the guesser until revealed, shows all to the spymaster", () => {
    const g = newGame("g1", "guesser", 5);
    expect(view(g).cards.every((c) => c.role === undefined)).toBe(true);
    const s = newGame("s1", "spymaster", 5);
    expect(view(s).cards.filter((c) => c.role === "agent")).toHaveLength(9);
    expect(view(s).cards.filter((c) => c.role === "assassin")).toHaveLength(1);
    expect(view(s).turnsLeft).toBe(TURN_LIMIT);
  });
});

describe("spymaster mode", () => {
  test("preview reports illegal clues without judging", async () => {
    const g = newGame("s", "spymaster", 5);
    const word = g.board.cards[0]!.word;
    const r = await preview(g, word, judgeFor(g));
    expect(r.illegal).toContain("on the board");
    expect(g.meter.jevRequests).toBe(0);
  });

  test("giveClue lets Jev guess up to the number and wins when the agents are cleared", async () => {
    const g = newGame("s", "spymaster", 5);
    const judge = judgeFor(g);
    const t1 = await giveClue(g, "goodone", 4, judge, DEFAULT_THRESHOLDS);
    expect(t1.guesses).toHaveLength(4);
    expect(t1.guesses.every((x) => x.role === "agent")).toBe(true);
    expect(t1.stop).toBe("done");
    expect(t1.heat).not.toBeNull();
    expect(view(g).agentsLeft).toBe(5);
    await giveClue(g, "goodtwo", 9, judge, DEFAULT_THRESHOLDS);
    expect(g.status).toBe("won");
    expect(g.reason).toBe("cleared");
    expect(g.meter.jevRequests).toBe(2);
    await expect(giveClue(g, "goodthree", 1, judge, DEFAULT_THRESHOLDS)).rejects.toThrow("over");
  });

  test("a clue that reaches the assassin loses", async () => {
    const g = newGame("s", "spymaster", 5);
    const assassin = g.board.cards.find((c) => c.kind === "assassin")!.word;
    await giveClue(g, "grave", 1, judgeFor(g, { [assassin]: 0.95 }), DEFAULT_THRESHOLDS);
    expect(g.status).toBe("lost");
    expect(g.reason).toBe("assassin");
  });

  test("the turn limit ends the game", async () => {
    const g = newGame("s", "spymaster", 5);
    for (let i = 0; i < TURN_LIMIT; i++) await giveClue(g, "nothing" + "abcdefghi"[i], 1, judgeFor(g), DEFAULT_THRESHOLDS);
    expect(g.status).toBe("lost");
    expect(g.reason).toBe("turn-limit");
  });
});

describe("baseline preview", () => {
  test("meters the comparison arm separately and never touches the board", async () => {
    const g = newGame("s", "spymaster", 5);
    const j = await previewBaseline(g, "goodone", judgeFor(g));
    expect(j.words).toHaveLength(25);
    expect(g.meter.baselineRequests).toBe(1);
    expect(g.meter.jevRequests).toBe(0);
    expect(g.turns).toHaveLength(0);
    await expect(previewBaseline(g, g.board.cards[0]!.word, judgeFor(g))).rejects.toThrow("illegal");
  });
});

describe("guesser mode", () => {
  test("askClue withholds the heat until the person's turn ends", async () => {
    const g = newGame("g", "guesser", 5);
    const judge = judgeFor(g);
    const opened = await askClue(g, new ListProposer(["goodclue", "nothing"]), judge, DEFAULT_THRESHOLDS, 2);
    expect(opened.stop).toBe("open");
    expect(opened.clue).toBe("goodclue");
    expect(opened.number).toBe(9);
    expect(opened.heat).toBeNull();
    expect(opened.pipeline?.judged).toBe(2);
    expect(view(g).open?.clue).toBe("goodclue");
    await expect(askClue(g, new ListProposer(["x"]), judge, DEFAULT_THRESHOLDS, 1)).rejects.toThrow("finish");

    const agent = g.board.cards.find((c) => c.kind === g.team)!.word;
    const bystander = g.board.cards.find((c) => c.kind !== g.team && c.kind !== "assassin")!.word;
    const mid = guess(g, agent);
    expect(mid.stop).toBe("open");
    expect(mid.guesses[0]).toMatchObject({ word: agent, role: "agent", p: 0.9 });
    const done = guess(g, bystander);
    expect(done.stop).toBe("wrong");
    expect(done.heat).not.toBeNull();
    expect(done.targets).toHaveLength(9);
    expect(g.open).toBeNull();
    expect(view(g).cards.find((c) => c.word === bystander)?.role).toBe("bystander");
    expect(view(g).cards.filter((c) => c.role !== undefined)).toHaveLength(2);
  });

  test("askClue streams verdicts while it works", async () => {
    const g = newGame("g", "guesser", 5);
    const seen: string[] = [];
    await askClue(g, new ListProposer(["goodclue", "nothing"]), judgeFor(g), DEFAULT_THRESHOLDS, 2, (e) => seen.push(e.clue));
    expect(seen.sort()).toEqual(["goodclue", "nothing"]);
  });

  test("a pass when nothing is eligible costs a turn", async () => {
    const g = newGame("g", "guesser", 5);
    const t = await askClue(g, new ListProposer(["nothing"]), judgeFor(g), DEFAULT_THRESHOLDS, 1);
    expect(t.stop).toBe("pass");
    expect(view(g).turnsLeft).toBe(TURN_LIMIT - 1);
  });

  test("pass closes an open turn and releases the heat", async () => {
    const g = newGame("g", "guesser", 5);
    await askClue(g, new ListProposer(["goodclue"]), judgeFor(g), DEFAULT_THRESHOLDS, 1);
    const t = pass(g);
    expect(t.stop).toBe("pass");
    expect(t.heat).not.toBeNull();
  });
});
