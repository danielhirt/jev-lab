/**
 * One cooperative game: a person and Jev against the board. In `spymaster` mode the person
 * gives clues and Jev guesses; in `guesser` mode Jev gives clues (a proposer brainstorms,
 * Jev judges, code picks) and the person guesses. Pure state transitions live here; the
 * HTTP layer in index.ts only parses requests and calls these.
 */
import { newBoard, remaining, reveal, unrevealed } from "../src/board";
import { applyGuesses, spymasterTurn, type Proposer, type TurnOptions } from "../src/game";
import type { Judge } from "../src/judge";
import { clueRejection } from "../src/legality";
import type { Board, CardKind, Judgment, Team, Thresholds } from "../src/types";

export type Mode = "spymaster" | "guesser";
export type Role = "agent" | "bystander" | "assassin";

export const TURN_LIMIT = 9;

export interface Meter {
  jevRequests: number;
  pairs: number;
  jevCostUsd: number;
  proposerCostUsd: number;
  jevMs: number;
  /** The comparison arm, when a chat model is asked the same question. */
  baselineRequests: number;
  baselineCostUsd: number;
  baselineMs: number;
}

export interface TurnView {
  n: number;
  clue: string;
  number: number;
  /** Words Jev meant, when Jev gave the clue; empty when the person did. */
  targets: string[];
  guesses: { word: string; role: Role; p: number | null }[];
  stop: "done" | "wrong" | "assassin" | "nothing" | "pass" | "open";
  /** Per-word probabilities, released once the turn is over. */
  heat: Record<string, { p: number; first: number }> | null;
  pipeline: { proposed: number; illegal: number; judged: number; pairs: number; ms: number; costUsd: number; judgeMs: number; judgeCostUsd: number; proposer: string } | null;
}

export interface Game {
  id: string;
  mode: Mode;
  seed: number;
  board: Board;
  team: Team;
  turns: TurnView[];
  /** Guesser mode: the clue in play and the judgment behind it. */
  open: { judgment: Judgment; number: number; targets: string[]; correct: number } | null;
  status: "playing" | "won" | "lost";
  reason: "" | "cleared" | "assassin" | "turn-limit";
  meter: Meter;
  createdAt: number;
  updatedAt: number;
}

export interface CardView {
  word: string;
  revealed: boolean;
  /** Present when the viewer may know it: the spymaster always, the guesser once revealed. */
  role?: Role;
}

export interface GameView {
  id: string;
  mode: Mode;
  seed: number;
  cards: CardView[];
  agentsLeft: number;
  turnsLeft: number;
  turns: TurnView[];
  status: Game["status"];
  reason: Game["reason"];
  meter: Meter;
  open: { clue: string; number: number; correct: number } | null;
}

export function roleOf(game: Game, kind: CardKind): Role {
  return kind === "assassin" ? "assassin" : kind === game.team ? "agent" : "bystander";
}

export function newGame(id: string, mode: Mode, seed: number): Game {
  const board = newBoard(seed, { coop: true });
  const now = Date.now();
  return {
    id, mode, seed, board, team: board.startingTeam, turns: [], open: null,
    status: "playing", reason: "",
    meter: { jevRequests: 0, pairs: 0, jevCostUsd: 0, proposerCostUsd: 0, jevMs: 0, baselineRequests: 0, baselineCostUsd: 0, baselineMs: 0 },
    createdAt: now, updatedAt: now,
  };
}

export function view(game: Game): GameView {
  const showAll = game.mode === "spymaster" || game.status !== "playing";
  return {
    id: game.id,
    mode: game.mode,
    seed: game.seed,
    cards: game.board.cards.map((c) => ({
      word: c.word,
      revealed: c.revealed,
      ...(showAll || c.revealed ? { role: roleOf(game, c.kind) } : {}),
    })),
    agentsLeft: remaining(game.board, game.team),
    turnsLeft: Math.max(0, TURN_LIMIT - game.turns.length),
    turns: game.turns,
    status: game.status,
    reason: game.reason,
    meter: game.meter,
    open: game.open ? { clue: game.open.judgment.clue, number: game.open.number, correct: game.open.correct } : null,
  };
}

function heatOf(judgment: Judgment): NonNullable<TurnView["heat"]> {
  return Object.fromEntries(judgment.words.map((w) => [w.word, { p: w.p, first: w.first }]));
}

function settle(game: Game, stop: "assassin" | "wrong" | "done" | "nothing" | "pass"): void {
  game.updatedAt = Date.now();
  if (stop === "assassin") { game.status = "lost"; game.reason = "assassin"; return; }
  if (remaining(game.board, game.team) === 0) { game.status = "won"; game.reason = "cleared"; return; }
  if (game.turns.length >= TURN_LIMIT) { game.status = "lost"; game.reason = "turn-limit"; }
}

function addJev(game: Game, judgments: readonly Judgment[], ms: number): void {
  game.meter.jevRequests += judgments.length;
  game.meter.pairs += judgments.reduce((n, j) => n + j.words.length, 0);
  game.meter.jevCostUsd += judgments.reduce((s, j) => s + j.costUsd, 0);
  game.meter.jevMs += ms;
}

export class GameError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function requirePlaying(game: Game, mode: Mode): void {
  if (game.status !== "playing") throw new GameError("the game is over");
  if (game.mode !== mode) throw new GameError(`not available in ${game.mode} mode`);
}

