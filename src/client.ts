import type {
  Answers,
  DecisionsResponse,
  Entry,
  Questions,
  Sample,
  State,
} from "./types";

const OPENROUTER = "https://openrouter.ai/api";
export const JEV_MODEL = "~typesafe/jev-latest";
export const BASELINE_MODEL = "anthropic/claude-haiku-4.5";
// $/M tokens (input, output). Jev pricing from the OpenRouter model page.
const PRICES: Record<string, [number, number]> = {
  [JEV_MODEL]: [0.042, 0],
  [BASELINE_MODEL]: [1.0, 5.0],
};

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    "X-Title": "jev-lab",
  };
}

async function postJson<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${OPENROUTER}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 4) {
    await Bun.sleep(500 * 2 ** attempt);
    return postJson<T>(path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** OpenRouter's Decisions adapter validates instructions/criteria as strings only
 *  (TypeSafe's native API also accepts JSON structure). Flatten anything structured. */
function flat(e: Entry): string {
  return typeof e === "string" ? e : JSON.stringify(e);
}
export function flattenQuestions(questions: Questions): Questions {
  const out: Questions = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      out[id] = {
        type: "noul",
        instructions: flat(q.instructions),
        ...(q.criteria ? { criteria: { true: flat(q.criteria.true), false: flat(q.criteria.false) } } : {}),
      };
    } else if (q.type === "choice") {
      out[id] = {
        type: "choice",
        instructions: flat(q.instructions),
        criteria: Object.fromEntries(Object.entries(q.criteria).map(([k, v]) => [k, flat(v)])),
      };
    } else {
      out[id] = { type: "score", instructions: flat(q.instructions), criteria: q.criteria.map(flat) };
    }
  }
  return out;
}

/** One call to Jev through OpenRouter's Decisions router. */
export async function askJev(state: State, questions: Questions): Promise<Sample> {
  const started = performance.now();
  const res = await postJson<DecisionsResponse>("/alpha/decisions", {
    model: JEV_MODEL,
    state,
    questions: flattenQuestions(questions),
  });
  const latencyMs = performance.now() - started;
  const [pin, pout] = PRICES[JEV_MODEL]!;
  return {
    source: res.model,
    answers: res.answers,
    latencyMs,
    costUsd:
      res.usage.cost ??
      (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1e6,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Baseline: an ordinary chat LLM asked for the same structured answers as JSON.
// Mirrors TypeSafe's own consistency cookbooks (temperature 0, probabilities).

function describeQuestions(questions: Questions): string {
  const lines: string[] = [];
  for (const [id, q] of Object.entries(questions)) {
    const instr =
      typeof q.instructions === "string"
        ? q.instructions
        : JSON.stringify(q.instructions);
    if (q.type === "noul") {
      const c = q.criteria
        ? ` (yes means: ${JSON.stringify(q.criteria.true)}; no means: ${JSON.stringify(q.criteria.false)})`
        : "";
      lines.push(`- ${id} [yes/no]: ${instr}${c}\n  Answer: {"noul": <probability that the answer is yes, 0.00-1.00>}`);
    } else if (q.type === "choice") {
      const opts = Object.entries(q.criteria)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("; ");
      lines.push(`- ${id} [choice]: ${instr}\n  Options: ${opts}\n  Answer: {"probabilities": {<option>: <probability>, ...}} covering every option, summing to 1`);
    } else {
      const levels = q.criteria
        .map((l, i) => `${i}: ${typeof l === "string" ? l : JSON.stringify(l)}`)
        .join("; ");
      lines.push(`- ${id} [score]: ${instr}\n  Ordered levels: ${levels}\n  Answer: {"probabilities": {<level index as string>: <probability>, ...}} covering every level, summing to 1`);
    }
  }
  return lines.join("\n");
}

function stripFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.includes("\n") ? s.slice(s.indexOf("\n") + 1) : "";
    if (s.trimEnd().endsWith("```")) s = s.trimEnd().slice(0, -3);
  }
  return s;
}

function argmax(p: Record<string, number>): string {
  let best = "";
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(p)) if (v > bestV) ((bestV = v), (best = k));
  return best;
}

/** Same confidence statistic shape as TypeSafe: 1 - normalized entropy. */
export function confidenceOf(p: Record<string, number>): number {
  const vals = Object.values(p).filter((v) => v > 0);
  const n = Object.keys(p).length;
  if (n <= 1) return 1;
  const h = -vals.reduce((a, v) => a + v * Math.log(v), 0);
  return Math.max(0, Math.min(1, 1 - h / Math.log(n)));
}

/** Normalize a raw LLM JSON reply into the Decisions answer shape. */
function normalize(raw: Record<string, unknown>, questions: Questions): Answers {
  const out: Answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const r = (raw[id] ?? {}) as Record<string, unknown>;
    if (q.type === "noul") {
      const v = Number(r.noul);
      out[id] = { type: "noul", noul: Number.isFinite(v) ? v : NaN };
    } else if (q.type === "choice") {
      const probs: Record<string, number> = {};
      const rp = (r.probabilities ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(q.criteria)) probs[k] = Number(rp[k] ?? 0) || 0;
      const sum = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
      for (const k of Object.keys(probs)) probs[k] = probs[k]! / sum;
      out[id] = { type: "choice", choice: argmax(probs), probabilities: probs, confidence: confidenceOf(probs) };
    } else {
      const probs: Record<string, number> = {};
      const legend: Record<string, string> = {};
      const rp = (r.probabilities ?? {}) as Record<string, unknown>;
      q.criteria.forEach((l, i) => {
        probs[String(i)] = Number(rp[String(i)] ?? 0) || 0;
        legend[String(i)] = typeof l === "string" ? l : JSON.stringify(l);
      });
      const sum = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
      let score = 0;
      for (const k of Object.keys(probs)) {
        probs[k] = probs[k]! / sum;
        score += Number(k) * probs[k]!;
      }
      out[id] = { type: "score", score, legend, probabilities: probs, confidence: confidenceOf(probs) };
    }
  }
  return out;
}

