import type { GameView, Mode, TurnView } from "../server/session";
import type { Judgment } from "../src/types";
import { download, drawCard, heatStep } from "./card";

type Heat = Record<string, { p: number; first: number }>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $("board"), statusEl = $("status"), logEl = $("log"), meterEl = $("meter"), pipelineEl = $("pipeline");
const clueInput = $<HTMLInputElement>("clue"), numberInput = $<HTMLInputElement>("number"), seedInput = $<HTMLInputElement>("seed");
const previewNote = $("preview-note"), replayNote = $("replay-note"), replayBtn = $<HTMLButtonElement>("replay");
const giveBtn = $<HTMLButtonElement>("give"), askBtn = $<HTMLButtonElement>("ask"), passBtn = $<HTMLButtonElement>("pass");
const openClueEl = $("open-clue"), resultEl = $("result"), resultText = $("result-text");

let game: GameView | null = null;
let mode: Mode = "spymaster";
let heat: Heat | null = null;          // what the board is currently showing
let lastPreview: Judgment | null = null;
let busy = false;

/** POST JSON to the API. Every mutation is a POST, including the body-less ask and pass. */
async function api<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: (T & { error?: string }) | null = null;
  try { data = JSON.parse(text) as T & { error?: string }; } catch { /* non-JSON error body */ }
  if (!res.ok || data === null) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function setStatus(text: string) { statusEl.textContent = text; }
function note(el: HTMLElement, text: string, err = false) { el.textContent = text; el.classList.toggle("err", err); }

function heatFrom(j: Judgment): Heat {
  return Object.fromEntries(j.words.map((w) => [w.word, { p: w.p, first: w.first }]));
}

function renderBoard() {
  if (!game) return;
  boardEl.replaceChildren();
  const canGuess = mode === "guesser" && game.status === "playing" && game.open !== null;
  const lastTurn = game.turns[game.turns.length - 1];
  const targets = new Set(lastTurn?.stop !== "open" ? lastTurn?.targets ?? [] : []);
  for (const card of game.cards) {
    const el = document.createElement(canGuess && !card.revealed ? "button" : "div");
    el.className = "cardw";
    const word = document.createElement("div"); word.className = "word"; word.textContent = card.word; el.append(word);
    const meta = document.createElement("div"); meta.className = "meta";
    if (card.revealed && card.role) {
      el.classList.add("revealed", card.role);
      const label = document.createElement("span"); label.className = "label"; label.textContent = card.role; meta.append(label);
    } else {
      const h = heat?.[card.word];
      if (h) {
        el.classList.add("heat", `s${heatStep(h.p)}`);
        if (h.p >= 0.3 && h.p < 0.7) el.classList.add("uncertain");
        const p = document.createElement("span"); p.className = "p"; p.textContent = h.p.toFixed(2); meta.append(p);
        el.title = `${card.word}: ${h.p.toFixed(3)}; first-pick ${h.first.toFixed(3)}`;
      }
      if (card.role && mode === "spymaster") {
        const key = document.createElement("span"); key.className = "key";
        const dot = document.createElement("i"); dot.className = `dot ${card.role}`; key.append(dot, card.role); meta.append(key);
      }
      if (targets.has(card.word)) { const t = document.createElement("span"); t.className = "target"; t.textContent = "meant"; el.append(t); }
      if (canGuess) { el.classList.add("clickable"); el.addEventListener("click", () => onGuess(card.word)); }
    }
    el.append(meta);
    boardEl.append(el);
  }
}

function renderMeter() {
  if (!game) return;
  const m = game.meter;
  const rows: [string, string][] = [
    ["Jev calls", String(m.jevRequests)],
    ["word pairs", m.pairs.toLocaleString()],
    ["cost", `$${m.jevCostUsd.toFixed(4)}`],
    ["model time", `${(m.jevMs / 1000).toFixed(1)} s`],
  ];
  meterEl.replaceChildren(...rows.map(([k, v]) => { const d = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; d.append(dt, dd); return d; }));
}

function renderLog() {
  if (!game) return;
  logEl.replaceChildren(...game.turns.map((t) => {
    const li = document.createElement("li");
    if (t.stop === "pass" && !t.clue) { li.textContent = "Jev passed: no clue cleared the thresholds."; return li; }
    const b = document.createElement("b"); b.textContent = `${t.clue.toUpperCase()} ${t.number}`;
    const g = document.createElement("span"); g.className = "g";
    g.textContent = t.guesses.length ? ": " + t.guesses.map((x) => `${x.word}${x.role === "agent" ? "" : ` (${x.role})`}${x.p !== null ? ` ${x.p.toFixed(2)}` : ""}`).join(", ") : t.stop === "open" ? ": your guess" : ": no guess";
    li.append(b, g);
    return li;
  }));
}