/** Spymaster mode, live preview: judge a clue against the board without committing to it. */
export async function preview(game: Game, clue: string, judge: Judge): Promise<{ judgment: Judgment; illegal: string | null }> {
  requirePlaying(game, "spymaster");
  const words = unrevealed(game.board).map((c) => c.word);
  const illegal = clueRejection(clue, words);
  if (illegal) return { judgment: { clue, words: [], model: "", inputTokens: 0, costUsd: 0, latencyMs: 0 }, illegal };
  const judgment = await judge.judge(clue, words);
  addJev(game, [judgment], judgment.latencyMs);
  return { judgment, illegal: null };
}

/** Spymaster mode, comparison arm: the same clue judged by a chat model. Never drives play. */
export async function previewBaseline(game: Game, clue: string, baseline: Judge): Promise<Judgment> {
  requirePlaying(game, "spymaster");
  const words = unrevealed(game.board).map((c) => c.word);
  const illegal = clueRejection(clue, words);
  if (illegal) throw new GameError(`illegal clue: ${illegal}`);
  const judgment = await baseline.judge(clue, words);
  game.meter.baselineRequests += 1;
  game.meter.baselineCostUsd += judgment.costUsd;
  game.meter.baselineMs += judgment.latencyMs;
  return judgment;
}

/** Spymaster mode: the person commits a clue and a number; Jev guesses. */
export async function giveClue(game: Game, clue: string, number: number, judge: Judge, thresholds: Thresholds): Promise<TurnView> {
  requirePlaying(game, "spymaster");
  const words = unrevealed(game.board).map((c) => c.word);
  const illegal = clueRejection(clue, words);
  if (illegal) throw new GameError(`illegal clue: ${illegal}`);
  if (!Number.isInteger(number) || number < 1 || number > 9) throw new GameError("the number must be 1 to 9");
  const judgment = await judge.judge(clue, words);
  addJev(game, [judgment], judgment.latencyMs);
  const outcome = applyGuesses(game.board, game.team, judgment, number, thresholds);
  game.board = outcome.board;
  const turn: TurnView = {
    n: game.turns.length + 1,
    clue, number, targets: [],
    guesses: outcome.guesses.map((g) => ({ word: g.word, role: roleOf(game, g.kind), p: g.p })),
    stop: outcome.stop,
    heat: heatOf(judgment),
    pipeline: null,
  };
  game.turns.push(turn);
  settle(game, outcome.stop);
  return turn;
}

/** Guesser mode: Jev gives a clue. The heat stays hidden until the person's turn ends. */
export async function askClue(
  game: Game,
  proposer: Proposer,
  judge: Judge,
  thresholds: Thresholds,
  candidates: number,
  onCandidate?: TurnOptions["onCandidate"],
): Promise<TurnView> {
  requirePlaying(game, "guesser");
  if (game.open) throw new GameError("finish guessing first");
  const turn = await spymasterTurn(game.board, game.team, proposer, judge, thresholds, { candidates, concurrency: 8, rounds: 2, onCandidate });
  const judgments = turn.candidates.map((c) => c.judgment);
  addJev(game, judgments, turn.judge.latencyMs);
  game.meter.proposerCostUsd += turn.proposer.costUsd;
  const pipeline: TurnView["pipeline"] = {
    proposed: turn.proposed.length, illegal: turn.illegal.length, judged: turn.judge.requests, pairs: turn.judge.pairs,
    ms: Math.round(turn.judge.latencyMs + turn.proposer.latencyMs), costUsd: turn.judge.costUsd + turn.proposer.costUsd,
    judgeMs: Math.round(turn.judge.latencyMs), judgeCostUsd: turn.judge.costUsd, proposer: turn.proposer.model,
  };
  if (!turn.chosen) {
    const passed: TurnView = { n: game.turns.length + 1, clue: "", number: 0, targets: [], guesses: [], stop: "pass", heat: null, pipeline };
    game.turns.push(passed);
    settle(game, "pass");
    return passed;
  }
  game.open = { judgment: turn.chosen.judgment, number: turn.chosen.number, targets: turn.chosen.targets, correct: 0 };
  const opened: TurnView = { n: game.turns.length + 1, clue: turn.chosen.clue, number: turn.chosen.number, targets: [], guesses: [], stop: "open", heat: null, pipeline };
  game.turns.push(opened);
  game.updatedAt = Date.now();
  return opened;
}

function closeOpenTurn(game: Game, stop: "done" | "wrong" | "assassin" | "pass"): TurnView {
  const open = game.open!;
  const turn = game.turns[game.turns.length - 1]!;
  turn.stop = stop;
  turn.targets = open.targets;
  turn.heat = heatOf(open.judgment);
  game.open = null;
  settle(game, stop);
  return turn;
}

/** Guesser mode: the person taps a card. */
export function guess(game: Game, word: string): TurnView {
  requirePlaying(game, "guesser");
  if (!game.open) throw new GameError("ask for a clue first");
  const card = game.board.cards.find((c) => c.word === word);
  if (!card) throw new GameError("no such card");
  if (card.revealed) throw new GameError("already revealed");
  game.board = reveal(game.board, word);
  const role = roleOf(game, card.kind);
  const p = game.open.judgment.words.find((w) => w.word === word)?.p ?? null;
  const turn = game.turns[game.turns.length - 1]!;
  turn.guesses.push({ word, role, p });
  if (role === "assassin") return closeOpenTurn(game, "assassin");
  if (role !== "agent") return closeOpenTurn(game, "wrong");
  game.open.correct += 1;
  if (game.open.correct >= game.open.number || remaining(game.board, game.team) === 0) return closeOpenTurn(game, "done");
  game.updatedAt = Date.now();
  return turn;
}

/** Guesser mode: stop guessing early. */
export function pass(game: Game): TurnView {
  requirePlaying(game, "guesser");
  if (!game.open) throw new GameError("nothing to pass");
  return closeOpenTurn(game, "pass");
}

