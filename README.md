# jev-lab

A small CLI for poking at TypeSafe's **Jev** (a "System One" decision model) through OpenRouter, built to check the determinism and calibration claims in the [TypeSafe docs](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

Jev is not a chat model. You send a `state` (string or JSON) and a map of typed questions, and it returns one structured answer per question:

| Question | Returns |
| --- | --- |
| `noul` | P(yes) as a float |
| `choice` | the picked option, a probability per option, and a confidence |
| `score` | an expected level over an ordered rubric, a probability per level, and a confidence |

## Setup

```sh
export OPENROUTER_API_KEY=...
bun install
bun run lab --help
```

See [docs/how-jev-works.md](docs/how-jev-works.md) for the model contract, question-writing rules, and the full findings.

## Commands

```
bun run lab list
bun run lab probe    <scenario>             # one call, print answers + distributions
bun run lab ask      <file.json> [-n N]     # your own {state, questions}; see examples/pr-triage.json
bun run lab repeat   <scenario> -n 20       # N identical calls; per-question stability
bun run lab repeat   <scenario> -n 20 --nonce   # same, with a throwaway field so no request is byte-identical
bun run lab perturb  <scenario> -n 5        # original vs key-reordered / whitespace / paraphrase / stringified state
bun run lab compare  <scenario> -n 10       # Jev vs claude-haiku-4.5 at temperature 0, same questions
bun run lab route    triage -n 10           # the docs' confidence-gated triage rule, run over N calls
```

Scenarios: `triage` (mixed types, from the build guide), `claim` (14 nouls, from the consistency cookbook), `moderation` (8 choices, from the choice cookbook). Raw samples are written to `runs/`.

## OpenRouter specifics

- Endpoint: `POST https://openrouter.ai/api/alpha/decisions` with `{ model, state, questions }`. There is no chat-completions shim; a chat request to the model returns a 500.
- Model id: `~typesafe/jev-latest` (note the tilde). It resolved to `typesafe/jev-1.13-20260917` at time of writing.
- OpenRouter's adapter validates `instructions` and `criteria` as **strings only**. TypeSafe's native API also accepts JSON structure; `flattenQuestions` in `src/client.ts` stringifies anything structured.
- Pricing: $0.042 per million input tokens, output free. A 14-question call costs about $0.00004.

## Findings (2026-09-17, jev-1.13)

- **Tight, not bitwise, repeatability.** Across 20 repeats the mean per-question std of P(yes) was 0.002 on `triage`, 0.013 on `claim`, 0.017 on `moderation`. TypeSafe's own cookbook reports 0.0102 on the same claim rubric. Adding a nonce per call did not widen the spread, so this is inherent variance, not caching.
- **Borderline answers still cross thresholds.** `claim.covered` ranged 0.38 to 0.52 over 20 calls and flipped at a 0.5 cutoff 6 times. `moderation.primary_risk` split 12/8 between Violence and Harassment. The docs' fix is to treat the 0.3 to 0.7 band as "uncertain" and route it, which is a code decision, not a model one.
- **Semantic perturbations barely move it.** Reordering JSON keys, doubling whitespace, or sending the state as a JSON string shifted means by under 0.05 on clear questions. A paraphrase that made the refund request more explicit moved `refund_requested` from 0.31 to 0.85, which is the literal reading the jaggedness page warns about.
- **Versus Haiku 4.5 at temperature 0** (nonce on both, n=10, `claim`): Jev mean std 0.010 vs Haiku 0.033, with one Haiku question swinging between 0.1 and 0.95. Haiku was 6× slower (1.7 s vs 0.3 s median) and about 55× more expensive per call. The two models disagreed on the three genuinely borderline questions; Haiku answered them at 0.85 or 0.15 with no spread, Jev sat near 0.5.
- **Latency through OpenRouter** is 250 to 400 ms median, not the ~100 ms the docs quote for the direct API, and p90 rises past 1 s under 8-way concurrency.
