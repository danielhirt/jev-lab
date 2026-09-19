import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CLUE_WORDS } from "./cluewords";
import type { ProposeInput, ProposeResult, Proposer } from "./game";
import { mulberry32, shuffle } from "./rng";

/**
 * The generative half of the split. Claude sees the spymaster's key and brainstorms candidate
 * clue words; it never sees Jev's numbers and never picks. Legality, judging, and the choice
 * stay in code, so a weak or repetitive proposal costs a turn's quality, never a rule.
 */
export const DEFAULT_PROPOSER_MODEL = "claude-opus-5";

/** List prices, USD per token, for the models this proposer is likely to run on. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5 / 1e6, output: 25 / 1e6 },
  "claude-sonnet-5": { input: 2 / 1e6, output: 10 / 1e6 },
  "claude-haiku-4-5": { input: 1 / 1e6, output: 5 / 1e6 },
};

const Proposal = z.object({
  clues: z.array(z.string()).describe("Candidate one-word clues, strongest first"),
});

const SYSTEM = `You brainstorm clues for a Codenames spymaster. You will be given the words still on the board, split into the words your team must find, the opponent's words, the neutral bystanders, and the one assassin word.

Propose candidate clues only. Another system scores every candidate against every board word and decides; your job is breadth and quality of ideas, not the final pick.

A clue is a single English word. It may not be a word on the board, contain one, or be a form of one. Prefer clues that reach two or more of your team's words through an everyday association a typical adult would see at once. Include some safer one-word clues as well. Never propose a clue that a guesser might connect to the assassin. Return the list only.`;

export class ClaudeProposer implements Proposer {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model: string = DEFAULT_PROPOSER_MODEL,
  ) {}

  async propose(input: ProposeInput): Promise<ProposeResult> {
    const started = performance.now();
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(Proposal) },
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              your_words: input.friendly,
              opponent_words: input.opponent,
              neutral_words: input.neutral,
              assassin: input.assassin,
              how_many_candidates: input.count,
              ...(input.exclude?.length ? { do_not_propose: input.exclude } : {}),
            },
            null,
            2,
          ),
        },
      ],
    });
    const latencyMs = performance.now() - started;
    if (response.stop_reason === "refusal") throw new Error("the proposer refused the request");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error(`the proposer returned no parseable list (stop_reason ${response.stop_reason})`);
    const price = PRICES[this.model] ?? PRICES[DEFAULT_PROPOSER_MODEL]!;
    return {
      clues: parsed.clues,
      model: response.model,
      costUsd: response.usage.input_tokens * price.input + response.usage.output_tokens * price.output,
      latencyMs,
    };
  }
}

/** A fixed list, for tests and for playing without an Anthropic key. */
export class ListProposer implements Proposer {
  constructor(private readonly clues: readonly string[]) {}
  async propose(): Promise<ProposeResult> {
    return { clues: [...this.clues], model: "list", costUsd: 0, latencyMs: 0 };
  }
}

/**
 * No-LLM fallback: sample concept words from a fixed list, seeded by the board so a replay
 * proposes the same candidates. Lower quality than a model that sees the key, which is the
 * point of the comparison, and enough to run the demo without an Anthropic key.
 */
export class WordlistProposer implements Proposer {
  constructor(private readonly words: readonly string[] = CLUE_WORDS) {}
  async propose(input: ProposeInput): Promise<ProposeResult> {
    const seed = [...input.friendly, ...input.opponent].join("|");
    let h = 2166136261;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rand = mulberry32(h);
    const exclude = new Set((input.exclude ?? []).map((w) => w.toLowerCase()));
    return { clues: shuffle(this.words, rand).filter((w) => !exclude.has(w)).slice(0, input.count), model: "wordlist", costUsd: 0, latencyMs: 0 };
  }
}
