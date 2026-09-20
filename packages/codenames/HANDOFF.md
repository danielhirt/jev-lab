# Handoff: Codenames on Jev

Last updated 2026-09-19, main at the commit that adds this file. Written for whoever picks this up next, human or agent.

## Where it stands

Built, tested, and verified against the live TypeSafe API:

- **Engine** (`src/`): seeded boards (two-team and cooperative), clue legality, the 26-question judge request, the four-threshold policy and scorer, a replay cache, a spymaster turn that proposes, filters, judges every candidate against every word, and picks, with a second proposal round before passing.
- **Phase 0 eval** (`eval/`): on 300 human clues from the SALT-NLP Codenames Duet corpus, guess AUC 0.935, target AUC 0.950, top-1 agreement with the human guess 0.69 (chance 0.04); repeat std 0.012, 227 ms median, $0.00014 per request. The gate is passed.
- **Against a chat model** (`eval/run.ts --judge baseline`): Claude Haiku 4.5 on the same clues scores guess AUC 0.880 and top-1 0.60 at 1,674 ms and $0.0020 a call. Only Jev was right on 41 clues, only Haiku on 13. Haiku has the better Brier score (0.047 against 0.066) and repeats as steadily at temperature 0; the README says so and says why. Do not claim calibration or stability as Jev's edge. The claims the data supports are ranking, latency, and cost.
- **Thresholds** (`eval/tune.ts`, no spend): `assassinMax` 0.30 and `opponentMax` 0.55, set on what human guessers did on 1,506 cached clues. The old 0.10 and 0.40 rejected 98% of human clues with no gain in safety. Table and reasoning in the README.
- **Web app** (`server/`, `web/`): both modes, live heatmap while typing, replay with the largest-change readout, streaming verdict feed during Jev spymaster turns, chat-model side-by-side toggle, light and dark, phone layout, PNG turn card, per-IP rate limits, keys server-side.
- **Recording** (`docs/codenames.mp4`, `docs/spymaster.gif`, `docs/record.mjs`): a 73 s captioned session, spymaster mode on seed 7 and guesser mode on seed 11, recorded 2026-09-19 at 1280x1090 so the caption sits under the board.
- **Walkthrough** (`WALKTHROUGH.md`): the manual check to run before publishing. Every expectation in it was checked in a browser on 2026-09-19.
- 43 unit tests, no network. `bun run typecheck && bun test` from the workspace root.

Exercised live on 2026-09-19 with both keys:

- `ClaudeProposer` (`claude-opus-5`): 30 to 50 candidates per turn, 5 to 9 s and about $0.013 to $0.020 per turn including the judging. With the tuned ceilings, three of five seeds open with a clue for two or three words.
- `ClaudeBaseline` (`claude-haiku-4-5`) on seed 7 with HORSE, CANYON, RAIN, LIBRARY: Jev answered 8x to 17x faster (about 250 ms against 1.8 to 3.9 s) at about 14x lower cost. Haiku's numbers were close to Jev's on CANYON and LIBRARY. HORSE was the clear difference: Jev put six words in the uncertain band, Haiku one, with TRACK at 0.85 and IRON at 0.75. Replay does not favor Jev here: Haiku at temperature 0 often repeats exactly (0.000), and Jev's largest change ran 0.02 to 0.09. The recording's replay caption makes no claim for that reason.

## Keys

`TYPESAFE_API_KEY` for Jev, `ANTHROPIC_API_KEY` for the proposer and the comparison arm. Nothing in this repo contains a key and nothing should. Both keys in use on 2026-09-19 were pasted into a chat session and should be treated as exposed; rotate them before publishing.

## Finish the demo

To run it: put both keys in `packages/codenames/.env` (gitignored), then `PORT=3100 bun run server/index.ts` from `packages/codenames`. `curl localhost:3100/api/config` must show `"baseline": "claude-haiku-4-5"` and `"proposer": "claude-opus-5"`.

To re-record: copy `docs/record.mjs` into a directory whose `node_modules` holds `playwright-core` (Bun resolves the import from the script's own directory, not the working directory), set `CHROMIUM_PATH` to a Chromium binary, and `bun run record.mjs`. It writes `video/codenames.webm`. Convert with ffmpeg:

```sh
ffmpeg -i video/codenames.webm -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an docs/codenames.mp4
ffmpeg -ss 2 -t 15.5 -i video/codenames.webm -vf "fps=8,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" docs/spymaster.gif
```

Check a few frames before committing. The guesser beat runs on seed 11 and clicks cards only when the clue is in the script's `known` map; add the clue if a take ends in a pass.

What remains is the manual pass in `WALKTHROUGH.md`, then hosting. A single Bun process; set `TRUST_PROXY=1` behind a reverse proxy so the rate limits key on the real client address. Set `NODE_ENV=production` so Bun serves the bundled page without dev rebundling.

## After that, worth doing

- **A larger baseline run.** 300 clues settle the ranking question. A few thousand would let the README break the result down by clue number; about $2 per thousand clues.
- **`act` for guesser mode.** Only 7% of human clues have two friendly words at 0.70 or above by Jev's numbers, 12% at 0.60. Lowering `act` for the spymaster's count would give more multi-word clues, but the same number drives how many cards Jev turns over in the other mode, so split the two before touching it.
- **A vertical cut** of the recording for phone-first platforms; `docs/record.mjs` takes a viewport.
- **Vault note.** The project page in the second-brain vault (`wiki/projects/jev-lab.md`) mirrors this file's status; update both.

## Things that will bite you

- **Bun's HTML import** bundles `web/app.ts` and `web/styles.css` at request time in development. The server logs "Bundled page" on first hit. Restart the server after editing `server/` files; `web/` edits are picked up on reload.
- **Rate limits are per IP and in memory**: previews 20 burst then 4/s; new boards 10 then 0.5/s; Jev spymaster turns 6 then one per 3 s; baseline calls 10 then 1/s. Automated runs from one address hit them; the Playwright scripts deal a new board per shot.
- **Streaming ask:** `POST /api/games/:id/ask` with `Accept: text/event-stream` streams `start`, `candidate` events, and `done`. The turn keeps running if the client disconnects; the game state advances either way, and the client should `GET` the game on reload.
- **Cooperative boards** encode bystanders as the other team's kind so the scorer's opponent ceiling applies to all fifteen. `roleOf` in `server/session.ts` maps kinds to `agent`, `bystander`, `assassin` for views.
- **`first` for the baseline** is derived by normalizing its probabilities; Jev's comes from a real choice question. Only the nouls are compared like for like.
- **Dataset license.** SALT-NLP states none. Derived JSONL and judgment caches stay gitignored; `eval/salt.ts` regenerates them from a clone.
- **Killing the dev server by pattern** from a shell whose command line contains the same pattern kills the shell. Kill by port instead.
- **Playwright** is not installed in the repo. The scripts use `playwright-core` with `CHROMIUM_PATH` pointing at a Chromium build.
- **The Anthropic API returned 500 on two of 300 baseline rows** (clues "point" and "area") on every retry. `eval/run.ts` drops and counts such rows.
- **`data/` is empty on a fresh clone.** The eval, the tuning script and their caches need the SALT clone and about $0.25 of Jev calls; commands are in the README.
- **Bun's idle timeout** defaults to 10 s and cut off a non-streaming `ask` with the Claude proposer. `server/index.ts` sets `idleTimeout: 120`.

## File map

See the README's Layout section. The state machine is `server/session.ts` (pure, tested); `server/index.ts` is only HTTP. The policy is `DEFAULT_THRESHOLDS` in `src/types.ts` and nowhere else.
