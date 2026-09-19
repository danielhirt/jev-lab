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
  /** Clues already tried this turn; a second round must avoid them. */
  exclude?: string[];
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
  /** Proposal rounds before passing. A second round asks for different clues; the policy never loosens. */
  rounds?: number;
  /** Called with each candidate's evaluation as soon as Jev answers, in completion order. */
  onCandidate?: (evaluation: ClueEvaluation, progress: { judged: number; proposed: number; round: number }) => void;
}

export const DEFAULT_TURN_OPTIONS: TurnOptions = { candidates: 30, concurrency: 8, rounds: 2 };

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
  const key = keyFor(board, team);
  const seen = new Set<string>();
  const proposed: string[] = [];
  const illegal: SpymasterTurn["illegal"] = [];
  const candidates: ClueEvaluation[] = [];
  const proposerStats = { model: "", costUsd: 0, latencyMs: 0 };
  let judgeMs = 0;
  let chosen: ClueEvaluation | null = null;

  for (let round = 0; round < (options.rounds ?? 1) && !chosen; round++) {
    const batch = await proposer.propose({ ...key, count: options.candidates, ...(round > 0 ? { exclude: [...seen] } : {}) });
    proposerStats.model = batch.model;
    proposerStats.costUsd += batch.costUsd;
    proposerStats.latencyMs += batch.latencyMs;
    proposed.push(...batch.clues);

    const legal: string[] = [];
    for (const raw of batch.clues) {
      const clue = normalize(raw);
      if (!clue || seen.has(clue)) continue;
      seen.add(clue);
      const reason = clueRejection(clue, visible);
      if (reason) illegal.push({ clue, reason });
      else legal.push(clue);
    }

    const started = performance.now();
    let judged = 0;
    const evaluations = await mapLimit(legal, options.concurrency, async (clue) => {
      const evaluation = evaluateClue(await judge.judge(clue, visible), board, team, thresholds);
      judged += 1;
      options.onCandidate?.(evaluation, { judged, proposed: proposed.length, round });
      return evaluation;
    });
    judgeMs += performance.now() - started;
    candidates.push(...evaluations);
    chosen = pickClue(candidates);
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    team,
    proposed,
    illegal,
    candidates,
    chosen,
    proposer: proposerStats,
    judge: {
      requests: candidates.length,
      pairs: candidates.reduce((n, c) => n + c.judgment.words.length, 0),
      costUsd: candidates.reduce((s, c) => s + c.judgment.costUsd, 0),
      latencyMs: judgeMs,
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
