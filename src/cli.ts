#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { askBaseline, askJev, BASELINE_MODEL, JEV_MODEL, pool } from "./client";
import { f2, formatAnswers, formatStability, formatSummaries, pct, table, usd } from "./format";
import { SCENARIOS, withNonce } from "./scenarios";
import { decisionLabel, headline, stability, summarize } from "./stats";
import type { Answers, Sample, Scenario } from "./types";

const HELP = `jev-lab: poke at TypeSafe Jev's determinism claims through OpenRouter.

usage: bun run lab <command> [scenario] [options]

commands
  list                          list scenarios
  probe    <scenario>           one call, print answers + distributions
  ask      <file.json> [-n N]   your own {state, questions} JSON; N calls, prints answers + stability (default n=1)
  repeat   <scenario> [-n N]    N identical calls; per-question stability (default n=20)
           [--nonce]            add a throwaway field per call so no two requests are byte-identical
  perturb  <scenario> [-n N]    baseline vs semantically-equivalent rewrites of the state (default n=5 each)
  compare  <scenario> [-n N]    Jev vs ${BASELINE_MODEL} at temperature 0, same questions (default n=10)
  route    <scenario>           run the docs' confidence-gated triage rule over N calls (triage only)

options
  -n, --samples N   repeats per condition
  -c, --concurrency N   parallel requests (default 8)
  --nonce           (repeat) vary a throwaway field per call
  --save            write raw samples to runs/<cmd>-<scenario>-<ts>.json (default on)
`;

