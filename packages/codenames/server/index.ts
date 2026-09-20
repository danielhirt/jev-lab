/**
 * HTTP layer. Keys stay here; the browser only ever sees game views.
 *
 *   PORT=3000 TYPESAFE_API_KEY=... [ANTHROPIC_API_KEY=...] bun run server/index.ts
 *
 * Without ANTHROPIC_API_KEY the guesser mode uses the wordlist proposer.
 */
import page from "../web/index.html";
import { ClaudeBaseline } from "../src/baseline";
import { TypeSafeJudge, type Judge } from "../src/judge";
import type { QuestionStyle } from "../src/questions";
import { ClaudeProposer, WordlistProposer } from "../src/proposer";
import { DEFAULT_THRESHOLDS } from "../src/types";
import { askClue, GameError, giveClue, guess, newGame, pass, preview, previewBaseline, view, type Game, type Mode } from "./session";

const PORT = Number(process.env.PORT ?? 3000);
const STYLE: QuestionStyle = process.env.CODENAMES_STYLE === "compact" ? "compact" : "full";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const GAME_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_GAMES = 2000;
const MAX_BODY = 4096;

const judge = new TypeSafeJudge(undefined, process.env.JEV_MODEL ?? "jev-latest", STYLE);
const useClaude = Boolean(process.env.ANTHROPIC_API_KEY);
const proposer = useClaude ? new ClaudeProposer(undefined, process.env.PROPOSER_MODEL ?? "claude-opus-5") : new WordlistProposer();
const candidates = useClaude ? 30 : 60;
const baseline: (Judge & { model: string }) | null = useClaude ? new ClaudeBaseline(undefined, process.env.BASELINE_MODEL) : null;

/** Phase 0 numbers shown on the page; from eval/run.ts on 100 SALT-NLP human clues, 2026-09-19. */
const EVAL = { clues: 100, guessTop1: 0.64, guessAuc: 0.94, chance: 1 / 25, repeatStd: 0.012 };

const games = new Map<string, Game>();
setInterval(() => {
  const cutoff = Date.now() - GAME_TTL_MS;
  for (const [id, g] of games) if (g.updatedAt < cutoff) games.delete(id);
}, 10 * 60 * 1000).unref();

/** Token bucket per client: `capacity` requests at once, refilling `perSecond`. */
class Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly perSecond: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    if (b.tokens < 1) { this.buckets.set(key, b); return false; }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10000) this.buckets.clear();
    return true;
  }
}
const lightLimit = new Limiter(20, 4);   // previews, clues, guesses: one Jev request each
const baselineLimit = new Limiter(10, 1); // chat-model comparisons cost real money
const gameLimit = new Limiter(10, 0.5);  // new boards; switching mode deals a new one
const askLimit = new Limiter(6, 0.34);   // Jev spymaster turns: dozens of Jev requests each

function clientKey(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  const forwarded = TRUST_PROXY ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return forwarded || server.requestIP(req)?.address || "unknown";
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new GameError("request too large", 413);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new GameError("request too large", 413);
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new GameError("invalid JSON"); }
}

function str(v: unknown, name: string, max = 40): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw new GameError(`${name} must be a short string`);
  return v;
}

