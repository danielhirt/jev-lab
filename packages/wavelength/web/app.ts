import { SCALE_MAX, type BandLabel, type Level } from "../src/types";

interface RoundView {
  seed: number;
  target: number;
  spectrum: { id: string; left: string; right: string; levels: Level[] };
}

interface ClueView {
  clue: string;
  score: number;
  confidence: number;
  probabilities: number[];
  distance: number;
  points: number;
  band: BandLabel;
}

interface ScoreView extends RoundView {
  clues: ClueView[];
  closest: string | null;
  model: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const seedInput = $<HTMLInputElement>("seed");
const clueInput = $<HTMLInputElement>("clue");
const scoreBtn = $<HTMLButtonElement>("score");
const listEl = $("clue-list");
const noteEl = $("note");
const resultsEl = $("results");
const trackEl = $("track");
const bannerEl = $("banner");
const levelsEl = $("levels");

let round: RoundView | null = null;
let clues: string[] = [];
let busy = false;
let lastScores: Map<string, number> | null = null;

function pct(score: number): string {
  return `${(Math.max(0, Math.min(SCALE_MAX, score)) / SCALE_MAX) * 100}%`;
}

function note(text: string, isError = false) {
  noteEl.textContent = text;
  noteEl.classList.toggle("err", isError);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "The request failed.");
  return body;
}

function renderTrack() {
  if (!round) return;
  $("left").textContent = round.spectrum.left;
  $("right").textContent = round.spectrum.right;
  const mark = $("target-mark");
  mark.style.left = pct(round.target);
  $("target-label").textContent = `target ${round.target.toFixed(2)}`;
  for (const old of trackEl.querySelectorAll(".needle")) old.remove();
  levelsEl.replaceChildren();
  round.spectrum.levels.forEach((level, i) => {
    const li = document.createElement("li");
    li.textContent = `${i}. ${level.what}`;
    const ex = document.createElement("span");
    ex.className = "ex";
    ex.textContent = level.examples.join(", ");
    li.append(ex);
    levelsEl.append(li);
  });
}

function renderClues() {
  listEl.replaceChildren();
  clues.forEach((clue, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${clue} ×`;
    button.setAttribute("aria-label", `Remove ${clue}`);
    button.addEventListener("click", () => {
      clues.splice(index, 1);
      lastScores = null;
      resultsEl.replaceChildren();
      for (const old of trackEl.querySelectorAll(".needle")) old.remove();
      renderClues();
      note(clues.length ? "Score the list when you are ready." : "Add a clue. Several clues go out in one request.");
    });
    li.append(button);
    listEl.append(li);
  });
  scoreBtn.disabled = busy || (clues.length === 0 && clueInput.value.trim() === "");
}

clueInput.addEventListener("input", () => {
  if (!busy) scoreBtn.disabled = clues.length === 0 && clueInput.value.trim() === "";
});

function renderScores(scored: ScoreView, replayDelta: number | null) {
  for (const old of trackEl.querySelectorAll(".needle")) old.remove();
  resultsEl.replaceChildren();
  for (const clue of scored.clues) {
    const mark = document.createElement("div");
    mark.className = "mark needle";
    mark.style.left = pct(clue.score);
    const label = document.createElement("span");
    label.textContent = clue.clue;
    mark.append(label);
    trackEl.append(mark);

    const row = document.createElement("article");
    row.className = clue.clue === scored.closest ? "result closest" : "result";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = clue.clue === scored.closest ? `${clue.clue}, closest` : clue.clue;
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = clue.score.toFixed(2);
    const band = document.createElement("div");
    band.className = "band";
    band.textContent = `${clue.band}, ${clue.points} ${clue.points === 1 ? "pt" : "pts"}, confidence ${clue.confidence.toFixed(2)}`;
    const bins = document.createElement("div");
    bins.className = "bins";
    bins.title = "Probability of each level, from the left pole to the right";
    clue.probabilities.forEach((p) => {
      const bar = document.createElement("i");
      bar.style.setProperty("--p", String(p));
      bins.append(bar);
    });
    row.append(name, num, band, bins);
    resultsEl.append(row);
  }
  const dollars = scored.costUsd.toFixed(6);
  const replay = replayDelta === null ? "" : ` Largest change from the last score: ${replayDelta.toFixed(3)}.`;
  note(
    `One request placed ${scored.clues.length} ${scored.clues.length === 1 ? "clue" : "clues"} in ${Math.round(scored.latencyMs)} ms for $${dollars}. Confidence is how peaked a clue's probabilities are.${replay}`,
  );
}

async function loadRound(seed: number, pushUrl: boolean) {
  round = await getJson<RoundView>(`/api/round?seed=${seed}`);
  seedInput.value = String(round.seed);
  clues = [];
  lastScores = null;
  resultsEl.replaceChildren();
  renderTrack();
  renderClues();
  note("Add a clue. Several clues go out in one request.");
  if (pushUrl) history.replaceState(null, "", `?seed=${round.seed}`);
}

function takeInput(): void {
  const pending = clueInput.value.trim();
  if (!pending) return;
  clues.push(pending);
  clueInput.value = "";
  lastScores = null;
}

async function score() {
  if (!round || busy) return;
  takeInput();
  if (clues.length === 0) return;
  busy = true;
  scoreBtn.disabled = true;
  note("Scoring…");
  try {
    const scored = await getJson<ScoreView>("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: round.seed, clues }),
    });
    let replayDelta: number | null = null;
    if (lastScores && lastScores.size === scored.clues.length && scored.clues.every((c) => lastScores!.has(c.clue))) {
      replayDelta = Math.max(...scored.clues.map((c) => Math.abs(c.score - (lastScores!.get(c.clue) ?? c.score))));
    }
    lastScores = new Map(scored.clues.map((c) => [c.clue, c.score]));
    renderScores(scored, replayDelta);
  } catch (err) {
    note(err instanceof Error ? err.message : "The score request failed.", true);
  } finally {
    busy = false;
    renderClues();
  }
}

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const clue = clueInput.value.trim();
  if (!clue) return;
  clues.push(clue);
  clueInput.value = "";
  lastScores = null;
  resultsEl.replaceChildren();
  for (const old of trackEl.querySelectorAll(".needle")) old.remove();
  renderClues();
  note("Score the list when you are ready.");
  clueInput.focus();
});

scoreBtn.addEventListener("click", () => void score());
$("new-round").addEventListener("click", () => {
  let seed = Math.floor(Math.random() * 9999) + 1;
  if (round && seed === round.seed) seed = seed === 9999 ? 1 : seed + 1;
  void loadRound(seed, true).catch((err: unknown) => note(err instanceof Error ? err.message : "Could not deal a spectrum.", true));
});
seedInput.addEventListener("change", () => {
  const seed = Number(seedInput.value);
  if (!Number.isInteger(seed)) return;
  void loadRound(seed, true).catch((err: unknown) => note(err instanceof Error ? err.message : "Could not deal a spectrum.", true));
});

const initial = Number(new URLSearchParams(location.search).get("seed") ?? "7");
void loadRound(Number.isInteger(initial) && initial >= 1 ? initial : 7, false).catch((err: unknown) => {
  note(err instanceof Error ? err.message : "Could not deal a spectrum.", true);
});

void getJson<{ ready: boolean }>("/api/config").then((config) => {
  if (config.ready) return;
  bannerEl.hidden = false;
  bannerEl.textContent = "Set TYPESAFE_API_KEY in packages/wavelength/.env and restart the server. Dealing a spectrum needs no key.";
}).catch(() => {});
