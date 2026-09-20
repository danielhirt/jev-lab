# Handoff: Codenames on Jev

Last updated 2026-09-19, main at the commit that adds this file. Written for whoever picks this up next, human or agent.

## Where it stands

Built, tested, and verified against the live TypeSafe API:

- **Engine** (`src/`): seeded boards (two-team and cooperative), clue legality, the 26-question judge request, the four-threshold policy and scorer, a replay cache, a spymaster turn that proposes, filters, judges every candidate against every word, and picks, with a second proposal round before passing.
- **Phase 0 eval** (`eval/`): on 100 human clues from the SALT-NLP Codenames Duet corpus, guess AUC 0.94, target AUC 0.95, top-1 agreement with the human guess 0.64 (chance 0.04), repeat std 0.012, 298 ms median, $0.00014 per request. Table in the README. The gate is passed; do not re-run it to decide anything, only to tune thresholds.
- **Web app** (`server/`, `web/`): both modes, live heatmap while typing, replay with the largest-change readout, streaming verdict feed during Jev spymaster turns, chat-model side-by-side toggle, light and dark, phone layout, PNG turn card, per-IP rate limits, keys server-side.
- **Recording** (`docs/codenames.mp4`, `docs/spymaster.gif`, `docs/record.mjs`): a 67 s captioned session on seed 7 with the comparison beats, recorded 2026-09-19 at 1280x1060 so the caption sits under the board and never covers the bottom row.
- 42 unit tests, no network. `bun run typecheck && bun test` from the workspace root.

Exercised live on 2026-09-19 with both keys:

- `ClaudeProposer` (`claude-opus-5`): 30 to 50 candidates per turn, 5 to 9 s and about $0.013 to $0.020 per turn including the judging. The proposals are good; the thresholds reject most of the two-word ones (see Threshold tuning).
- `ClaudeBaseline` (`claude-haiku-4-5`) on seed 7 with HORSE, CANYON, RAIN, LIBRARY: Jev answered 8x to 17x faster (about 250 ms against 1.8 to 3.9 s) at about 14x lower cost. Haiku's numbers were close to Jev's on CANYON and LIBRARY. HORSE was the clear difference: Jev put six words in the uncertain band, Haiku one, with TRACK at 0.85 and IRON at 0.75. Replay does not favor Jev here: Haiku at temperature 0 often repeats exactly (0.000), and Jev's largest change ran 0.02 to 0.09. The recording's replay caption makes no claim for that reason.

## Keys

`TYPESAFE_API_KEY` for Jev, `ANTHROPIC_API_KEY` for the proposer and the comparison arm. Nothing in this repo contains a key and nothing should. The TypeSafe key used during the build was pasted into a chat session and should be treated as exposed; rotate it if that has not been done.

## Finish the demo

Steps 1 to 4 of the old list are done. To run it: put both keys in `packages/codenames/.env` (gitignored), then `PORT=3100 bun run server/index.ts` from `packages/codenames`. `curl localhost:3100/api/config` must show `"baseline": "claude-haiku-4-5"` and `"proposer": "claude-opus-5"`.

To re-record: copy `docs/record.mjs` into a directory whose `node_modules` holds `playwright-core` (Bun resolves the import from the script's own directory, not the working directory), set `CHROMIUM_PATH` to a Chromium binary, and `bun run record.mjs`. It writes `video/codenames.webm`. Convert with ffmpeg:

```sh
ffmpeg -i video/codenames.webm -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an docs/codenames.mp4
ffmpeg -ss 2 -t 15.5 -i video/codenames.webm -vf "fps=8,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" docs/spymaster.gif
```

Check a few frames before committing. The guesser beat clicks a card only when the clue is in the script's `known` map; add the clue if a take ends in a pass.

What remains is hosting. A single Bun process; set `TRUST_PROXY=1` behind a reverse proxy so the rate limits key on the real client address. Set `NODE_ENV=production` so Bun serves the bundled page without dev rebundling.

## After that, worth doing

- **Baseline in the eval.** `ClaudeBaseline` is a `Judge`, so `eval/run.ts` can score it on the same 100 human clues with a `--judge baseline` flag (not written yet). That gives the comparison a number, not just a strip: expect the pattern from jev-lab's earlier work, where the chat model was confident where Jev was honestly unsure.
- **Threshold tuning.** This is now the main limit on guesser mode. On seeds 7, 11 and 23 the Claude proposer offered sound two-word clues (CRUISE for ship and deck, CRICKET for bat and match, STREAM for river and fish) and the policy rejected nearly all of them: seed 11 lost every one to the assassin KITE at 0.11 to 0.16, seed 23 to bystanders at 0.48 to 0.65. One accepted two-word clue across the three boards (AFTERNOON 2). The ceilings are absolute, so they reject a clue whose risky word sits far below both targets and would never be reached in a run of two guesses; a ceiling relative to the weakest target is worth testing. `assassinMax` 0.10 is stricter than human play (assassin p90 was 0.42 on human clues, with Duet's three assassins). The cooperative board has one assassin and fifteen bystanders, so `opponentMax` 0.40 is the constraint that most often forces a pass. Tune on the cached judgments, which cost nothing to rerun.
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
- **Bun's idle timeout** defaults to 10 s and cut off a non-streaming `ask` with the Claude proposer. `server/index.ts` sets `idleTimeout: 120`.

## File map

See the README's Layout section. The state machine is `server/session.ts` (pure, tested); `server/index.ts` is only HTTP. The policy is `DEFAULT_THRESHOLDS` in `src/types.ts` and nowhere else.
