import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Judge } from "./judge";
import { GAME_NOTE } from "./questions";
import type { Judgment, WordJudgment } from "./types";

/**
 * The comparison arm: a chat model asked the same question as Jev, once per clue, returning a
 * probability for every board word in one structured response. One call rather than 25 keeps
 * the comparison fair on latency and cost. Temperature 0 so any run-to-run spread is the
 * model's own. Same note, same words, same definition of "connect".
 */
export const DEFAULT_BASELINE_MODEL = "claude-haiku-4-5";

const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1 / 1e6, output: 5 / 1e6 },
  "claude-sonnet-5": { input: 2 / 1e6, output: 10 / 1e6 },
  "claude-opus-5": { input: 5 / 1e6, output: 25 / 1e6 },
};

const Scores = z.object({
  scores: z.array(z.object({ word: z.string(), p: z.number() })).describe("One entry per board word, in board order"),
});

const SYSTEM = `${GAME_NOTE}

You will be given a clue and the words on the board. For every board word, give the probability, from 0 to 1, that a typical guesser would connect the clue to that word. Judge each word on its own; the probabilities do not need to sum to anything. Return one entry per board word and nothing else.`;

/** Pure: turn a model's score list into a Judgment, checking coverage and clamping to [0, 1]. */
export function judgmentFromScores(
  clue: string,
  words: readonly string[],
  scores: readonly { word: string; p: number }[],
  meta: { model: string; inputTokens: number; costUsd: number; latencyMs: number },
): Judgment {
  const byWord = new Map(scores.map((s) => [s.word.trim().toLowerCase(), s.p]));
  const missing = words.filter((w) => !byWord.has(w.toLowerCase()));
  if (missing.length > 0) throw new Error(`baseline left out ${missing.length} word(s): ${missing.slice(0, 3).join(", ")}`);
  const ps = words.map((w) => Math.min(1, Math.max(0, byWord.get(w.toLowerCase())!)));
  const total = ps.reduce((a, b) => a + b, 0);
  const judged: WordJudgment[] = words.map((w, i) => ({ word: w, p: ps[i]!, first: total > 0 ? ps[i]! / total : 1 / words.length }));
  return { clue, words: judged, ...meta };
}

export class ClaudeBaseline implements Judge {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    readonly model: string = DEFAULT_BASELINE_MODEL,
  ) {}

  async judge(clue: string, words: readonly string[]): Promise<Judgment> {
    const started = performance.now();
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(Scores) },
      messages: [{ role: "user", content: JSON.stringify({ clue: clue.toUpperCase(), board: words.map((w) => w.toUpperCase()) }) }],
    });
    const latencyMs = performance.now() - started;
    if (response.stop_reason === "refusal") throw new Error("the baseline model refused the request");
    if (!response.parsed_output) throw new Error(`the baseline returned no parseable scores (stop_reason ${response.stop_reason})`);
    const price = PRICES[this.model] ?? PRICES[DEFAULT_BASELINE_MODEL]!;
    const costUsd = response.usage.input_tokens * price.input + response.usage.output_tokens * price.output;
    return judgmentFromScores(clue, words, response.parsed_output.scores, { model: response.model, inputTokens: response.usage.input_tokens, costUsd, latencyMs });
  }
}
