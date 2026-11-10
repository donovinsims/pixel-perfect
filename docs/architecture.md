# Architecture

Module-level reference for the Pixel Perfect toolkit. For rules and recipes, read
[`AGENTS.md`](../AGENTS.md) first; for the human-facing usage guide, read
[`README.md`](../README.md); for the cloning methodology, read [`SKILL.md`](../SKILL.md).

---

## 1. Shape of the system

```text
scripts/*.mjs          thin CLI entry points: parse args, call lib, print, set exit code
        │
        ▼
lib/*.mjs              all behavior; pure where possible, browser-bound only in
                       observe / capture / core.settle
        │
        ├── playwright (Chromium, pinned 1.61.1)
        ├── pixelmatch (per-pixel diff)
        └── pngjs (decode, crop, encode)
```

- ESM only, no build step, no transpilation.
- `lib/verdict.mjs` and most of `lib/sections.mjs` and `lib/tokens.mjs` are pure functions
  over plain JSON, which is why they are unit-testable without a browser.
- Browser work is isolated to `lib/core.mjs` (`loadBrowser`, `stablePage`, `settle`),
  `lib/observe.mjs` (in-page evaluation), and `lib/capture.mjs` (orchestration).
- Entry scripts never contain domain logic. They translate argv into options, call a `lib`
  function, print a human summary, and let thrown errors become exit code 1.

---

## 2. Command dispatch

`scripts/pixel-perfect-clone.mjs` parses argv once and dispatches:

| Command | Module | Required options | Writes |
| --- | --- | --- | --- |
| `doctor` | inline | — | stdout JSON only |
| `install-global`, `sync-global` | inline | `--force` optional | symlinks under agent homes |
| `capture-source` | `capture-source.mjs` | `--url` | `.clone/source`, `.clone/evidence` |
| `capture-clone` | `capture-clone.mjs` | `--url`, `--out` | clone screenshots, observations, crops |
| `screenshot-target` | alias → `capture-clone.mjs` | same | same |
| `capture-states` | `capture-states.mjs` | `--url` | `evidence/states-<viewport>.json` |
| `visual-diff` | `visual-diff.mjs` | `--source`, `--clone`, `--out` | diff PNGs + report JSON |
| `compare-geometry` | `compare-geometry.mjs` | `--source`, `--out`, one of `--clone`/`--clone-url` | geometry report JSON |
| `verify` | `verify-clone.mjs` | `--source`, `--clone-url` | full `verification/` tree |
| `extract-tokens` | `extract-tokens.mjs` | `--source` | `tokens.json`/`tokens.md` |
| `evidence-check` | `evidence-check.mjs` | `--source` | stdout JSON |
| `triage` | inline → `lib/verify.mjs` | `--source` (default `.clone`) | `triage.json`/`triage.md` |
| `help`, `--version` | inline | — | stdout |

Shared options: `--viewports`, `--pass-ratio`, `--review-ratio`, `--allow-review`,
`--require-frozen`, `--force`, `--max` (states only).

Argument parsing (`parseArgs`): `--key value`, `--key=value`, or a boolean flag; positionals
land in `_`. Unknown options are not rejected — every command reads only what it needs.

Exit codes:

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `verify` | pass | fail or thrown error | review (unless `--allow-review`) |
| `evidence-check` | integrity ok | integrity failed or error | — |
| everything else | success | thrown error only | — |

`visual-diff` and `compare-geometry` intentionally exit 0 when they *measure* differences;
they are reporters, not gates. Only `verify` gates.

---

## 3. Capture path

```text
captureTarget({ url, views, captureHtml })
  └─ for each viewport, serially:
       stablePage(browser, viewport)      new context: DSF 1, light, reduced motion
       trackAssets(page)                  response/requestfailed listeners (image/font/CSS/media)
       settle(page, url)                  domcontentloaded → networkidle (10s cap)
                                          → document.fonts.ready → pending images
                                          → two rAFs → scrollTo(0, 0)
       observePage(page)                  one page.evaluate(observeDocument, STYLE_KEYS)
       page.screenshot({ fullPage: true, animations: "disabled" })
       desktop only: page.content()       when captureHtml
       close context
```

