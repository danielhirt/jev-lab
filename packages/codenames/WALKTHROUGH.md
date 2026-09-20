# Walkthrough: check the demo by hand before publishing

About 15 minutes. Each step says what to do and what you should see. A step fails if you do not see it; note the step number and stop there. Numbers from Jev move by a few hundredths between runs, so ranges are given, not exact values.

## 0. Start

1. Put both keys in `packages/codenames/.env` (gitignored):
   ```
   TYPESAFE_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```
2. From the workspace root: `bun install --frozen-lockfile`, then `bun run typecheck && bun test`. Expect no type errors and 43 tests passing.
3. From `packages/codenames`: `PORT=3100 bun run server/index.ts`. Expect `codenames on http://localhost:3100 (judge full, proposer claude)`. If it says `proposer wordlist`, the Anthropic key was not read.
4. `curl localhost:3100/api/config`. Expect `"proposer":"claude-opus-5"`, `"baseline":"claude-haiku-4-5"`, and `"eval"` with `"clues":300`.

## 1. The header

Open `http://localhost:3100/?seed=7&mode=spymaster`.

- The line under the title reads: on 300 clues from real human games, Jev's top pick was the human's guess 69% of the time; Claude Haiku 4.5 matched 60%; chance is 4%.
- "How it was measured" opens the README's results section on GitHub. Check the link resolves after you push.

## 2. You give clues, Jev guesses (seed 7)

1. Type `horse` and do not submit. The board colors in within about half a second of your last keystroke. SADDLE, the assassin, is the darkest card at 0.90 or above. TRACK, FIELD and IRON are hatched (uncertain band). The note under the input names the round trip (150 to 500 ms) and a cost near $0.00015.
2. Type `canyon`. VALLEY is at 0.80 or above. DESERT is hatched, between 0.30 and 0.70.
3. Set the number to 2 and click "Give clue". Jev guesses VALLEY, it turns green, and Jev stops at one guess. The log reads `CANYON 2: valley 0.8x`. Status: 8 agents left, 8 turns left.
4. Type `saddle`. The clue is refused as a board word and nothing is judged.

## 3. Side by side with a chat model

1. Tick "Ask Claude Haiku 4.5 the same question, side by side" and type `rain`. Every card gains a second number (`vs 0.xx`). After 2 to 4 s the strip shows two rows with latency, cost and uncertain-band counts, and a sentence of the form "Jev answered N× faster at M× lower cost". Expect N between 5 and 20 and M near 15.
2. Click "Replay the judgment". A note reports the largest change for each model. Jev's is usually 0.02 to 0.09. Haiku's is often 0.000 and sometimes 0.1 to 0.2. Either result is fine; the page makes no claim about which is steadier.
3. Untick the box, set the number to 1, give `rain`. Jev guesses UMBRELLA.

## 4. Jev gives clues, you guess (seed 11)

1. Click "Jev gives clues, I guess", set the seed to 11 and press Enter. The board has KITE top left and no numbers on any card.
2. Click "Ask Jev for a clue". Verdicts stream into the feed within 3 to 5 s, each either `CLUE n → targets` or `rejected:` with a reason that names a word and a number. Rejections for the assassin name KITE at above 0.30; rejections for a bystander name a word above 0.55.
3. After 5 to 10 s a clue appears. On this seed it is for two words on most runs (SAILOR, BOAT, CARPENTER, POWERPOINT, CRICKET have all come up). A one-word clue is not a failure; ask on seeds 23 and 7 as well and expect a clue for two or more words on at least one of the three.
4. The pipeline strip reads: `claude-opus-5 proposed 30 to 50`, some dropped as illegal, `Jev judged N clues × 25 words`, a total of 4 to 10 s and $0.01 to $0.02. Under it: "The judging alone: Jev took about 1 s and about $0.005. The same N calls to Claude Haiku 4.5 ... come to about 6 to 10 s and $0.06 to $0.10: 13× the cost." Check the arithmetic once: N × $0.0020 should equal the dollar figure.
5. Tap the cards you think the clue means. A right card turns green and the turn stays open until you have found the number; a wrong one ends the turn. Then the board shows Jev's numbers, and the log names the words it meant with their probabilities (each 0.70 or above).

## 5. Limits and failure paths

1. Click "New board" quickly about twelve times. Expect "slow down: too many new boards at once", then normal service after a few seconds.
2. Stop the server, type a clue. The note under the input shows "Failed to fetch" and the page does not hang. Start the server again and reload; a new board deals.
3. In a private window, open the page at phone width (or use the device toolbar at 390 px). One column, no sideways scroll, the board above the controls. Switch the OS or browser to dark mode and check the cards are still readable.

## 6. The recording

Play `docs/codenames.mp4` (73 s). Check: the caption never covers a card; the header shows 300, 69% and 60%; the comparison strip appears at about 0:26; the replay note at about 0:33; the guesser turn ends with two green cards. `docs/spymaster.gif` loops HORSE then CANYON.

## 7. Before you publish

- Rotate both API keys. The ones in `.env` on 2026-09-19 were pasted into an agent chat.
- `git status` shows no `.env` and nothing under `data/` except `README.md`.
- Decide the host; `HANDOFF.md` has the settings (`TRUST_PROXY=1`, `NODE_ENV=production`). Run steps 1 to 5 once more against the public address, and check that the rate limit in 5.1 keys on your address and not the proxy's.
