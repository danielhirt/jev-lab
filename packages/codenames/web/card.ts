/** Renders a square share card of the current board and turn onto a canvas, then downloads it. */
import type { CardView, GameView, TurnView } from "../server/session";

const SEQ = ["#f3f7fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const ROLE: Record<string, { fill: string; ink: string; label: string }> = {
  agent: { fill: "#1f9d55", ink: "#ffffff", label: "agent" },
  bystander: { fill: "#d9c9a3", ink: "#4a3f28", label: "bystander" },
  assassin: { fill: "#1a1a19", ink: "#ffffff", label: "assassin" },
};

/** Ramp step 0..7 for a probability; the page maps it to a theme token, the canvas to a light hex. */
export function heatStep(p: number): number {
  return Math.min(SEQ.length - 1, Math.floor(p * SEQ.length));
}

export function heatColor(p: number): { fill: string; dark: boolean } {
  const i = heatStep(p);
  return { fill: SEQ[i]!, dark: i >= 4 };
}

export function drawCard(canvas: HTMLCanvasElement, game: GameView, turn: TurnView | null, url: string): void {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  ctx.fillStyle = "#fcfcfb";
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = "#1a1a19";
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText("Jev plays Codenames", 60, 90);
  ctx.fillStyle = "#5c5c58";
  ctx.font = "400 26px system-ui, sans-serif";
  const headline = turn && turn.clue
    ? `${turn.clue.toUpperCase()} ${turn.number}  ·  ${turn.guesses.filter((g) => g.role === "agent").length} of ${turn.number} found`
    : "a spymaster that knows what it doesn't know";
  ctx.fillText(headline, 60, 135);

  const heat = turn?.heat ?? null;
  const size = 176, gap = 10, x0 = 60, y0 = 180;
  game.cards.forEach((card: CardView, i) => {
    const x = x0 + (i % 5) * (size + gap), y = y0 + Math.floor(i / 5) * (size + gap);
    let fill = "#ffffff", ink = "#1a1a19";
    if (card.revealed && card.role) { fill = ROLE[card.role]!.fill; ink = ROLE[card.role]!.ink; }
    else if (heat && heat[card.word]) { const h = heatColor(heat[card.word]!.p); fill = h.fill; ink = h.dark ? "#ffffff" : "#1a1a19"; }
    roundRect(ctx, x, y, size, size, 14, fill, "#e4e4e0");
    ctx.fillStyle = ink;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(card.word.toUpperCase(), x + 14, y + 40, size - 28);
    ctx.font = "400 22px system-ui, sans-serif";
    if (card.revealed && card.role) ctx.fillText(ROLE[card.role]!.label, x + 14, y + size - 18);
    else if (heat && heat[card.word]) ctx.fillText(heat[card.word]!.p.toFixed(2), x + 14, y + size - 18);
    if (heat && heat[card.word] && !card.revealed) {
      const p = heat[card.word]!.p;
      if (p >= 0.3 && p < 0.7) hatch(ctx, x, y, size, ink);
    }
  });

  ctx.fillStyle = "#5c5c58";
  ctx.font = "400 24px system-ui, sans-serif";
  const m = game.meter;
  const line1 = `${m.jevRequests} Jev requests · ${m.pairs.toLocaleString()} word pairs judged · $${m.jevCostUsd.toFixed(4)} · ${(m.jevMs / 1000).toFixed(1)} s of model time`;
  ctx.fillText(line1, 60, 1040 - 20);
  ctx.fillStyle = "#8a8a85";
  ctx.font = "400 20px system-ui, sans-serif";
  ctx.fillText(url, 60, 1040 + 14);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, s, s, 14); ctx.clip();
  ctx.globalAlpha = 0.18; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  for (let d = -s; d < s * 2; d += 12) { ctx.beginPath(); ctx.moveTo(x + d, y + s); ctx.lineTo(x + d + s, y); ctx.stroke(); }
  ctx.restore();
}

export function download(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}