Serial capture is deliberate: two viewports racing one source browser produces
nondeterministic layout and font timing. Do not parallelize this loop.

`writeSourceBundle` then:

1. writes `source/screenshots/<viewport>.png` and `source/rendered.html`;
2. writes `evidence/observation-<viewport>.json`;
3. crops regions into `source/sections/<viewport>/<slug>.png` (`sectionRecords` →
   `clampRect` → `cropPng`) and writes `evidence/sections-<viewport>.json`;
4. extracts tokens from all observations → `evidence/tokens.json` + `tokens.md`;
5. writes `evidence/assets.json`;
6. hashes everything under `source/` and `evidence/` (except the manifest itself) →
   `evidence/manifest.json`.

`writeCloneBundle` reuses the same crop and observation code but writes to the clone
directory and omits the manifest, tokens, and HTML.

Warnings are collected, not thrown: no detected regions, or unreadable cross-origin
stylesheets. Both end up in `manifest.warnings`.

---

## 4. Observation contract

`lib/observe.mjs` exports:

| Export | Contract |
| --- | --- |
| `STYLE_KEYS` | 50 computed-style properties measured for elements and pseudo-elements |
| `INTERACTIVE_SELECTOR` | `a,button,input,select,textarea,[role=button],[role=tab],summary` |
| `observePage(page)` | `page.evaluate` of `observeDocument`; returns the observation JSON |
| `trackAssets(page)` | attaches listeners before navigation; returns a `Map<url, asset>` |

`observeDocument` runs inside the page and is serialized as a function, so it must not close
over Node scope. It uses:

- `boxOf(element, inDocument)` — rounded rect, optionally plus scroll offset;
- `textOf(element)` — text-node walk with boundary spaces, skipping script/style/noscript
  and unrendered subtrees;
- `styles(element, pseudo)` — all `STYLE_KEYS` from `getComputedStyle`;
- `selectorOf` — `#id`, else `tag.class1.class2.class3`;
- `roleOf` — header/footer/nav by tag or ARIA role, else `main`;
- section heuristics described in `AGENTS.md` §6.3;
- CSSOM sweep: `:root`/`html` custom properties, `CSSFontFaceRule` descriptors, media
  queries with min/max widths, recursing up to depth 4.

Cross-origin sheets throw on `cssRules`; the count is recorded in `stylesheets.inaccessible`
and the sweep continues. This is expected, not an error.

---

## 5. Region identity and comparison

`lib/sections.mjs`:

- `sectionSlugs(sections)` — content-derived, deterministic, disambiguated by a 6-hex hash of
  the region basis when bases collide.
- `matchSections(source, clone)` — text → id → heading → index; `index` matches are marked
  `review`; unpaired source regions are `missing`; unpaired clone regions are `extra`.
- `compareObservations(source, clone)` — integer deltas per rect key, boolean match per
  `GEOMETRY_STYLE_KEYS`, `status: "measured"` or `"review"`.
- `foundationSignature(observation)` — 12-hex hash of page background, body type metrics,
  and each section's type metrics and width.
- `buildTriage(...)` — per-viewport classification, previous-round lookup, merged correction
  plan, `nextAction`, summary.

`lib/crops.mjs` is intentionally tiny: `clampRect` keeps a document-space rect inside the
image, `cropPng` uses `PNG.bitblt`. Cropping the stored screenshot (rather than
re-screenshotting the element) guarantees the crop matches what the full-page diff measured.

---

## 6. Visual comparison

`lib/visual.mjs`:

- `diffPng(sourceBuffer, cloneBuffer, { threshold: 0.1 })` — pads both images to the union
  size (padding is transparent and therefore counted as changed), runs pixelmatch with
  `includeAA: false`, `diffMask: true`, returns changed pixels, ratio, dimension mismatch,
  bounding box of differences, and the diff PNG. A missing clone image returns
  `missing: true, changeRatio: 1` — never a pass.
