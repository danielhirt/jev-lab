# How Jev works

Jev is TypeSafe's "System One" model. It is not a chat model and it does not generate text. You hand it a piece of state and a set of typed questions about that state, and it returns one constrained answer per question with a probability distribution attached. This document explains the model's contract, how to call it through OpenRouter, how to write questions it answers well, and what we measured.

Sources: the [TypeSafe docs](https://docs.typesafe.ai) (build guide, primitives, confidence, jaggedness pages, consistency cookbooks) and our own runs in this repo on 2026-09-17 against `jev-1.13-20260917`.

## 1. The mental model

TypeSafe's framing is "code owns the workflow, the model answers narrow judgments". An agent picks its own next step and every step can fail. A System One model never picks a step. Your code decides what to ask, sends the relevant facts, gets back numbers, and branches on them. The model is a function from `(state, question) -> distribution over the answer schema`, and nothing else.

That gives three properties a chat model cannot promise:

- **Type safety.** The answer is always inside the schema you supplied. There is no JSON to parse out of prose and no invented option.
- **Calibrated probabilities.** Every answer carries the full distribution, so "I don't know" is a number you can threshold, not a phrase you have to detect.
- **Self-consistency.** Repeated evaluations return close to the same numbers. Not bit-identical (see section 6), but tight enough that a threshold decision rarely moves.

## 2. The request

```json
{
  "model": "~typesafe/jev-latest",
  "state": { "...": "..." },
  "questions": {
    "some_id": { "type": "noul",   "instructions": "...", "criteria": { "true": "...", "false": "..." } },
    "other_id": { "type": "choice", "instructions": "...", "criteria": { "opt_a": "...", "opt_b": "..." } },
    "third_id": { "type": "score",  "instructions": "...", "criteria": ["level 0", "level 1", "level 2"] }
  }
}
```

**State** is the material the model judges: a string, a JSON object, or an array. Use an object for anything with more than one part so each piece has a name. Questions refer to parts of the state by backticked path, for example `` `ticket.message` `` or `` `orders[0].charges` ``. All questions in a request see the same state and are evaluated independently and in parallel, so one call with twenty questions costs about the same latency as one call with one.

**Question ids** are yours. Answers come back under the same ids. The id itself is not shown to the model.

### The three question types

| Type | Asks | Returns |
| --- | --- | --- |
| `noul` | a yes/no question | `noul`: P(yes) in [0, 1] |
| `choice` | pick one option from a set | `choice`: the argmax option, `probabilities`: one per option, `confidence` |
| `score` | rate against ordered levels | `score`: probability-weighted level, `probabilities`: one per level, `legend`, `confidence` |

`criteria` is optional for noul (descriptions of what yes and no mean), required for choice (option -> description) and score (ordered list of level descriptions, at least two).

### The response

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "some_id":  { "type": "noul", "noul": 0.92 },
    "other_id": { "type": "choice", "choice": "opt_a", "probabilities": { "opt_a": 0.85, "opt_b": 0.15 }, "confidence": 0.82 },
    "third_id": { "type": "score", "score": 1.6, "legend": { "0": "level 0", "1": "level 1", "2": "level 2" },
                  "probabilities": { "0": 0.05, "1": 0.30, "2": 0.65 }, "confidence": 0.78 }
  },
  "usage": { "input_tokens": 402, "output_tokens": 73, "cost": 0.000017 }
}
```

`confidence` is a statistic derived from the distribution's shape (concentrated means high, flat means low). Noul answers do not carry one; the noul value itself is the signal.

## 3. Calling it through OpenRouter

- **Endpoint:** `POST https://openrouter.ai/api/alpha/decisions`. This is OpenRouter's "Decisions" router, a separate surface from chat completions. Sending a chat request to the model returns a 500.
- **Model id:** `~typesafe/jev-latest`. The tilde is part of the id; it is OpenRouter's marker for a "latest" alias. At the time of writing it resolves to `typesafe/jev-1.13-20260917`. The model does not appear in `GET /api/v1/models`.
- **Auth:** the usual `Authorization: Bearer $OPENROUTER_API_KEY`.
- **Strings only.** TypeSafe's native API accepts JSON structure inside `instructions` and `criteria` (a `{question, focus, examples}` object, for example). OpenRouter's adapter validates those fields as plain strings and returns a 400 otherwise. `flattenQuestions` in `src/client.ts` stringifies anything structured before sending.
- **Limits:** 32k tokens of context per request. Text only.
- **Price:** $0.042 per million input tokens, $0 output. A 14-question call over a one-page JSON state costs about $0.00004.

A minimal call:

```sh
curl -s https://openrouter.ai/api/alpha/decisions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "~typesafe/jev-latest",
    "state": "Help! My payouts have been failing for 3 days.",
    "questions": {
      "is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"}
    }
  }'
```

## 4. Writing questions it answers well

