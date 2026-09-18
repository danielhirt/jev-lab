// Request/response types for OpenRouter's Decisions endpoint (TypeSafe Jev).
// Mirrors the OpenAPI schemas DecisionsRequest / DecisionsResponse.

export type Entry = string | Record<string, unknown> | unknown[] | null;

export type NoulQuestion = {
  type: "noul";
  instructions: Entry;
  criteria?: { true: Entry; false: Entry };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: Entry;
  criteria: Record<string, Entry>;
};
export type ScoreQuestion = {
  type: "score";
  instructions: Entry;
  criteria: Entry[];
};
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export type State = string | Record<string, unknown> | unknown[];

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

export type DecisionsResponse = {
  id?: string;
  model: string;
  provider?: string;
  answers: Answers;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
};

/** One observed call, normalized so Jev and LLM baselines share a shape. */
export type Sample = {
  source: string; // model id that answered
  answers: Answers;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

export type Scenario = {
  name: string;
  description: string;
  state: State;
  questions: Questions;
  /** Semantically equivalent rewrites of `state`, keyed by a short label. */
  perturbations?: Record<string, State>;
};
