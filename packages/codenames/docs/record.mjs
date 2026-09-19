// Records docs/codenames.mp4: run the server on :3100 with TYPESAFE_API_KEY, then `bun run docs/record.mjs` with playwright-core installed and PLAYWRIGHT_BROWSERS_PATH pointing at a Chromium build. Convert the .webm with ffmpeg (see README).
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = "http://localhost:3100";
const W = 1280, H = 900; // full board in frame
const marks = [];
const t0 = Date.now();
const mark = (label) => { marks.push([((Date.now() - t0) / 1000).toFixed(1), label]); console.log(marks.at(-1).join("s  ")); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
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
await pause(1800); mark("board");

// 1. A tempting clue that reaches the assassin: the heatmap says no before anyone guesses.
await typeClue("horse"); await pause(3200); mark("horse: saddle lights up");
// 2. Canyon 2: valley clears the bar, desert sits in the uncertain band, Jev stops after one.
await typeClue("canyon"); await pause(2600); mark("canyon preview");
await giveAndWait(2); await pause(2200); mark("canyon guessed");
// 3. Rain 1.
await typeClue("rain"); await pause(2000); mark("rain preview");
await giveAndWait(1); await pause(1800); mark("rain guessed");
// 4. Library: replay shows the numbers hold, then give it.
await typeClue("library"); await pause(1800); mark("library preview");
await click("#replay"); await page.waitForFunction(() => document.getElementById("replay-note").textContent.length > 0, null, { timeout: 15000 }); await pause(2800); mark("replay");
await giveAndWait(1); await pause(1800); mark("library guessed");

// 5. Switch roles: Jev gives the clues.
await click("#mode-guesser"); await page.waitForFunction(() => !document.getElementById("ask").disabled, null, { timeout: 15000 }); await pause(1200); mark("guesser mode");
await click("#ask");
await page.waitForFunction(() => !document.getElementById("open-clue").hidden || document.querySelectorAll("#log li").length > 0, null, { timeout: 120000 });
await pause(2600); mark("clue asked");
const clue = (await page.textContent("#open-clue"))?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const known = { china: "tea", evening: "night", camping: "tent", library: "book", rain: "umbrella", dark: "night", reading: "book", literature: "book", insect: "spider", bug: "spider", wild: "zoo", animal: "zoo", safari: "zoo", weather: "umbrella", sleep: "night", bedroom: "night", beverage: "tea", breakfast: "tea", coffee: "tea", hunting: "trap", fishing: "trap", mountain: "valley", landscape: "valley", nature: "valley", hiking: "valley", egypt: "desert", arctic: "desert", climate: "desert" };
const pick = known[clue];
if (pick && (await page.locator(".cardw.clickable", { hasText: new RegExp(`^${pick}$`, "i") }).count()) > 0) {
  await click(`.cardw.clickable:has-text("${pick}")`); mark(`guessed ${pick} for ${clue}`);
  await pause(1200);
  if (await page.locator("#pass").isVisible()) { await click("#pass"); mark("ended turn"); }
} else if (await page.locator("#pass").isVisible()) {
  await pause(800); await click("#pass"); mark(`passed on ${clue}`);
}
await page.waitForFunction(() => document.querySelectorAll(".cardw.heat").length > 0, null, { timeout: 15000 });
await pause(3800); mark("heat revealed");

await ctx.close();
await browser.close();
const file = fs.readdirSync("video").find((f) => f.endsWith(".webm"));
fs.renameSync(`video/${file}`, "video/codenames.webm");
fs.writeFileSync("video/marks.json", JSON.stringify(marks));
console.log("saved video/codenames.webm");