The docs' single most important idea is **decomposition**: one broad question hides several judgments; several atomic questions expose them so code can inspect, weight, and combine. "Is this spam?" becomes six nouls (requests credentials, unexpected reward, time pressure, sender mismatch, link mismatch, disguised link) and a weighted sum in code.

Practical rules, most of them from the jaggedness page:

1. **Write the literal condition.** Jev answers the question you wrote, not the one you meant. Scoping words and negations are read at face value. If you find yourself explaining what you really meant, that explanation is the missing half of the instruction.
2. **Put the policy in the state, not the question.** Ask "does `pr` fall under `policy.requires_two_reviewers`?" and let the model compare two parts of the state, rather than restating the rule inside the instruction.
3. **Keep arithmetic, counting, and date comparison in code.** It reads dates as text and does not count reliably. Extract components with a choice over a closed set, then compute.
4. **Send only what the question needs.** Accuracy falls as unrelated detail grows. Filter in code first.
5. **Align criteria with the instruction.** A noul whose `true` description means "no" confuses it.
6. **Do not rely on structural invariants.** A noul and its negation need not sum to 1. A noul and a yes/no choice of the same question return different numbers. Do not carry a threshold from one to the other.
7. **Give choices an explicit "none of these" option** when that is a real outcome. A choice is relative (which option wins); a noul is absolute (is this one true at all). Use both when you need both.
8. **Do not use it to generate.** Extraction becomes a choice over candidates that code or regex found first.

## 5. Using the numbers

Three patterns, all decided in code:

**Confidence-gated routing.** Split confidence into act / confirm / escalate bands, with the band boundaries set per action by how costly a mistake is.

```ts
if (topic.confidence < 0.75) return humanReview(ticket);
if (topic.choice === "billing") return billing(ticket, { refund: refund_requested.noul >= 0.7 });
```

**Composite scoring.** Weighted sum of atomic nouls, with weights you own.

```ts
const spamRisk = 0.45 * requests_credentials.noul + 0.30 * sender_mismatch.noul + 0.25 * unexpected_reward.noul;
if (spamRisk > 0.4 && spamRisk < 0.6) return humanReview(ticket); // explicit uncertain band
```

**Speculative fan-out.** Ask every question you might need in one call and let the branch that runs read the ones it cares about. The unused answers cost fractions of a cent.

## 6. What we measured

All runs in this repo, `jev-1.13-20260917` via OpenRouter, 2026-09-17. Scenarios are lifted from TypeSafe's own docs so the numbers compare directly with their cookbooks.

| Scenario | Questions | Repeats | Mean per-question std | Questions whose label ever flipped |
| --- | --- | --- | --- | --- |
| triage (support ticket) | 1 choice, 5 nouls, 1 score | 20 | 0.002 | 0 / 7 |
| claim (insurance) | 14 nouls | 20 | 0.013 | 2 / 14 |
| moderation (borderline post) | 8 choices | 20 | 0.017 | 2 / 8 |
| pr-triage (custom) | 1 choice, 4 nouls, 1 score | 5 | 0.007 | 0 / 6 |

TypeSafe's cookbook reports 0.0102 on the same claim rubric.

- **Repeatability is tight, not exact.** Adding a throwaway nonce field per call did not widen the spread, so the variance is inherent to inference rather than a cache effect.
- **The flips are on real borderline cases.** `claim.covered` (a track-day exclusion versus a parking-lot collision) ranged 0.38 to 0.52 across 20 calls and crossed 0.5 six times. `moderation.primary_risk` split 12/8 between Violence and Harassment. This is what the uncertain band in section 5 is for.
- **Semantic perturbations barely move it.** Reordering JSON keys, doubling whitespace, and sending the state as a JSON string shifted clear answers by under 0.05. A paraphrase that made a refund request more explicit moved `refund_requested` from 0.31 to 0.85, which is the literal reading in rule 1 above, not noise.
- **Against Claude Haiku 4.5 at temperature 0** (nonce on both, n=10, claim rubric): Jev mean std 0.010 versus Haiku 0.033, with one Haiku question swinging between 0.1 and 0.95. Haiku was 6× slower (1.7 s versus 0.3 s median) and about 55× the cost per call. The two disagreed on the three genuinely borderline questions; Haiku answered them at 0.85 or 0.15 with zero spread, Jev sat near 0.5. That is the calibration claim in one table: the chat model is confidently wrong where Jev is honestly unsure.
- **Latency through OpenRouter** is 250 to 400 ms median, not the ~100 ms the docs quote for the direct API. p90 rose past 1 s under 8-way concurrency.

## 7. Where it fits

A cheap, calibrated classifier over a closed set. Good fits: routing and triage, guardrails on LLM input and output, re-ranking retrieved passages, gating which answers reach a bigger model, review-depth decisions, anything currently done by "ask an LLM for a yes/no and parse it". Bad fits: generation, arithmetic, date logic, open-ended reasoning, or anything with more than one hop of indirection.