type ChatResponse = {
  model: string;
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number; cost?: number };
};

/** One call to a chat LLM at temperature 0, asking for the same answers as JSON. */
export async function askBaseline(
  state: State,
  questions: Questions,
  model = BASELINE_MODEL,
): Promise<Sample> {
  const stateText = typeof state === "string" ? state : JSON.stringify(state, null, 2);
  const prompt =
    `State to evaluate:\n${stateText}\n\nQuestions:\n${describeQuestions(questions)}\n\n` +
    `Respond with ONLY a JSON object mapping each question id to its answer object, exactly as specified. No prose, no code fence.`;
  const started = performance.now();
  const res = await postJson<ChatResponse>("/v1/chat/completions", {
    model,
    temperature: 0,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const latencyMs = performance.now() - started;
  const text = res.choices[0]?.message.content ?? "";
  let raw: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    const parsed = JSON.parse(stripFence(text));
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    error = `unparseable reply: ${text.slice(0, 120)}`;
  }
  const [pin, pout] = PRICES[model] ?? [0, 0];
  return {
    source: res.model,
    answers: normalize(raw, questions),
    latencyMs,
    costUsd:
      res.usage.cost ??
      (res.usage.prompt_tokens * pin + res.usage.completion_tokens * pout) / 1e6,
    inputTokens: res.usage.prompt_tokens,
    outputTokens: res.usage.completion_tokens,
    error,
  };
}

/** Run `n` tasks with bounded concurrency, preserving order. */
export async function pool<T>(n: number, limit: number, task: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(n);
  let next = 0;
  async function worker() {
    while (next < n) {
      const i = next++;
      results[i] = await task(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
  return results;
}
