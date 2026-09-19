import { TypeSafeClient } from "@typesafe-ai/sdk";
import { judgeQuestions, judgeState, type QuestionStyle } from "./questions";
import type { Judgment, WordJudgment } from "./types";

/** jev-1.13 list price: $0.042 per million input tokens, output free. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const DEFAULT_MODEL = "jev-latest";

export interface Judge {
  judge(clue: string, words: readonly string[]): Promise<Judgment>;
}

export class TypeSafeJudge implements Judge {
  constructor(
    private readonly client: TypeSafeClient = new TypeSafeClient(),
    private readonly model: string = DEFAULT_MODEL,
    private readonly style: QuestionStyle = "full",
  ) {}

  async judge(clue: string, words: readonly string[]): Promise<Judgment> {
    const started = performance.now();
    const result = await this.client.systemOne({
      model: this.model,
      state: judgeState(clue, words),
      questions: judgeQuestions(clue, words, this.style),
    });
    const latencyMs = performance.now() - started;
    const first = result.answers["first"];
    if (!first || first.type !== "choice") throw new Error("expected a choice answer for `first`");
    const judged: WordJudgment[] = words.map((raw) => {
      const word = raw.toUpperCase();
      const answer = result.answers[word];
      if (!answer || answer.type !== "noul") throw new Error(`missing noul for ${word}`);
      return { word: raw, p: answer.noul, first: first.probabilities[word] ?? 0 };
    });
    return {
      clue,
      words: judged,
      model: result.model,
      inputTokens: result.usage.input_tokens,
      costUsd: result.usage.input_tokens * JEV_USD_PER_INPUT_TOKEN,
      latencyMs,
    };
  }
}

/** Replays judgments from a JSON file so evals and demos rerun without spend. Misses go live. */
export class CachingJudge implements Judge {
  private cache: Record<string, Judgment> = {};
  private loaded = false;

  constructor(
    private readonly inner: Judge,
    private readonly path: string,
  ) {}

  private key(clue: string, words: readonly string[]): string {
    return JSON.stringify([clue.toLowerCase(), words.map((w) => w.toLowerCase())]);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const file = Bun.file(this.path);
    if (await file.exists()) this.cache = (await file.json()) as Record<string, Judgment>;
  }

  async judge(clue: string, words: readonly string[]): Promise<Judgment> {
    await this.load();
    const key = this.key(clue, words);
    const hit = this.cache[key];
    if (hit) return { ...hit, latencyMs: 0, costUsd: 0 };
    const fresh = await this.inner.judge(clue, words);
    this.cache[key] = fresh;
    await Bun.write(this.path, JSON.stringify(this.cache));
    return fresh;
  }
}