- `visualDiffFiles({ sourceDir, cloneDir, outDir, thresholds })` — iterates source PNGs,
  writes diff PNGs and `visual-report.json`, and classifies each viewport through
  `classifyVisualResult`.
- `sectionDiff(...)` — same, per viewport directory, additionally reporting `extra` clone
  crops and a per-viewport gate; writes `sections-report.json`.

The page background is not normalized; a transparent→white mismatch is a real difference by
design. Owners should stabilize the source rather than masking it.

---

## 7. Gates, report, exit codes

`lib/verdict.mjs` is pure:

| Function | Behavior |
| --- | --- |
| `classifyVisualResult(result, thresholds)` | missing / dimension mismatch → fail; ratio > review → fail; > pass → review; else pass |
| `classifySectionVisual(...)` | missing → fail; size delta > 2px → fail, 1–2px → review; ratio bands |
| `classifyGeometryComparison(...)` | missing → fail; xy > 1px, size > 2px, style mismatch, or positional match → review; else pass |
| `summarizeGate(statuses)` | fail > review > pass; empty list → pass (callers guard emptiness) |
| `exitCodeFor(gate, { allowReview })` | pass 0, fail 1, review 2 (0 with `--allow-review`) |
| `buildFidelityReport(...)` | combines three gates, forced `fail` when the visual report is empty, embeds triage summary and plan, keeps the constant "Not verified" conclusion |
| `renderReportMarkdown(report)` | tables for viewports, sections, geometry, plan, manual gates |

Manual gates are listed but never auto-checked: structural completeness, assets/fonts,
computed-style parity, micro-detail audit, interactions, independent review, regression.

---

## 8. Verification orchestration

`lib/verify.mjs`:

```text
verifyClone({ sourceDir, cloneUrl, views, thresholds, requireFrozen, capture })
  1. readManifest(sourceDir)                    → viewports come from the manifest
  2. if requireFrozen: verifyArtifacts(...)     → throw on missing/modified artifacts
  3. capture({ url: cloneUrl, views })          → one browser pass
  4. writeCloneBundle(verification/clone)       → screenshots, observations, crops
  5. visualDiffFiles(source/screenshots, clone) → verification/diffs
  6. sectionDiff(source/sections, clone/sections) → verification/sections
  7. per viewport: read observations, compareObservations → geometry-report.json
  8. writeTriageRound(...)                      → triage.json/triage.md (uses previous round)
  9. buildFidelityReport + render             → fidelity-report.json/md
```

`triageEvidence({ sourceDir })` skips steps 3–7 and reuses `verification/clone` plus the
existing `geometry-report.json` and `sections-report.json`. It throws if no round exists.

`writeTriageRound` is shared by both paths so `verify` and `triage` cannot produce different
classifications for the same inputs.

---

## 9. Tokens

`lib/tokens.mjs` aggregates computed styles across observations:

| Group | Source keys |
| --- | --- |
| colors | `color`, `backgroundColor` |
| backgrounds | `background`, `backgroundImage` (only when no image) |
| borders / radii / shadows | `border`, `borderRadius`, `boxShadow` |
| spacing | `padding`, `margin`, `gap`, `rowGap`, `columnGap`, split on whitespace, px-sorted |
| typography | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, plus a `size / lineHeight / weight` scale |
| fonts | loaded `document.fonts` entries and `@font-face` descriptors |
| breakpoints | declared media queries and per-section transitions between captured widths |

Noise values (`none`, `normal`, `auto`, `0px`, transparent, empty) are dropped. The
`fingerprint` hashes the ordered color/family/size/radius value lists, so it changes when the
measured design vocabulary changes.

---

## 10. Evidence integrity

`lib/evidence.mjs`:

