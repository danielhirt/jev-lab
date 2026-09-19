# Handoff: Codenames on Jev

Last updated 2026-09-19, main at the commit that adds this file. Written for whoever picks this up next, human or agent.

## Where it stands

Built, tested, and verified against the live TypeSafe API:

- **Engine** (`src/`): seeded boards (two-team and cooperative), clue legality, the 26-question judge request, the four-threshold policy and scorer, a replay cache, a spymaster turn that proposes, filters, judges every candidate against every word, and picks, with a second proposal round before passing.
- **Phase 0 eval** (`eval/`): on 100 human clues from the SALT-NLP Codenames Duet corpus, guess AUC 0.94, target AUC 0.95, top-1 agreement with the human guess 0.64 (chance 0.04), repeat std 0.012, 298 ms median, $0.00014 per request. Table in the README. The gate is passed; do not re-run it to decide anything, only to tune thresholds.
- **Web app** (`server/`, `web/`): both modes, live heatmap while typing, replay with the largest-change readout, streaming verdict feed during Jev spymaster turns, chat-model side-by-side toggle, light and dark, phone layout, PNG turn card, per-IP rate limits, keys server-side.
- **Recording** (`docs/codenames.mp4`, `docs/spymaster.gif`, `docs/record.mjs`): a 50 s scripted session on seed 7. The script already has captions and the comparison beats; the committed video predates both.
- 42 unit tests, no network. `bun run typecheck && bun test` from the workspace root.

Not yet exercised live, because this environment had no Anthropic key:

- `ClaudeProposer` (guesser mode with a real proposer; the wordlist fallback ran instead).
- `ClaudeBaseline` (the side-by-side toggle; the server hides it when no key is configured).
- The captioned, comparison-including re-record.

## Keys

`TYPESAFE_API_KEY` for Jev, `ANTHROPIC_API_KEY` for the proposer and the comparison arm. Nothing in this repo contains a key and nothing should. The TypeSafe key used during the build was pasted into a chat session and should be treated as exposed; rotate it if that has not been done.

## Finish the demo, in order

1. `export TYPESAFE_API_KEY=... ANTHROPIC_API_KEY=...` and `PORT=3100 bun run server/index.ts`. `curl localhost:3100/api/config` must show `"baseline": "claude-haiku-4-5"` and `"proposer": "claude-opus-5"`.
2. Play guesser mode on a few seeds. With the Claude proposer, clues for two and three words should appear routinely; the wordlist fallback mostly produced ones. If proposals are poor, the prompt is `SYSTEM` in `src/proposer.ts`; the model never sees Jev's numbers, by design.
3. Turn on the comparison toggle in spymaster mode and try HORSE, CANYON, RAIN, LIBRARY on seed 7. The strip states measured facts (latency, cost, uncertain-band counts, replay deltas). Read what it says before recording; do not script a claim the numbers do not make on that board. If the chat model happens to be well calibrated on a clue, that is the honest result.
4. Re-record: from a directory with `playwright-core` installed and `PLAYWRIGHT_BROWSERS_PATH` pointing at a Chromium build, `bun run docs/record.mjs` (it navigates to `localhost:3100`). Convert with ffmpeg:
   ```sh
   ffmpeg -i video/codenames.webm -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart -an docs/codenames.mp4
   ffmpeg -ss 2 -t 15.5 -i video/codenames.webm -vf "fps=8,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" docs/spymaster.gif
   ```
   Check a few frames before committing; the last recording was checked at 7 s, 14 s, 30 s, and 46 s.
5. Host it. A single Bun process; set `TRUST_PROXY=1` behind a reverse proxy so the rate limits key on the real client address. Set `NODE_ENV=production` so Bun serves the bundled page without dev rebundling.

## After that, worth doing

- **Baseline in the eval.** `ClaudeBaseline` is a `Judge`, so `eval/run.ts` can score it on the same 100 human clues with a `--judge baseline` flag (not written yet). That gives the comparison a number, not just a strip: expect the pattern from jev-lab's earlier work, where the chat model was confident where Jev was honestly unsure.
- **Threshold tuning.** `assassinMax` 0.10 is stricter than human play (assassin p90 was 0.42 on human clues, with Duet's three assassins). The cooperative board has one assassin and fifteen bystanders, so `opponentMax` 0.40 is the constraint that most often forces a pass. Tune on the cached judgments, which cost nothing to rerun.
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
- **Playwright** is not installed in the repo. The scripts use `playwright-core` with `executablePath` pointing at a Chromium build.

## File map

See the README's Layout section. The state machine is `server/session.ts` (pure, tested); `server/index.ts` is only HTTP. The policy is `DEFAULT_THRESHOLDS` in `src/types.ts` and nowhere else.
