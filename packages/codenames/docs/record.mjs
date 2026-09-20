// Records docs/codenames.mp4: run the server on :3100 with TYPESAFE_API_KEY, then `bun run docs/record.mjs` with playwright-core installed and PLAYWRIGHT_BROWSERS_PATH pointing at a Chromium build. Convert the .webm with ffmpeg (see README).
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = "http://localhost:3100";
const W = 1280, H = 1090; // full board in frame, with room under it for the caption
const marks = [];
const t0 = Date.now();
const mark = (label) => { marks.push([((Date.now() - t0) / 1000).toFixed(1), label]); console.log(marks.at(-1).join("s  ")); };

// CHROMIUM_PATH names the Chromium binary; without it Playwright looks under PLAYWRIGHT_BROWSERS_PATH.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", deviceScaleFactor: 1, recordVideo: { dir: "video", size: { width: W, height: H } } });
const page = await ctx.newPage();
// A visible cursor, so clicks read on the recording.
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;z-index:9999;width:18px;height:18px;border-radius:50%;background:rgba(37,106,191,.35);border:2px solid #256abf;pointer-events:none;transform:translate(-50%,-50%);transition:transform 80ms";
    document.body.append(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; });
    addEventListener("mousedown", () => { c.style.transform = "translate(-50%,-50%) scale(.7)"; });
    addEventListener("mouseup", () => { c.style.transform = "translate(-50%,-50%) scale(1)"; });
  });
});

const pause = (ms) => page.waitForTimeout(ms);
/** A caption bar under the board, clear of the bottom row; empty text hides it. */
async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("rec-caption");
    if (!el) {
      el = document.createElement("div"); el.id = "rec-caption";
      el.style.cssText = "position:fixed;left:446px;bottom:18px;transform:translateX(-50%);width:max-content;max-width:840px;background:rgba(26,26,25,.92);color:#fcfcfb;font:600 20px/1.35 system-ui,sans-serif;padding:12px 18px;border-radius:12px;z-index:9998;text-align:center;transition:opacity 180ms;pointer-events:none";
      document.body.append(el);
    }
    el.textContent = t; el.style.opacity = t ? "1" : "0";
  }, text);
}
async function moveTo(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  return true;
}
async function click(selector) { if (!(await moveTo(selector))) return false; await pause(150); await page.mouse.down(); await pause(80); await page.mouse.up(); return true; }
async function typeClue(text) {
  await click("#clue");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 140 });
  await page.waitForFunction(() => document.querySelectorAll(".cardw.heat").length > 0, null, { timeout: 15000 });
}
async function setNumber(n) { await page.fill("#number", String(n)); }
async function giveAndWait(number) {
  await setNumber(number);
  await click("#give");
  await page.waitForFunction(() => !document.getElementById("give").disabled, null, { timeout: 30000 });
}

await page.goto(`${base}/?seed=7&mode=spymaster`);
await page.waitForSelector(".cardw");
await caption("You are the spymaster. Jev guesses. Every card shows the probability Jev assigns as you type."); await pause(2600); mark("board");

// 1. A tempting clue that reaches the assassin: the heatmap says no before anyone guesses.
await caption("Try HORSE."); await typeClue("horse"); await pause(900);
await caption("SADDLE is the assassin. Jev puts it above 0.9 before anyone has guessed. A calibrated number is a warning you can act on."); await pause(3600); mark("horse: saddle lights up");

// 2. Canyon 2: valley clears the bar, desert sits in the uncertain band, Jev stops after one.
await caption("CANYON: VALLEY clears the 0.70 bar, DESERT sits hatched in the uncertain band."); await typeClue("canyon"); await pause(2800); mark("canyon preview");
await caption("Say CANYON 2 anyway. Jev guesses only what clears the bar, then stops."); await giveAndWait(2); await pause(2400); mark("canyon guessed");