- `buildManifest` walks `source/` and `evidence/` recursively, sorts paths, and records
  `{ path, bytes, sha256 }`. `evidence/manifest.json` is excluded (it cannot hash itself) and
  `verification/` is never walked, so verification does not invalidate the baseline.
- `verifyArtifacts` re-hashes every artifact, reports `missing` and `mismatched`, and returns
  `ok: false` for an empty artifact list.
- `readManifest` throws a normal ENOENT-derived error when the bundle is absent.

Tamper detection is deliberately blunt: any byte change fails. There is no "expected change"
allowlist; recapture instead.

---

## 11. Global adapters

`install-global` and `sync-global` share one implementation in
`scripts/pixel-perfect-clone.mjs`. Adapters and paths:

| Agent | Executable probe | Link target |
| --- | --- | --- |
| Claude Code | `claude` | `~/.claude/skills/pixel-perfect-clone` |
| Codex | `codex` | `~/.codex/skills/pixel-perfect-clone` |
| OpenCode | `opencode` | `~/.config/opencode/skills/pixel-perfect-clone` |
| Cursor | `cursor` | `~/.cursor/skills/pixel-perfect-clone` |

Link states: `canonical`, `other-symlink`, `non-symlink`, `missing`, `broken`. Only a
missing target is replaced by default; `--force` moves a non-symlink directory to
`<path>.bak.<timestamp>` before linking and removes other symlinks. No directory is deleted.
`doctor` reports the same state machine as JSON.

---

## 12. Testing architecture

| Layer | File | Scope |
| --- | --- | --- |
| Pure unit | `tests/unit.test.mjs` | parsing, viewports, matching, bands, triage, tokens, crops, diffs, hashing, report |
| Browser fixture | `tests/fixture-test.mjs` | real Chromium against `tests/fixture.html` on `127.0.0.1:0` |
| CI | `.github/workflows/test.yml` | `npm ci` → Chromium → `doctor` → `test`; failure evidence artifact |

The fixture mutates the served HTML through query flags, not by rewriting the file:

- `?drift` — shrinks the CTA radius (14px → 2px) and height (48px → 36px);
- `?textdrift` — changes the card heading text and its id, forcing positional matching.

Because the fixture spawns the real entry scripts, it asserts process exit codes and the
on-disk artifacts together. That is the contract users depend on.

Evidence retention: the fixture removes `.tmp-fixture/` only on a clean local pass. A thrown
assertion keeps it; `CI=1` keeps it even when green so CI can upload it.

---

## 13. Coupling map

| If you change… | Also update… |
| --- | --- |
| `STYLE_KEYS` | unit fixtures, token extraction expectations, contract docs |
| `GEOMETRY_STYLE_KEYS` / `FOUNDATION_STYLE_KEYS` | triage tests, `references/correction-loop.md` |
| gate bands or tolerances | `README.md` table, `references/visual-verification.md`, unit boundaries |
| manifest fields | `MANIFEST_VERSION`, readers, fixture assertions, `AGENTS.md` §6.2 |
| artifact paths | `lib/capture.mjs`, `lib/verify.mjs`, fixture, `README.md` evidence tree |
| section heuristics | `lib/observe.mjs`, fixture markup, missing-region tests |
| command set | dispatcher `usage`, `README.md`, `SKILL.md` commands, this table |
| retention behavior | fixture `finally`, CI artifact step, docs |

---

## 14. Known constraints

- State capture is desktop-first; pass `--viewports` to sweep another width.
- Declared media queries are not proof a breakpoint is used; observed transitions only exist
  between captured widths.
- Region identity is content-derived; a clone that renames every heading can only be matched
  positionally, which triage marks RECHECK and never a pass.
- Cross-origin stylesheets hide custom properties and media queries from the CSSOM sweep.
- Anti-aliasing, live data, and animated content add noise; bands focus inspection, they do
  not certify fidelity.
- Checksums prove the bundle is unchanged, not that the captured content is lawful to reuse.
