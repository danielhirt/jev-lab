import type { Answers, Questions, Sample } from "./types";

export function mean(xs: number[]): number {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
export function std(xs: number[]): number {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}
export function median(xs: number[]): number {
  const v = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** The label a decision rule would act on, per answer type. */
export function decisionLabel(a: Answers[string], noulThreshold = 0.5): string {
  if (a.type === "noul") return Number.isFinite(a.noul) ? (a.noul >= noulThreshold ? "yes" : "no") : "n/a";
  if (a.type === "choice") return a.choice;
  // score: argmax level
  let best = "";
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(a.probabilities)) if (v > bestV) ((bestV = v), (best = k));
  return best;
}

/** The headline scalar for an answer: P(yes), P(chosen option), or expected score. */
export function headline(a: Answers[string]): number {
  if (a.type === "noul") return a.noul;
  if (a.type === "choice") return a.probabilities[a.choice] ?? NaN;
  return a.score;
}

export type QuestionStability = {
  id: string;
  type: string;
  n: number;
  /** Plurality decision label and how often it appeared. */
  plurality: string;
  agreement: number;
  /** Distinct decision labels seen. */
  labels: Record<string, number>;
  /** Headline scalar: mean, std, min, max. */
  mean: number;
  std: number;
  min: number;
  max: number;
  /** Mean per-option std across the full probability vector (choice/score). */
  probStd: number;
};

export function stability(questions: Questions, samples: Sample[]): QuestionStability[] {
  const ok = samples.filter((s) => !s.error);
  return Object.keys(questions).map((id) => {
    const answers = ok.map((s) => s.answers[id]).filter(Boolean);
    const labels: Record<string, number> = {};
    for (const a of answers) {
      const l = decisionLabel(a);
      labels[l] = (labels[l] ?? 0) + 1;
    }
    const [plurality, count] = Object.entries(labels).sort((a, b) => b[1] - a[1])[0] ?? ["n/a", 0];
    const scalars = answers.map(headline);
    let probStd = 0;
    const first = answers[0];
    if (first && first.type !== "noul") {
      const keys = Object.keys(first.probabilities);
      probStd = mean(
        keys.map((k) =>
          std(answers.map((a) => (a.type === "noul" ? NaN : (a.probabilities[k] ?? 0)))),
        ),
      );
    } else {
      probStd = std(scalars);
    }
    return {
      id,
      type: first?.type ?? questions[id]!.type,
      n: answers.length,
      plurality,
      agreement: answers.length ? count / answers.length : 0,
      labels,
      mean: mean(scalars),
      std: std(scalars),
      min: Math.min(...scalars.filter(Number.isFinite)),
      max: Math.max(...scalars.filter(Number.isFinite)),
      probStd,
    };
  });
}

export type Summary = {
  source: string;
  n: number;
  errors: number;
  meanStd: number;
  meanProbStd: number;
  meanAgreement: number;
  questionsWithFlips: number;
  totalQuestions: number;
  latencyMedianMs: number;
  latencyP90Ms: number;
  costTotalUsd: number;
  costPerCallUsd: number;
};

export function summarize(source: string, questions: Questions, samples: Sample[]): Summary {
  const st = stability(questions, samples);
  const lat = samples.filter((s) => !s.error).map((s) => s.latencyMs).sort((a, b) => a - b);
  const cost = samples.reduce((a, s) => a + s.costUsd, 0);
  return {
    source,
    n: samples.length,
    errors: samples.filter((s) => s.error).length,
    meanStd: mean(st.map((q) => q.std)),
    meanProbStd: mean(st.map((q) => q.probStd)),
    meanAgreement: mean(st.map((q) => q.agreement)),
    questionsWithFlips: st.filter((q) => Object.keys(q.labels).length > 1).length,
    totalQuestions: st.length,
    latencyMedianMs: median(lat),
    latencyP90Ms: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.9))] ?? NaN,
    costTotalUsd: cost,
    costPerCallUsd: samples.length ? cost / samples.length : 0,
  };
}
