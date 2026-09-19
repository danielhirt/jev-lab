import { reveal, remaining, unrevealed } from "./board";
import { clueRejection, normalize } from "./legality";
import type { Judge } from "./judge";
import { evaluateClue, guessOrder, pickClue } from "./scorer";
import type { Board, CardKind, ClueEvaluation, Judgment, Team, Thresholds } from "./types";
import { mapLimit } from "./util";

/** What the clue-proposing model sees: the spymaster's key for the words still in play. */
export interface ProposeInput {
  friendly: string[];
  opponent: string[];
  neutral: string[];
  assassin: string;
  count: number;
}

export interface ProposeResult {
  clues: string[];
  model: string;
  costUsd: number;
  latencyMs: number;
}

export interface Proposer {
  propose(input: ProposeInput): Promise<ProposeResult>;
}

export interface SpymasterTurn {
  team: Team;
  proposed: string[];
  illegal: { clue: string; reason: string }[];
  candidates: ClueEvaluation[];
  chosen: ClueEvaluation | null;
  proposer: { model: string; costUsd: number; latencyMs: number };
  judge: { requests: number; pairs: number; costUsd: number; latencyMs: number };
}

export interface TurnOptions {
  candidates: number;
  concurrency: number;
}

export const DEFAULT_TURN_OPTIONS: TurnOptions = { candidates: 30, concurrency: 8 };

