# codenames

A Codenames spymaster and guesser built on TypeSafe's Jev, through the direct API. The point is a public demo where each of Jev's properties is a visible game mechanic rather than a line in a README.

| Property | Where it shows |
| --- | --- |
| Fan-out | One request per clue carries 25 nouls and one choice. A spymaster turn judges every candidate clue against the whole board in seconds. |
| Calibration | The clue's number is the count of friendly words that clear the act threshold. The assassin has a hard ceiling. Words in the uncertain band are never counted. |
| Consistency | Same board, same clue, same numbers. Boards are seeded so any turn replays. |
| Code owns the workflow | Code deals the board, checks clue legality, sets every threshold, and picks the clue. Jev only answers "does this clue reach this word". |

## Layout

```
src/
  board.ts      seeded deal: 9 / 8 / 7 / 1, mulberry32 so a seed reproduces a board
  legality.ts   one word, not on the board, not a compound, not an inflection
  questions.ts  the state and the 26 questions sent per clue
  judge.ts      TypeSafeJudge (live) and CachingJudge (replay from disk)
  scorer.ts     thresholds -> number, targets, risks, rejections; pickClue; guessOrder
  cli.ts        `board <seed>` and `judge <clue> --seed <n>`
eval/
  dataset.ts    ClueRow, the JSONL row shape for human clue data
  salt.ts       converter for the SALT-NLP Codenames Duet data
  run.ts        the phase 0 gate: AUC, Brier, assassin, repeat std, latency, cost
  metrics.ts    pure metric functions
test/           unit tests; no network
data/           generated files, ignored by git (see data/README.md)
```

## The questions

State is small on purpose: a one-paragraph note on what a "connection" means in Codenames, the clue, and the unrevealed board words. Rules, arithmetic, and legality never go to the model.

Per clue, one request asks:

- **25 nouls**, one per word: would a typical guesser connect the clue to this word? The literal clue and word are in the instruction, and the criteria spell out what counts (meaning, category, common phrase, strong association) and what does not (a stretch, a pun, specialist knowledge). These are absolute, so a bad clue can score low everywhere.
- **1 choice** over the words: which word would a guesser pick first? This is relative and gives the guess order and a tie-break.

Both come from the docs' guidance to pair a choice (which one) with nouls (whether at all), and the jaggedness page's advice to reduce indirection and keep the state free of unrelated detail.

## The policy, in code

`DEFAULT_THRESHOLDS` in `src/types.ts` is the whole policy:

| Threshold | Default | Meaning |
| --- | --- | --- |
| `act` | 0.70 | A friendly word at or above this counts toward the clue's number and is guessed. |
| `uncertainLow` | 0.30 | Between here and `act` a word is uncertain: never counted, listed as a risk if it is not ours. |
| `assassinMax` | 0.10 | A clue with the assassin above this is rejected outright. |
| `opponentMax` | 0.40 | A clue with any opponent word above this is rejected. |

Among eligible clues, the score is the number, plus how far the targets clear `act`, minus half a point per risky non-friendly word. These defaults are a starting point; the eval below is what sets them.

## Phase 0: the gate

Before any UI, check that Jev's numbers track how people actually give and take clues. The data is the SALT-NLP Codenames Duet corpus (Shaikh et al. 2023): 7,703 human turns with the board, the clue, the giver's targets, the words they had to avoid, and the guess.

```sh
export TYPESAFE_API_KEY=...
git clone --depth 1 https://github.com/SALT-NLP/codenames /tmp/salt-codenames
bun run eval/salt.ts /tmp/salt-codenames data/salt-duet.jsonl
bun run eval/run.ts data/salt-duet.jsonl --n 100 --repeats 20 --repeat-rows 10
```

Pass criteria, set before the run: guess AUC and target AUC well above 0.5 (a random ranker scores 0.5), top-1 agreement with the human guess well above the 1-in-25 base rate, and a repeat std on the assassin small enough that `assassinMax` holds across repeats. Judgments cache in `data/cache-<model>-<style>.json`, so reruns with different thresholds are free; the stability repeats bypass the cache on purpose.

## Phase 0 results (2026-09-19, jev-1.13.0)

100 human clues sampled with seed 1, 20 repeats on 10 of them, both question wordings. The gate passed.

| metric | full wording | compact wording |
| --- | --- | --- |
| guess AUC (noul) | 0.941 | 0.940 |
| guess top-1, noul argmax | 0.64 | 0.64 |
| guess top-1, choice argmax | 0.63 | 0.63 |
| target AUC (noul) | 0.953 | 0.952 |
| Brier vs guessed | 0.069 | 0.079 |
| assassin noul mean / p90 | 0.215 / 0.420 | 0.244 / 0.430 |
| repeat std, all words | 0.012 | 0.015 |
| repeat std, assassin, mean / max | 0.011 / 0.018 | 0.012 / 0.021 |
| latency ms, median / p90 | 298 / 363 | 265 / 330 |
| input tokens per request | 3,247 | 1,537 |
| cost per request | $0.000136 | $0.000064 |

Reading it: a random ranker scores 0.5 AUC and 0.04 top-1, so Jev's per-word probability tracks both the giver's intent and the guesser's actual pick, and its single most likely word is the human's guess two times in three. Repeat std near 0.01 means a threshold decision moves only on words that sit within a hundredth of it. The assassin numbers describe the human clues, not Jev: Duet keys carry three assassins and human givers take real risks with them, so `assassinMax` at 0.10 would veto some clues people actually gave. That is the intended behavior for a spymaster that never loses on the assassin, and the eval is the place to tune it. `full` stays the default for its better calibration; `compact` is the flag to flip when cost or latency matters more.

## Trying it

```sh
bun run src/cli.ts board 7
bun run src/cli.ts judge river --seed 7
```
