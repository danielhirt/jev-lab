# wavelength

A Wavelength round on TypeSafe's Jev. You see the hidden target. Jev does not. One request places every clue on the spectrum as a Score, and code measures the distance.

The Score question is the whole model call. The two poles and five level descriptions are the rubric. The target never enters the state.

## Keys

Bun loads `.env` from the directory you run in. `.gitignore` already ignores `.env` and `.env.*`. Put the key in `packages/wavelength/.env` and do not paste it into a chat:

```sh
TYPESAFE_API_KEY=...
# optional: JEV_MODEL=jev-latest
```

If `packages/codenames/.env` already has `TYPESAFE_API_KEY`, copy that file here. Restart the server after changing it. `OPENROUTER_API_KEY` is the lab CLI's key and is not read by this package.

## Run

From `packages/wavelength`:

```sh
bun run src/cli.ts deal 7
bun run src/cli.ts score --seed 7 mustard pastrami
PORT=3200 bun run server/index.ts    # http://localhost:3200
```

From the repo root, `bun run wavelength -- deal 7` deals a round. Scoring and the server still want the package `.env`, so run those from `packages/wavelength`.

The page deals with no key. Scoring returns a clear error until `TYPESAFE_API_KEY` is set. Add up to eight clues and score them in one request. Score again to see the largest change. The rubric on the page is the criteria Jev was given; it stays collapsed so a clue can be written from the poles alone.

Points are a code rule on the distance between Jev's expected level and the target: 4 within 0.35, 3 within 0.75, 2 within 1.25, 1 within 2, otherwise 0. Confidence is how peaked the five probabilities are, not whether the clue hit.

## What would tell us it works

On one spectrum, clues aimed at opposite poles should land apart, and the same clues scored again should barely move. That check is `score` run twice on a fixed seed. No threshold is tuned yet; the bands above are a starting rule, not a measured one.
