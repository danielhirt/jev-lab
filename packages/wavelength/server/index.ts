/**
 * The page and the round endpoint need no key. Scoring does.
 *
 *   TYPESAFE_API_KEY=... bun run server/index.ts
 *
 * Bun loads packages/wavelength/.env when you start the server from this package.
 */
import page from "../web/index.html";
import { TypeSafeJudge } from "../src/judge";
import { deal, parseSeed, prepareClues } from "../src/round";
import { closestClue } from "../src/score";

const PORT = Number(process.env.PORT ?? 3200);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_BODY = 8_000;

class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

class Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly perSecond: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return true;
  }
}

const scoreLimit = new Limiter(8, 0.5);

function clientKey(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  const forwarded = TRUST_PROXY ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return forwarded || server.requestIP(req)?.address || "unknown";
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new HttpError("Request too large.", 413);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError("Request too large.", 413);
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpError("Send JSON.");
  }
}

function roundPayload(seed: number) {
  const round = deal(seed);
  return {
    seed: round.seed,
    target: round.target,
    spectrum: {
      id: round.spectrum.id,
      left: round.spectrum.left,
      right: round.spectrum.right,
      levels: round.spectrum.levels,
    },
  };
}

let judge: TypeSafeJudge | null = null;

function scorer(): TypeSafeJudge {
  if (!process.env.TYPESAFE_API_KEY) {
    throw new HttpError("Set TYPESAFE_API_KEY in packages/wavelength/.env and restart the server.", 503);
  }
  judge ??= new TypeSafeJudge();
  return judge;
}

async function handle(req: Request, server: { requestIP(req: Request): { address: string } | null }): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/api/config") {
    return json({ ready: Boolean(process.env.TYPESAFE_API_KEY), model: process.env.JEV_MODEL ?? "jev-latest" });
  }
  if (req.method === "GET" && url.pathname === "/api/round") {
    const seed = parseSeed(url.searchParams.get("seed") ?? "7");
    if (seed === null) throw new HttpError("Seed must be an integer from 1 to 1000000.");
    return json(roundPayload(seed));
  }
  if (req.method === "POST" && url.pathname === "/api/score") {
    if (!scoreLimit.take(clientKey(req, server))) throw new HttpError("Slow down. A score is still one live request.", 429);
    const body = await readJson(req);
    const seed = parseSeed(body.seed ?? 7);
    if (seed === null) throw new HttpError("Seed must be an integer from 1 to 1000000.");
    if (!Array.isArray(body.clues) || body.clues.some((clue) => typeof clue !== "string")) {
      throw new HttpError("Send clues as a list of strings.");
    }
    const round = deal(seed);
    const prepared = prepareClues(body.clues, round.spectrum);
    if ("error" in prepared) throw new HttpError(prepared.error);
    const result = await scorer().score(round.spectrum, prepared.clues, round.target);
    const best = closestClue(result.clues);
    return json({
      ...roundPayload(seed),
      clues: result.clues,
      closest: best?.clue ?? null,
      model: result.model,
      inputTokens: result.inputTokens,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    });
  }
  return new Response("not found", { status: 404 });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 30,
  development: process.env.NODE_ENV !== "production",
  routes: { "/": page },
  async fetch(req, srv) {
    try {
      return await handle(req, srv);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "The score request failed." }, 500);
    }
  },
});

console.log(`wavelength on http://localhost:${server.port} (key ${process.env.TYPESAFE_API_KEY ? "set" : "missing"})`);