function pickScenario(name: string | undefined): Scenario {
  if (!name || !SCENARIOS[name]) {
    console.error(`unknown scenario "${name ?? ""}". known: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }
  return SCENARIOS[name]!;
}

async function saveRun(kind: string, scenario: string, payload: unknown) {
  await mkdir("runs", { recursive: true });
  const file = `runs/${kind}-${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await Bun.write(file, JSON.stringify(payload, null, 2));
  console.log(`\nsaved ${file}`);
}

async function runJev(s: Scenario, n: number, conc: number, nonce: boolean, label = "jev"): Promise<Sample[]> {
  let done = 0;
  const out = await pool(n, conc, async (i) => {
    const state = nonce ? withNonce(s.state, `${i}:${crypto.randomUUID().slice(0, 8)}`) : s.state;
    try {
      return await askJev(state, s.questions);
    } catch (e) {
      return { source: JEV_MODEL, answers: {}, latencyMs: NaN, costUsd: 0, inputTokens: 0, outputTokens: 0, error: String(e) };
    } finally {
      process.stderr.write(`\r${label}: ${++done}/${n}`);
    }
  });
  process.stderr.write("\n");
  return out;
}

async function runBaseline(s: Scenario, n: number, conc: number, nonce: boolean): Promise<Sample[]> {
  let done = 0;
  const out = await pool(n, conc, async (i) => {
    const state = nonce ? withNonce(s.state, `${i}:${crypto.randomUUID().slice(0, 8)}`) : s.state;
    try {
      return await askBaseline(state, s.questions);
    } catch (e) {
      return { source: BASELINE_MODEL, answers: {}, latencyMs: NaN, costUsd: 0, inputTokens: 0, outputTokens: 0, error: String(e) };
    } finally {
      process.stderr.write(`\rbaseline: ${++done}/${n}`);
    }
  });
  process.stderr.write("\n");
  return out;
}

// ---------------------------------------------------------------------------

async function cmdProbe(s: Scenario) {
  const r = await askJev(s.state, s.questions);
  console.log(`${s.name}: ${s.description}\nmodel=${r.source}  latency=${Math.round(r.latencyMs)}ms  tokens=${r.inputTokens}/${r.outputTokens}  cost=${usd(r.costUsd)}\n`);
  console.log(formatAnswers(r.answers));
}

async function cmdAsk(file: string, n: number, conc: number) {
  const raw = (await Bun.file(file).json()) as { state: Scenario["state"]; questions: Scenario["questions"] };
  const s: Scenario = { name: file, description: "ad-hoc", state: raw.state, questions: raw.questions };
  if (n <= 1) return cmdProbe(s);
  const samples = await runJev(s, n, conc, true);
  const first = samples.find((x) => !x.error);
  if (first) console.log(formatAnswers(first.answers), "\n");
  console.log(formatStability(stability(s.questions, samples)));
  console.log();
  console.log(formatSummaries([summarize(JEV_MODEL, s.questions, samples)]));
}

async function cmdRepeat(s: Scenario, n: number, conc: number, nonce: boolean) {
  console.log(`${s.name}: ${n} identical calls${nonce ? " (with per-call nonce)" : ""}\n`);
  const samples = await runJev(s, n, conc, nonce);
  const st = stability(s.questions, samples);
  console.log(formatStability(st));
  console.log();
  console.log(formatSummaries([summarize(`${JEV_MODEL}${nonce ? "+nonce" : ""}`, s.questions, samples)]));
  const errs = samples.filter((x) => x.error);
  if (errs.length) console.log(`\nerrors:\n${errs.map((e) => "  " + e.error).join("\n")}`);
  await saveRun(`repeat${nonce ? "-nonce" : ""}`, s.name, { scenario: s.name, nonce, samples, stability: st });
}

async function cmdPerturb(s: Scenario, n: number, conc: number) {
  const variants: Record<string, Scenario> = { original: s };
  for (const [k, state] of Object.entries(s.perturbations ?? {})) variants[k] = { ...s, state };
  console.log(`${s.name}: ${n} calls per variant, ${Object.keys(variants).length} variants\n`);
  const results: Record<string, Sample[]> = {};
  for (const [k, v] of Object.entries(variants)) results[k] = await runJev(v, n, conc, false, k);

  // Per-question: the mean headline value under each variant, and whether the decision label moved.
  const ids = Object.keys(s.questions);
  const names = Object.keys(variants);
  const rows: (string | number)[][] = [];
  let movedLabels = 0;
  for (const id of ids) {
    const base = results.original!.filter((x) => !x.error).map((x) => x.answers[id]!);
    const baseLabel = stability({ [id]: s.questions[id]! }, results.original!)[0]!.plurality;
    const row: (string | number)[] = [id, baseLabel];
    for (const name of names) {
      const ss = results[name]!.filter((x) => !x.error).map((x) => x.answers[id]!).filter(Boolean);
      const m = ss.reduce((a, x) => a + headline(x), 0) / (ss.length || 1);
      const lbl = stability({ [id]: s.questions[id]! }, results[name]!)[0]!.plurality;
      const moved = name !== "original" && lbl !== baseLabel;
      if (moved) movedLabels++;
      row.push(`${f2(m)}${moved ? ` →${lbl}` : ""}`);
    }
    void base;
    rows.push(row);
  }
  console.log(table(["question", "label", ...names.map((v) => `${v} (mean)`)], rows));
  console.log(`\nlabel changes vs original: ${movedLabels} across ${ids.length * (names.length - 1)} question×variant cells`);
  console.log();
  console.log(formatSummaries(names.map((name) => summarize(name, s.questions, results[name]!))));
  await saveRun("perturb", s.name, { scenario: s.name, results });
}

async function cmdCompare(s: Scenario, n: number, conc: number) {
  console.log(`${s.name}: ${n} calls each, Jev vs ${BASELINE_MODEL} (temperature 0), per-call nonce on both\n`);
  const [jev, base] = await Promise.all([runJev(s, n, conc, true), runBaseline(s, n, Math.min(conc, 4), true)]);
  const stJ = stability(s.questions, jev);
  const stB = stability(s.questions, base);
  const rows = stJ.map((q, i) => {
    const b = stB[i]!;
    return [
      q.id,
      q.type,
      `${q.plurality} ${pct(q.agreement)}`,
      f2(q.mean),
      q.std.toFixed(4),
      `${b.plurality} ${pct(b.agreement)}`,
      f2(b.mean),
      b.std.toFixed(4),
      q.plurality === b.plurality ? "" : "DIFF",
    ];
  });
  console.log(table(["question", "type", "jev label", "jev mean", "jev std", "llm label", "llm mean", "llm std", "agree?"], rows));
  console.log();
  console.log(formatSummaries([summarize(JEV_MODEL + "+nonce", s.questions, jev), summarize(BASELINE_MODEL + " t=0", s.questions, base)]));
  const errs = base.filter((x) => x.error);
  if (errs.length) console.log(`\nbaseline parse errors: ${errs.length}`);
  await saveRun("compare", s.name, { scenario: s.name, jev, baseline: base });
}

/** The docs' triage rule: code owns the workflow, the model supplies atomic judgments. */
function routeTicket(a: Answers): { outcome: string; why: string } {
  const noul = (k: string) => (a[k]?.type === "noul" ? (a[k] as { noul: number }).noul : 0);
  const topic = a.topic as Extract<Answers[string], { type: "choice" }>;
  const frustration = a.frustration as Extract<Answers[string], { type: "score" }>;
  const spamRisk = 0.6 * noul("requests_credentials") + 0.4 * noul("sender_identity_mismatch");
  if (spamRisk > 0.4 && spamRisk < 0.6) return { outcome: "human_review", why: `spam risk uncertain (${f2(spamRisk)})` };
  if (spamRisk >= 0.6) return { outcome: "quarantine", why: `spam risk ${f2(spamRisk)}` };
  if (topic.confidence < 0.75) return { outcome: "human_review", why: `topic confidence ${f2(topic.confidence)} < 0.75` };
  const priority = frustration.confidence >= 0.7 && frustration.score >= 1.5 ? "high" : "normal";
  if (topic.choice === "billing") return { outcome: `billing (refund=${noul("refund_requested") >= 0.7}, ${priority})`, why: `topic billing @${f2(topic.confidence)}` };
  if (topic.choice === "orders") return { outcome: `orders (open_order=${noul("mentions_open_order") >= 0.7}, ${priority})`, why: `topic orders @${f2(topic.confidence)}` };
  return { outcome: `account (${priority})`, why: `topic account @${f2(topic.confidence)}` };
}

async function cmdRoute(s: Scenario, n: number, conc: number) {
  if (s.name !== "triage") {
    console.error("route only supports the triage scenario");
    process.exit(1);
  }
  console.log(`${s.name}: routing ${n} calls through the confidence-gated triage rule\n`);
  const samples = await runJev(s, n, conc, true);
  const counts: Record<string, number> = {};
  const rows: (string | number)[][] = [];
  samples.filter((x) => !x.error).forEach((x, i) => {
    const r = routeTicket(x.answers);
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    rows.push([i, r.outcome, r.why, decisionLabel(x.answers.topic!), f2(headline(x.answers.frustration!))]);
  });
  console.log(table(["#", "outcome", "why", "topic", "frustration"], rows));
  console.log("\noutcome counts:");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
}

// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    samples: { type: "string", short: "n" },
    concurrency: { type: "string", short: "c" },
    nonce: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

const [cmd, scenarioName] = positionals;
const conc = Number(values.concurrency ?? 8);
const nArg = values.samples ? Number(values.samples) : undefined;

if (values.help || !cmd) {
  console.log(HELP);
  process.exit(0);
}

switch (cmd) {
  case "list":
    for (const s of Object.values(SCENARIOS)) console.log(`${s.name.padEnd(12)} ${s.description}`);
    break;
  case "probe":
    await cmdProbe(pickScenario(scenarioName));
    break;
  case "ask":
    if (!scenarioName) {
      console.error("ask needs a JSON file path");
      process.exit(1);
    }
    await cmdAsk(scenarioName, nArg ?? 1, conc);
    break;
  case "repeat":
    await cmdRepeat(pickScenario(scenarioName), nArg ?? 20, conc, values.nonce);
    break;
  case "perturb":
    await cmdPerturb(pickScenario(scenarioName), nArg ?? 5, conc);
    break;
  case "compare":
    await cmdCompare(pickScenario(scenarioName), nArg ?? 10, conc);
    break;
  case "route":
    await cmdRoute(pickScenario(scenarioName), nArg ?? 10, conc);
    break;
  default:
    console.log(HELP);
    process.exit(1);
}