export function other(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

export function keyFor(board: Board, team: Team): Omit<ProposeInput, "count"> {
  const live = unrevealed(board);
  const of = (kind: CardKind) => live.filter((c) => c.kind === kind).map((c) => c.word);
  const assassin = of("assassin")[0];
  if (!assassin) throw new Error("the assassin has already been revealed");
  return { friendly: of(team), opponent: of(other(team)), neutral: of("neutral"), assassin };
}

/**
 * One spymaster turn: the proposer brainstorms clue words, code drops the illegal ones,
 * Jev judges each legal candidate against every word still on the board, code picks.
 */
export async function spymasterTurn(
  board: Board,
  team: Team,
  proposer: Proposer,
  judge: Judge,
  thresholds: Thresholds,
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
): Promise<SpymasterTurn> {
  const visible = unrevealed(board).map((c) => c.word);
  const proposed = await proposer.propose({ ...keyFor(board, team), count: options.candidates });

  const seen = new Set<string>();
  const legal: string[] = [];
  const illegal: SpymasterTurn["illegal"] = [];
  for (const raw of proposed.clues) {
    const clue = normalize(raw);
    if (!clue || seen.has(clue)) continue;
    seen.add(clue);
    const reason = clueRejection(clue, visible);
    if (reason) illegal.push({ clue, reason });
    else legal.push(clue);
  }

  const started = performance.now();
  const judgments = await mapLimit(legal, options.concurrency, (clue) => judge.judge(clue, visible));
  const latencyMs = performance.now() - started;
  const candidates = judgments
    .map((j) => evaluateClue(j, board, team, thresholds))
    .sort((a, b) => b.score - a.score);

  return {
    team,
    proposed: proposed.clues,
    illegal,
    candidates,
    chosen: pickClue(candidates),
    proposer: { model: proposed.model, costUsd: proposed.costUsd, latencyMs: proposed.latencyMs },
    judge: {
      requests: judgments.length,
      pairs: judgments.reduce((n, j) => n + j.words.length, 0),
      costUsd: judgments.reduce((s, j) => s + j.costUsd, 0),
      latencyMs,
    },
  };
}

export interface Guess {
  word: string;
  kind: CardKind;
  p: number;
}

export interface GuessOutcome {
  guesses: Guess[];
  board: Board;
  /** Why the guessing stopped. */
  stop: "done" | "wrong" | "assassin" | "nothing";
}

/**
 * Apply a guess sequence to the board: guess in Jev's order, stop on the first word that is
 * not the guessing team's, and stop after `number` correct guesses.
 */
export function applyGuesses(board: Board, team: Team, judgment: Judgment, number: number, thresholds: Thresholds): GuessOutcome {
  const order = guessOrder(judgment, thresholds, number);
  const kindOf = new Map(board.cards.map((c) => [c.word, c.kind]));
  const guesses: Guess[] = [];
  let current = board;
  if (order.length === 0) return { guesses, board, stop: "nothing" };
  for (const w of order) {
    const kind = kindOf.get(w.word)!;
    guesses.push({ word: w.word, kind, p: w.p });
    current = reveal(current, w.word);
    if (kind === "assassin") return { guesses, board: current, stop: "assassin" };
    if (kind !== team) return { guesses, board: current, stop: "wrong" };
  }
  return { guesses, board: current, stop: "done" };
}

export interface TurnRecord {
  team: Team;
  clue: string | null;
  number: number;
  targets: string[];
  guesses: Guess[];
  stop: GuessOutcome["stop"] | "pass";
  candidatesJudged: number;
  illegal: number;
  costUsd: number;
}

export interface GameLog {
  seed: number;
  startingTeam: Team;
  turns: TurnRecord[];
  winner: Team | null;
  reason: "cleared" | "assassin" | "stalemate" | "turn-limit";
  totals: { jevRequests: number; pairs: number; jevCostUsd: number; proposerCostUsd: number; wallMs: number };
  board: Board;
}

/**
 * Self-play: both teams use the proposer for candidates and Jev as spymaster judge and guesser.
 * In self-play the guesser reads the same judgment the spymaster chose on, so the interesting
 * output is the decision log, not the win rate.
 */
export async function playGame(
  board: Board,
  proposer: Proposer,
  judge: Judge,
  thresholds: Thresholds,
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
  maxTurns = 30,
): Promise<GameLog> {
  const started = performance.now();
  const totals = { jevRequests: 0, pairs: 0, jevCostUsd: 0, proposerCostUsd: 0, wallMs: 0 };
  const turns: TurnRecord[] = [];
  let team = board.startingTeam;
  let winner: Team | null = null;
  let reason: GameLog["reason"] = "turn-limit";
  let passesInARow = 0;

  while (turns.length < maxTurns) {
    const turn = await spymasterTurn(board, team, proposer, judge, thresholds, options);
    totals.jevRequests += turn.judge.requests;
    totals.pairs += turn.judge.pairs;
    totals.jevCostUsd += turn.judge.costUsd;
    totals.proposerCostUsd += turn.proposer.costUsd;

    if (!turn.chosen) {
      turns.push({ team, clue: null, number: 0, targets: [], guesses: [], stop: "pass", candidatesJudged: turn.judge.requests, illegal: turn.illegal.length, costUsd: turn.judge.costUsd + turn.proposer.costUsd });
      // Both sides passing on an unchanged board means nothing will change; stop instead of burning turns.
      if (++passesInARow >= 2) { reason = "stalemate"; break; }
      team = other(team);
      continue;
    }
    passesInARow = 0;

    const outcome = applyGuesses(board, team, turn.chosen.judgment, turn.chosen.number, thresholds);
    board = outcome.board;
    turns.push({
      team,
      clue: turn.chosen.clue,
      number: turn.chosen.number,
      targets: turn.chosen.targets,
      guesses: outcome.guesses,
      stop: outcome.stop,
      candidatesJudged: turn.judge.requests,
      illegal: turn.illegal.length,
      costUsd: turn.judge.costUsd + turn.proposer.costUsd,
    });

    if (outcome.stop === "assassin") { winner = other(team); reason = "assassin"; break; }
    if (remaining(board, team) === 0) { winner = team; reason = "cleared"; break; }
    if (remaining(board, other(team)) === 0) { winner = other(team); reason = "cleared"; break; }
    team = other(team);
  }

  totals.wallMs = performance.now() - started;
  return { seed: board.seed, startingTeam: board.startingTeam, turns, winner, reason, totals, board };
}