function load(id: string): Game {
  const g = games.get(id);
  if (!g) throw new GameError("no such game", 404);
  return g;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function handle(req: Request, server: { requestIP(req: Request): { address: string } | null }): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "games", id?, action?]
  if (parts[0] === "api" && parts[1] === "config" && req.method === "GET") {
    return json({ judge: judge.model, style: STYLE, proposer: useClaude ? (process.env.PROPOSER_MODEL ?? "claude-opus-5") : "wordlist", baseline: baseline?.model ?? null, eval: EVAL });
  }
  if (parts[0] !== "api" || parts[1] !== "games") return new Response("not found", { status: 404 });
  const key = clientKey(req, server);

  if (parts.length === 2 && req.method === "POST") {
    if (!gameLimit.take(key)) throw new GameError("slow down: too many new boards at once", 429);
    const b = await body(req);
    const mode: Mode = b.mode === "guesser" ? "guesser" : "spymaster";
    const seedIn = Number(b.seed);
    const seed = Number.isInteger(seedIn) && seedIn > 0 && seedIn < 2 ** 31 ? seedIn : Math.floor(Math.random() * 2 ** 31);
    if (games.size >= MAX_GAMES) throw new GameError("too many games in play, try again later", 503);
    const game = newGame(crypto.randomUUID(), mode, seed);
    games.set(game.id, game);
    return json(view(game), 201);
  }

  const id = parts[2];
  if (!id) return new Response("not found", { status: 404 });
  const game = load(id);
  const action = parts[3];

  if (!action && req.method === "GET") return json(view(game));
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  switch (action) {
    case "preview": {
      if (!lightLimit.take(key)) throw new GameError("slow down", 429);
      const b = await body(req);
      const r = await preview(game, str(b.clue, "clue"), judge);
      return json({ illegal: r.illegal, judgment: r.judgment, meter: game.meter });
    }
    case "clue": {
      if (!lightLimit.take(key)) throw new GameError("slow down", 429);
      const b = await body(req);
      const turn = await giveClue(game, str(b.clue, "clue"), Number(b.number), judge, DEFAULT_THRESHOLDS);
      return json({ turn, game: view(game) });
    }
    case "baseline": {
      if (!baseline) throw new GameError("no comparison model is configured on this server", 404);
      if (!baselineLimit.take(key)) throw new GameError("slow down: the comparison model is rate limited", 429);
      const b = await body(req);
      const judgment = await previewBaseline(game, str(b.clue, "clue"), baseline);
      return json({ judgment, meter: game.meter });
    }
    case "ask": {
      if (!askLimit.take(key)) throw new GameError("slow down: Jev is still thinking about your last few turns", 429);
      if (!req.headers.get("accept")?.includes("text/event-stream")) {
        const turn = await askClue(game, proposer, judge, DEFAULT_THRESHOLDS, candidates);
        return json({ turn, game: view(game) });
      }
      // Stream every verdict as Jev returns it, then the finished turn.
      // The turn keeps running if the client goes away, so the game state stays consistent;
      // writes after a disconnect are dropped rather than thrown.
      const encoder = new TextEncoder();
      let open = true;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: string, data: unknown) => {
            if (!open) return;
            try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { open = false; }
          };
          const close = () => { if (!open) return; open = false; try { controller.close(); } catch { /* already closed */ } };
          send("start", { candidates });
          askClue(game, proposer, judge, DEFAULT_THRESHOLDS, candidates, (e, progress) => {
            const top = e.judgment.words.slice().sort((a, b) => b.p - a.p)[0];
            send("candidate", { clue: e.clue, number: e.number, rejected: e.rejected, targets: e.targets, risks: e.risks, top: top ? { word: top.word, p: top.p } : null, ...progress });
          })
            .then((turn) => send("done", { turn, game: view(game) }))
            .catch((err: unknown) => { send("error", { error: err instanceof GameError ? err.message : "something went wrong on the server" }); if (!(err instanceof GameError)) console.error(err); })
            .finally(close);
        },
        cancel() { open = false; },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
    }
    case "guess": {
      if (!lightLimit.take(key)) throw new GameError("slow down", 429);
      const b = await body(req);
      const turn = guess(game, str(b.word, "word"));
      return json({ turn, game: view(game) });
    }
    case "pass": {
      const turn = pass(game);
      return json({ turn, game: view(game) });
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

const server = Bun.serve({
  port: PORT,
  // A turn with the Claude proposer can go more than Bun's default 10 s without writing a byte.
  idleTimeout: 120,
  development: process.env.NODE_ENV !== "production",
  routes: { "/": page },
  async fetch(req, srv) {
    try {
      return await handle(req, srv);
    } catch (err) {
      if (err instanceof GameError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "something went wrong on the server" }, 500);
    }
  },
});

console.log(`codenames on http://localhost:${server.port} (judge ${STYLE}, proposer ${useClaude ? "claude" : "wordlist"})`);
