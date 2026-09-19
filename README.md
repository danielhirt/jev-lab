# jev-lab

Experiments on TypeSafe's **Jev**, a "System One" decision model: you send a `state` and a map of typed questions, and it returns one calibrated, structured answer per question. Code owns the workflow; Jev supplies narrow judgments. This repo is a Bun workspace with one package per experiment.

| Package | What it is |
| --- | --- |
| [`packages/lab`](packages/lab) | The original CLI: determinism, perturbation, and calibration checks on Jev through OpenRouter, plus a Haiku 4.5 comparison arm. Findings in its README and [`docs/how-jev-works.md`](docs/how-jev-works.md). |
| [`packages/codenames`](packages/codenames) | A Codenames spymaster and guesser built on the direct TypeSafe API. The public demo: Jev's fan-out, calibration, and consistency as visible game mechanics. |

Shared docs live in [`docs/`](docs): the model contract and findings, and the ideas backlog.

## Setup

```sh
bun install
bun run typecheck
bun test
```

Per-package commands run from the root:

```sh
bun run lab -- --help           # packages/lab, needs OPENROUTER_API_KEY
bun run codenames -- --help     # packages/codenames, needs TYPESAFE_API_KEY
```

Add a package by creating `packages/<name>` with its own `package.json` and a `tsconfig.json` that extends `../../tsconfig.base.json`.
