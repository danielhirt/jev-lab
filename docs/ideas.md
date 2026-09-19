# Ideas

Experiments worth running in this lab. Each one names the Jev slot, what stays in code, and how to tell whether it worked. The numbers cited come from the README findings (jev-1.13, 2026-09-17).

## 1. Rubrics for code standards where linters fall short

Added 2026-09-18.

A linter checks syntax and patterns. It cannot check meaning: whether a name is honest, whether a comment earns its place, whether a test asserts anything. Those checks now go to an LLM reviewer, which is slow, costs real money per PR, and words its verdict differently each run. Jev answers each one as a probability for about $0.00004 a call, with a measured std near 0.01, so a rule can sit in CI without flapping.

**Shape.** Code splits the diff into hunks and builds the state: the hunk, enough surrounding code to judge it, the PR's stated purpose, and the text of the relevant standard. One call per hunk fans out every rubric question as a noul. Code applies the thresholds and posts comments.

**Candidate rubric questions**

- Does the comment explain why, or does it restate the code?
- Does the function name describe what the body does?
- Does this `catch` or error branch discard the error without logging or rethrowing?
- Does the test assert behavior, or does it only run the code?
- Does the hunk contain a change unrelated to the PR's stated purpose? (`examples/pr-triage.json` already asks this at PR level.)
- Does the hunk add an abstraction with one caller?
- Does the new code follow the idiom of the code around it?
- Does the hunk add a TODO, a commented-out block, or debug output?
- Per-repo standards as plain text in `state.standards`, one noul per rule.

**Code decides.** Above 0.85, post the comment. Between 0.3 and 0.7, pass the hunk to an LLM reviewer or a person; the findings show borderline answers cross a 0.5 cutoff on repeat calls, so a hard gate must never sit inside that band. Below 0.3, stay silent. A blocking check should average three calls.

**What could sink it**

- Jev reads literally (the paraphrase finding). A rubric question must define its terms, and the standard's text must be in the state.
- Nobody has measured Jev on code. The docs' examples are all prose.
- State size limits and cost on large diffs are unknown.

**First experiment.** Write `examples/code-review.json` with one real hunk and the questions above, then run `bun run lab ask examples/code-review.json -n 20` for stability. Next, label 50 to 100 hunks from past reviews in my own repos and measure precision at the 0.85 cutoff, with `compare` against Haiku as the baseline. A rubric that holds up belongs in truthsayer's rubric JSON, which already has the `Judge` trait for it.

## 2. Jev plays Balatro

Added 2026-09-18. A vault note on this is being written in a separate session; this entry is the lab's copy.

Balatro is a fair test of "code owns the workflow, the model supplies common sense". The scoring math is exact and belongs in code. The judgment calls are fuzzy, closed-set, and frequent: which joker fits this build, whether to discard for a flush or play the pair now, whether to skip a blind for its tag. No labelled data exists for them, which is the case Jev claims to cover.

**Split**

| Code | Jev |
| --- | --- |
| Enumerate legal plays and discards (at most 218 subsets of an 8-card hand) | Choose among the top few candidates when expected scores are close |
| Score each play exactly: chips, mult, joker order | Score each shop item for fit with the current jokers and deck |
| Track deck contents and draw odds | Noul: is this build committed enough to pay for a reroll? |
| Drive the game | Choice: skip the blind for the tag, or play it? |

Jev does not know Balatro's rules. The state has to carry each joker's full text, the blind's effect, hands and discards left, and money. Code computes every number it can and puts it in the state, so Jev judges with the figures in front of it.

**Harness.** A mod that exposes game state and accepts actions over a socket. `balatrobot` is the known candidate; check that it still works with the current game version before building on it.

**Measure.** Run fixed seeds. Compare ante reached and win rate for four players: random, greedy (always the highest-scoring play, always the cheapest joker), Jev, and Haiku 4.5 given the same questions through `compare`. Log every decision with its probabilities so a lost run can be traced to the judgment that lost it. Cost per run should be well under a cent; record it.

**Why it is worth the time.** It tests long-horizon play built from single-step judgments, which the prose scenarios in this lab cannot. It also yields a public demo that people will watch.