function renderPipeline(t: TurnView | undefined) {
  if (!t?.pipeline) { pipelineEl.hidden = true; return; }
  const p = t.pipeline;
  pipelineEl.hidden = false;
  pipelineEl.replaceChildren();
  const steps = document.createElement("div"); steps.className = "steps";
  const parts = [
    `${p.proposer} proposed <b>${p.proposed}</b>`,
    `code dropped <b>${p.illegal}</b> illegal`,
    `Jev judged <b>${p.judged}</b> clues × 25 words = <b>${p.pairs.toLocaleString()}</b> pairs`,
    `in <b>${(p.ms / 1000).toFixed(1)} s</b> for <b>$${p.costUsd.toFixed(4)}</b>`,
    t.clue ? `code picked <b>${t.clue.toUpperCase()} ${t.number}</b>` : "nothing cleared the thresholds",
  ];
  for (const html of parts) { const s = document.createElement("span"); s.innerHTML = html; steps.append(s); }
  pipelineEl.append(steps);
}

function renderStatus() {
  if (!game) return;
  const last = game.turns[game.turns.length - 1];
  if (game.status === "won") setStatus(`Cleared all 9 agents in ${game.turns.length} turn${game.turns.length === 1 ? "" : "s"}.`);
  else if (game.status === "lost") setStatus(game.reason === "assassin" ? "The assassin. Game over." : "Out of turns.");
  else setStatus(`${game.agentsLeft} agents left · ${game.turnsLeft} turns left`);

  $("spymaster-panel").hidden = mode !== "spymaster";
  $("guesser-panel").hidden = mode !== "guesser";
  const playing = game.status === "playing";
  giveBtn.disabled = !playing || busy;
  clueInput.disabled = !playing;
  askBtn.disabled = !playing || busy || game.open !== null;
  passBtn.hidden = !(playing && game.open !== null);
  openClueEl.hidden = game.open === null;
  if (game.open) {
    openClueEl.replaceChildren();
    openClueEl.append(`${game.open.clue.toUpperCase()} ${game.open.number}`);
    const small = document.createElement("small"); small.textContent = `tap the cards you think it means · ${game.open.correct} of ${game.open.number} found`; openClueEl.append(small);
  }
  renderPipeline(last);
  resultEl.hidden = playing;
  if (!playing) {
    const m = game.meter;
    resultText.textContent = `${game.status === "won" ? "Won" : "Lost"} on seed ${game.seed}: ${m.jevRequests} Jev requests, ${m.pairs.toLocaleString()} word pairs, $${m.jevCostUsd.toFixed(4)}.`;
  }
}

function render() { renderBoard(); renderMeter(); renderLog(); renderStatus(); }

function shareUrl(): string {
  const u = new URL(location.href);
  u.searchParams.set("seed", String(game?.seed ?? ""));
  u.searchParams.set("mode", mode);
  return u.toString();
}

async function newGame(seed?: number) {
  busy = true;
  try {
    game = await api<GameView>("/api/games", { mode, seed });
    heat = null; lastPreview = null;
    clueInput.value = ""; replayBtn.disabled = true; note(replayNote, ""); note(previewNote, mode === "spymaster" ? "The board lights up as you type: one request, 25 nouls and a choice, about 300 ms." : "");
    seedInput.value = String(game.seed);
    history.replaceState(null, "", shareUrl());
  } catch (e) { setStatus((e as Error).message); }
  finally { busy = false; render(); }
}

let previewTimer: number | undefined;
let previewSeq = 0;
function schedulePreview() {
  window.clearTimeout(previewTimer);
  const clue = clueInput.value.trim();
  if (!clue || !game || game.status !== "playing") { heat = null; lastPreview = null; replayBtn.disabled = true; renderBoard(); return; }
  previewTimer = window.setTimeout(async () => {
    const seq = ++previewSeq;
    const started = performance.now();
    try {
      const r = await api<{ illegal: string | null; judgment: Judgment; meter: GameView["meter"] }>(`/api/games/${game!.id}/preview`, { clue });
      if (seq !== previewSeq) return;
      if (r.illegal) { note(previewNote, `Illegal clue: ${r.illegal}.`, true); heat = null; lastPreview = null; replayBtn.disabled = true; }
      else {
        lastPreview = r.judgment; heat = heatFrom(r.judgment); game!.meter = r.meter;
        const would = r.judgment.words.filter((w) => w.p >= 0.7).sort((a, b) => b.p - a.p).map((w) => w.word);
        note(previewNote, `${Math.round(performance.now() - started)} ms round trip, ${r.judgment.inputTokens} tokens, $${r.judgment.costUsd.toFixed(5)}. Jev would guess: ${would.length ? would.join(", ") : "nothing clears 0.70"}.`);
        replayBtn.disabled = false;
      }
      renderBoard(); renderMeter();
    } catch (e) { if (seq === previewSeq) note(previewNote, (e as Error).message, true); }
  }, 350);
}

