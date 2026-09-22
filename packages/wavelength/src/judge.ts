import { TypeSafeClient } from "@typesafe-ai/sdk";
import { scoreQuestions, scoreState } from "./questions";
import { gradeClue } from "./score";
import { LEVELS, type LiveScore, type Spectrum } from "./types";

/** jev-1.13 list price: $0.042 per million input tokens, output free. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const DEFAULT_MODEL = "jev-latest";

export class TypeSafeJudge {
  constructor(
    private readonly client: TypeSafeClient = new TypeSafeClient(),
    readonly model: string = process.env.JEV_MODEL ?? DEFAULT_MODEL,
  ) {}

  /**
   * One request, one Score per clue. `target` is applied after the response
   * and is not part of the state or the questions.
   */
  async score(spectrum: Spectrum, clues: readonly string[], target: number): Promise<LiveScore> {
    const started = performance.now();
    const result = await this.client.systemOne({
      model: this.model,
      state: scoreState(spectrum, clues),
      questions: scoreQuestions(spectrum, clues),
    });
    const latencyMs = performance.now() - started;
    const scored = clues.map((clue, i) => {
      const answer = result.answers[`c${i}`];
      if (!answer || answer.type !== "score") throw new Error(`missing score for clue ${i + 1}`);
      const probabilities = Array.from({ length: LEVELS }, (_, level) => {
        const table = answer.probabilities as Record<string, number>;
        const p = table[String(level)];
        if (typeof p !== "number") throw new Error(`missing probability for level ${level} on clue ${i + 1}`);
        return p;
      });
      return gradeClue(clue, target, answer.score, answer.confidence, probabilities);
    });
    return {
      clues: scored,
      model: result.model,
      inputTokens: result.usage.input_tokens,
      costUsd: result.usage.input_tokens * JEV_USD_PER_INPUT_TOKEN,
      latencyMs,
    };
  }
}