// 3. Side by side with a chat model, if the server has one configured.
const hasCompare = !(await page.locator("#compare-wrap").isHidden());
if (hasCompare) {
  await caption("Now ask a chat model the same question about the same clue, side by side."); await click("#compare"); await typeClue("rain");
  await page.waitForFunction(() => document.querySelector("#compare-strip .verdict") !== null, null, { timeout: 60000 });
  await pause(4200); mark("compare rain");
  await caption("Replay both: same clue, same board, asked again. The note shows the largest change for each."); await click("#replay");
  await page.waitForFunction(() => document.getElementById("replay-note").textContent.includes("temperature"), null, { timeout: 60000 }); await pause(4200); mark("compare replay");
  await click("#compare");
} else {
  await caption("RAIN 1."); await typeClue("rain"); await pause(2000); mark("rain preview");
}
await caption(""); await giveAndWait(1); await pause(1600); mark("rain guessed");

// 4. Library: replay shows the numbers hold, then give it.
await caption("LIBRARY. Replay the same clue: the largest change across 25 words is a few hundredths."); await typeClue("library"); await pause(1600); mark("library preview");
await click("#replay"); await page.waitForFunction(() => document.getElementById("replay-note").textContent.length > 0, null, { timeout: 60000 }); await pause(3000); mark("replay");
await caption(""); await giveAndWait(1); await pause(1600); mark("library guessed");

// 5. Switch roles: Jev gives the clues.
await caption("Swap roles. A language model proposes clue words; Jev judges every candidate against every word; code picks.");
await click("#mode-guesser"); await page.waitForFunction(() => !document.getElementById("ask").disabled, null, { timeout: 15000 });
// A fresh board for this mode: on seed 11 the picked clue is for two words on most runs.
await page.fill("#seed", "11"); await page.dispatchEvent("#seed", "change");
await page.waitForFunction(() => [...document.querySelectorAll(".cardw")].some((c) => /kite/i.test(c.textContent)) && !document.getElementById("ask").disabled, null, { timeout: 15000 }); await pause(1800); mark("guesser mode");
await click("#ask");
await page.waitForFunction(() => document.querySelectorAll("#feed li").length >= 4, null, { timeout: 60000 });
await caption("Every verdict, live: hundreds of word pairs in a few seconds for a cent. Rejections say why."); await pause(3200); mark("feed");
await page.waitForFunction(() => !document.getElementById("open-clue").hidden || document.querySelectorAll("#log li").length > 0, null, { timeout: 120000 });
await pause(1200); await caption("The same judging through a chat model would cost about 13 times as much. That price is why code can judge every candidate."); await pause(4200); mark("versus");
await caption("Jev's probabilities stay hidden until the guess. Tap a card."); await pause(1800); mark("clue asked");
const clue = (await page.textContent("#open-clue"))?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
// The guesser cannot see the key, so the script knows the answers only for clues seen on this seed; any other clue ends in a pass.
const known = { sailor: ["ship", "deck"], boat: ["ship", "deck"], cruise: ["ship", "deck"], voyage: ["ship", "deck"], sailing: ["ship", "deck"], navy: ["ship", "deck"], captain: ["ship", "deck"], powerpoint: ["slide", "deck"], playground: ["slide"], cricket: ["bat", "match"], carpenter: ["hammer", "deck"], toolbox: ["hammer"], nail: ["hammer"], waterpark: ["slide"], poker: ["deck"], cards: ["deck"] };
let picked = 0;
for (const pick of known[clue] ?? []) {
  const card = `.cardw.clickable:has-text("${pick}")`;
  if ((await page.locator(card).count()) === 0) break;
  await click(card); picked++; mark(`guessed ${pick} for ${clue}`); await pause(1400);
}
if (await page.locator("#pass").isVisible()) { await pause(600); await click("#pass"); mark(picked ? "ended turn" : `passed on ${clue}`); }
await page.waitForFunction(() => document.querySelectorAll(".cardw.heat").length > 0, null, { timeout: 15000 });
await caption("Turn over: the board shows what Jev was thinking and which word it meant."); await pause(4200); mark("heat revealed");
await caption("");

await ctx.close();
await browser.close();
const file = fs.readdirSync("video").find((f) => f.endsWith(".webm"));
fs.renameSync(`video/${file}`, "video/codenames.webm");
fs.writeFileSync("video/marks.json", JSON.stringify(marks));
console.log("saved video/codenames.webm");
