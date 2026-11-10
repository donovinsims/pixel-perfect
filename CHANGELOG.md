# Changelog

## 3.0.2 — 2026-11-10

A documentation patch: the release procedure itself is now part of the released tree, so a release can be cut from the repository alone.

### Added

- **Release runbook.** `AGENTS.md` §12 documents the version bump, changelog shape, pull-request and `Tests` gate, annotated tag creation through the GitHub integration, release publication, tarball verification, and the rules against moving published tags or storing credentials.

### Changed

- `--version`, `doctor`, and new manifests report `3.0.2` (`lib/core.mjs`, `package.json`; `package-lock.json` root version synced).
- "Definition of done" is now §13; no other section moved.

### Upgrade notes

- No runtime, CLI, or evidence-format change. Manifests still use version `3`, and existing 3.0.0/3.0.1 evidence directories remain valid.

## 3.0.1 — 2026-11-10

A documentation patch: the released tree now carries the agent-facing guides that explain how the toolkit is wired, and the tool identifies itself as the patched build.

### Added

- **`AGENTS.md`.** Operating manual for AI agents and new engineers: non-negotiable rules, repository map, evidence and manifest contracts, gate and triage algorithms, testing and CI behavior, change recipes, a debugging table, and a definition of done.
- **`docs/architecture.md`.** Module-level reference: command dispatch and exit codes, capture sequence, observation contract, comparison and triage internals, visual diff, evidence hashing, adapters, coupling map, and known constraints.
- **README pointer.** A "Working on this repository" section links both guides.

### Changed

- `--version`, `doctor`, and new manifests report `3.0.1` (`lib/core.mjs`, `package.json`).
- `package-lock.json` root version now matches the package; it had remained at `2.0.0` since that release.

### Fixed

- `pixel-perfect-clone --version` prints the version instead of the usage text; the implicit `help` command was being handled first.

### Upgrade notes

- No runtime, CLI, or evidence-format change. Manifests still use version `3`, and existing 3.0.0 evidence directories remain valid. Recapture only if you want new manifests stamped `3.0.1`.

## 3.0.0 — 2026-11-09

A verification release: the toolkit now measures regions, classifies correction work, and makes the frozen baseline tamper-evident.

### Added

- **Region evidence.** `capture-source` and `capture-clone` slice every measured region out of the stored full-page screenshot into `sections/<viewport>/<region>.png`, with `sections-<viewport>.json` metadata. Crop names derive from id, heading, or measured text so source and clone crops align by content, not position.
- **Mechanized triage.** `verify` writes `triage.json`/`triage.md` with KEEP / FIX / RECHECK per region, a cause (`structural`, `foundation`, `geometry`, `assets`, `visual`, `identity`), causal priority, an ordered correction plan, and a single `nextAction`. A foundation signature invalidates previous KEEP status when shared type or container facts change between rounds.
- **`triage` command.** Re-classify the last verification round offline, without recapturing the clone.
- **Design-token extraction.** `evidence/tokens.json` + `evidence/tokens.md` report measured colors, type scale, spacing, radii, borders, shadows, background layers, CSS variables, declared media queries, observed transitions, loaded font faces, and a token fingerprint. `extract-tokens` regenerates the report from an existing bundle.
- **Tamper-evident manifests.** Manifest v3 records SHA-256 checksums and byte sizes for every source artifact. `evidence-check` verifies them; `verify --require-frozen` refuses to score a modified baseline.
- **Region gate.** The fidelity report and machine gate now include a section-level comparison in addition to the full-page and geometry gates.
- **Custom viewports.** `--viewports desktop,tablet,mobile,1024` or `WIDTHxHEIGHT` captures and verifies additional widths; `1024` is named `w1024`.
- **Configurable thresholds.** `--pass-ratio` and `--review-ratio` override the documented 0.5% / 2.0% bands with validation.
- **`capture-clone` command.** One browser pass produces clone screenshots, observations, and region crops for comparison.
- **`--max` for `capture-states`** and per-viewport state files (`states-<viewport>.json`).

### Changed

- Source capture and clone comparison share one observation implementation (`lib/observe.mjs`), so region selection, style keys, and text extraction cannot drift apart.
- `compare-geometry` can run offline against a captured clone bundle (`--clone DIR`) and reuses the same region matching as triage. `--clone-url` still captures first, for compatibility.
- `visual-diff` reports region comparisons via `--source-sections`/`--clone-sections` and classifies results against the bands.
- `verify` exits `0`/`1`/`2` for pass/fail/review instead of always exiting `0`; `--allow-review` restores pass-through behavior for review.
- Manifest version is now `3`, with tool version metadata and capture warnings.
- `doctor` reports the tool version; `--version` prints it.
- `run-dembrandt` fails with a clear message when the optional Dembrandt binary is absent.
- Text extraction inserts word boundaries between adjacent inline elements and skips unrendered nodes, fixing concatenated slugs such as `HomePricing`.

### Fixed

- A verification failure no longer exits successfully, so CI and scripts can detect it.
- Region diffs no longer pass when a clone region is missing or its crop name does not match.
- A positional-only region match is classified RECHECK and cannot be reported as a pass.
- Section dimension drift is distinguished from sub-pixel reflow (2px tolerance).
- `sample`/`extract-tokens`-style regressions are covered by unit tests.

### Upgrade notes

- Evidence directories from 2.x have no region crops, token report, or checksums. Recapture with `capture-source` before expecting 3.x section gates and triage.
- `visual-diff --source`/`--clone` still accept flat screenshot directories. Region comparison is opt-in via the section flags (or automatic inside `verify`).
- Existing global skill symlinks continue to work; run `npm run sync-global` after upgrading a checkout.
