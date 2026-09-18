import type { Answers } from "./types";
import type { QuestionStability, Summary } from "./stats";

export function table(header: string[], rows: (string | number)[][]): string {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(cells[0]!), widths.map((w) => "-".repeat(w)).join("  "), ...cells.slice(1).map(line)].join("\n");
}

export const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
export const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
export const f4 = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : "n/a");
export const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
export const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(6)}` : "n/a");

export function formatAnswers(answers: Answers): string {
  const rows: (string | number)[][] = [];
  for (const [id, a] of Object.entries(answers)) {
    if (a.type === "noul") {
      rows.push([id, "noul", f2(a.noul), "", ""]);
    } else if (a.type === "choice") {
      const dist = Object.entries(a.probabilities)
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `${k}=${f2(v)}`)
        .join(" ");
      rows.push([id, "choice", a.choice, f2(a.confidence), dist]);
    } else {
      const dist = Object.entries(a.probabilities)
        .map(([k, v]) => `L${k}=${f2(v)}`)
        .join(" ");
      rows.push([id, "score", f2(a.score), f2(a.confidence), dist]);
    }
  }
  return table(["question", "type", "answer", "conf", "distribution"], rows);
}

export function formatStability(st: QuestionStability[]): string {
  return table(
    ["question", "type", "plurality", "agree", "mean", "std", "min", "max", "probStd", "labels seen"],
    st.map((q) => [
      q.id,
      q.type,
      q.plurality,
      pct(q.agreement),
      f3(q.mean),
      f4(q.std),
      f3(q.min),
      f3(q.max),
      f4(q.probStd),
      Object.entries(q.labels)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`)
        .join(" "),
    ]),
  );
}

export function formatSummaries(sums: Summary[]): string {
  return table(
    ["condition", "n", "err", "mean std", "prob std", "agree", "flipped Qs", "p50 ms", "p90 ms", "$/call", "$ total"],
    sums.map((s) => [
      s.source,
      s.n,
      s.errors,
      f4(s.meanStd),
      f4(s.meanProbStd),
      pct(s.meanAgreement),
      `${s.questionsWithFlips}/${s.totalQuestions}`,
      Math.round(s.latencyMedianMs),
      Math.round(s.latencyP90Ms),
      usd(s.costPerCallUsd),
      usd(s.costTotalUsd),
    ]),
  );
}
