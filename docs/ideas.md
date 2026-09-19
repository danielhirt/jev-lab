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