async function onReplay() {
  if (!game || !lastPreview) return;
  replayBtn.disabled = true;
  try {
    const r = await api<{ illegal: string | null; judgment: Judgment; meter: GameView["meter"] }>(`/api/games/${game.id}/preview`, { clue: lastPreview.clue });
    if (r.illegal) return;
    const before = new Map(lastPreview.words.map((w) => [w.word, w.p]));
    let max = 0, maxWord = "";
    for (const w of r.judgment.words) { const d = Math.abs(w.p - (before.get(w.word) ?? 0)); if (d > max) { max = d; maxWord = w.word; } }
    lastPreview = r.judgment; heat = heatFrom(r.judgment); game.meter = r.meter;
    note(replayNote, `Same clue, fresh request: the largest change across 25 words was ${max.toFixed(3)}${maxWord ? ` (${maxWord})` : ""}.`);
    renderBoard(); renderMeter();
  } catch (e) { note(replayNote, (e as Error).message, true); }
  finally { replayBtn.disabled = false; }
}

async function onGive() {
  if (!game || busy) return;
  const clue = clueInput.value.trim();
  const number = Number(numberInput.value);
  if (!clue) return;
  busy = true; renderStatus();
  try {
    const r = await api<{ turn: TurnView; game: GameView }>(`/api/games/${game.id}/clue`, { clue, number });
    heat = r.turn.heat;
    // Reveal Jev's guesses one at a time so the order reads.
    const staged: GameView = { ...r.game, cards: r.game.cards.map((c) => ({ ...c, revealed: c.revealed && !r.turn.guesses.some((g) => g.word === c.word) })) };
    game = staged; renderBoard();
    for (const g of r.turn.guesses) {
      await new Promise((res) => setTimeout(res, 650));
      game = { ...game!, cards: game!.cards.map((c) => (c.word === g.word ? { ...c, revealed: true, role: g.role } : c)) };
      renderBoard();
    }
    game = r.game;
    clueInput.value = ""; lastPreview = null; replayBtn.disabled = true;
    const found = r.turn.guesses.filter((g) => g.role === "agent").length;
    note(previewNote, r.turn.stop === "nothing" ? "Nothing on the board cleared 0.70 for that clue, so Jev did not guess." : `Jev guessed ${r.turn.guesses.map((g) => g.word).join(", ")}: ${found} of ${number} right${r.turn.stop === "assassin" ? ", and one was the assassin" : r.turn.stop === "wrong" ? ", stopped on a miss" : ""}.`);
  } catch (e) { note(previewNote, (e as Error).message, true); }
  finally { busy = false; render(); }
}

async function onAsk() {
  if (!game || busy) return;
  busy = true; renderStatus(); setStatus("Jev is thinking: proposing, judging every candidate against every word, picking…");
  try {
    const r = await api<{ turn: TurnView; game: GameView }>(`/api/games/${game.id}/ask`);
    game = r.game; heat = null;
  } catch (e) { setStatus((e as Error).message); }
  finally { busy = false; render(); }
}

async function onGuess(word: string) {
  if (!game || busy) return;
  busy = true;
  try {
    const r = await api<{ turn: TurnView; game: GameView }>(`/api/games/${game.id}/guess`, { word });
    game = r.game; heat = r.turn.heat;
  } catch (e) { setStatus((e as Error).message); }
  finally { busy = false; render(); }
}

async function onPass() {
  if (!game || busy) return;
  busy = true;
  try {
    const r = await api<{ turn: TurnView; game: GameView }>(`/api/games/${game.id}/pass`);
    game = r.game; heat = r.turn.heat;
  } catch (e) { setStatus((e as Error).message); }
  finally { busy = false; render(); }
}

function setMode(next: Mode) {
  mode = next;
  $("mode-spymaster").setAttribute("aria-selected", String(next === "spymaster"));
  $("mode-guesser").setAttribute("aria-selected", String(next === "guesser"));
  void newGame(Number(seedInput.value) || undefined);
}

$("mode-spymaster").addEventListener("click", () => setMode("spymaster"));
$("mode-guesser").addEventListener("click", () => setMode("guesser"));
$("new-game").addEventListener("click", () => { seedInput.value = ""; void newGame(); });
seedInput.addEventListener("change", () => void newGame(Number(seedInput.value) || undefined));
clueInput.addEventListener("input", schedulePreview);
clueInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void onGive(); });
giveBtn.addEventListener("click", () => void onGive());
replayBtn.addEventListener("click", () => void onReplay());
askBtn.addEventListener("click", () => void onAsk());
passBtn.addEventListener("click", () => void onPass());
$("card").addEventListener("click", () => {
  if (!game) return;
  const canvas = $<HTMLCanvasElement>("share-canvas");
  const last = game.turns.filter((t) => t.heat).at(-1) ?? null;
  drawCard(canvas, game, last, shareUrl());
  download(canvas, `jev-codenames-${game.seed}.png`);
});
$("copy-link").addEventListener("click", async () => { try { await navigator.clipboard.writeText(shareUrl()); setStatus("Link copied."); } catch { setStatus(shareUrl()); } });

const params = new URLSearchParams(location.search);
if (params.get("mode") === "guesser") { mode = "guesser"; $("mode-spymaster").setAttribute("aria-selected", "false"); $("mode-guesser").setAttribute("aria-selected", "true"); }
void newGame(Number(params.get("seed")) || undefined);