**Assessment 2026-09-19.** A good portfolio piece, a weak capability demo. Cost, latency and repeatability are invisible in a turn-based game. Most of the judgment calls above are expected-value arithmetic (draw odds times payoff against hands left, marginal chips and mult over the next N hands) and belong in code by this lab's own rules. The one Jev-shaped question, joker synergy, is multi-hop ("adds mult per club held, deck is club-heavy, the other joker retriggers held cards"), which section 7 of how-jev-works lists as a bad fit. An LLM-only arm will likely win on ante reached, the only axis a viewer sees, and seed variance means separating arms needs hundreds of runs through a Lua mod. If built anyway: an LLM states a build intent once per ante, Jev scores each shop item against `plan.intent` in one hop (policy in the state), code does every number, and the HUD shows the probabilities and the run's total cost. Run the offline decision-level eval (logged shop and discard decisions, a lookahead bot as ground truth, Jev vs Haiku vs greedy on accuracy, Brier score, stability and cost) before any live player. Idea 3 is the recommended demo instead.

## 3. Jev as Codenames spymaster

Added 2026-09-19 as the shareable demo in place of idea 2. The selection rule: pick a game where one of Jev's properties is the mechanic the viewer sees. Calibration as visible risk, fan-out as visible breadth, cost as visible scale. Codenames maps all three.

**Split**

| Code | LLM | Jev |
| --- | --- | --- |
| Hold the board: 25 words, each word's team, revealed state | Propose candidate clues for the current friendly words (tens to hundreds per turn) | For each candidate clue, 25 nouls in one call: does `clue` relate to `board[i]`? |
| Score each clue: count friendly words above the act threshold, require assassin below a hard floor and opponent words below a softer one | Nothing else; it never sees the scores | Guesser mode: the same 25 nouls over the opponent's clue, ranked |
| Pick the clue and number, log every probability, render the heatmap | | |

The scoring rule is the whole design. A clue is eligible only if `P(assassin)` is below a floor set by how costly that mistake is (losing the game), and it is ranked by how many friendly words sit above the act threshold. The uncertain band from section 5 of how-jev-works becomes a game rule: a word between 0.3 and 0.7 is not counted toward the clue's number.

**Why each property shows**

- **Fan-out.** 25 judgments per call at one latency; 200 candidate clues is 5,000 judgments for about a cent, in seconds. Per-judgment chat calls cannot do this live.
- **Calibration.** The assassin is a hard threshold on a probability. A spymaster that knows what it does not know never gives a clue sitting at 0.4 on the black word. The heatmap after each clue makes the number visible.
- **Consistency.** Same board, same clue, same numbers (std ~0.01 measured), so a viewer can argue with a specific decision and it replays.
- **Interactive.** People play as guessers against it in a browser. That spreads better than a video of a bot.

**What could sink it**

- Jev is unmeasured on word association. Clue relatedness is fuzzier than the policy checks in this lab's scenarios, and it reads literally (the paraphrase finding). The instruction has to define "relate" the way Codenames players use it: a competent guesser would connect them, not a dictionary would.
- Multi-word sense. "Bank" against RIVER and MONEY is the whole game; a noul per word handles it (each is an independent judgment), but nobody has checked whether Jev's numbers track human guessing.
- A clue that is a substring or inflection of a board word is illegal; that is a code check, not a question.

**Measure.** Offline first, before any UI. Public Codenames datasets from the Codenames AI research line carry human clues with the words guessed for them. For each clue, ask the 25 nouls and check (a) whether the words humans guessed rank above the words they did not, (b) Brier score against guessed or not, (c) std across 20 repeats on the assassin word, (d) the same via `compare` against Haiku 4.5 at temperature 0, with cost and latency. The gate: better than chance on (a) by a clear margin, and an assassin threshold that holds across repeats.

**First experiment.** Write `examples/codenames.json` with one board, one clue, and 25 nouls; run `bun run lab ask examples/codenames.json -n 20` for stability, then `perturb` for the literal-reading risk. If that holds, a `codenames` scenario in `src/scenarios.ts` that loads boards and clues from a dataset file and reports the four measures above.

**Alternatives considered** (kept as fallbacks): a "beat the gatekeeper" jailbreak game, guardrails made playable Gandalf-style with the tripping probabilities shown after each attempt; and a split-screen live firehose classifier, Jev against a chat model with backlog and cost meters, which is the clearest 30-second clip but a dashboard rather than a game.
