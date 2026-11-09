# Visual verification

This is where clones usually die: the tool reports a flattering percentage and the reviewer stops looking.

## Seven gates

1. Structural completeness
2. Content, lawful assets, and loaded fonts
3. High-value geometry and computed styles
4. Full-page and major-section screenshot diffs at every required viewport
5. Micro-detail audit
6. Fresh independent review when supported
7. Regression after correction

## Machine triage bands

The default visual-diff bands are:

- **Pass candidate:** changed-pixel ratio ≤ 0.5%
- **Manual review:** > 0.5% and ≤ 2.0%
- **Fail:** > 2.0%, any missing viewport or region, or any dimension mismatch

Override with `--pass-ratio` and `--review-ratio`. A region whose width or height changes by more than 2px is a fail; smaller reflow is review. Pixel matching uses anti-aliasing tolerance.

Three gates are reported: full page, regions, and geometry. The machine gate is the worst of the three. `verify` exits `0` for pass, `1` for fail, and `2` for review; `--allow-review` accepts review in a pipeline that only wants hard failures. A tool error also exits nonzero, so a missing report can never look like a pass.

These bands direct attention; they do not create the final verdict. A wrong title wrap, missing gradient, incorrect CTA height, absent state, or visibly incorrect crop fails even when the global ratio is low.

## Geometry confidence

- Exact text match: eligible for measured comparison.
- Positional fallback: review only; never a pass.
- Missing target: fail.
- High-value control and alignment deltas: investigate above ±1px.
- Large section bounds: investigate above ±2px unless browser rounding is demonstrated.

## Triage like an expert

Correct in descending causal impact:

1. Loaded font, root type metrics, container width, and shared tokens
2. Section geometry and alignment
3. Text wrapping
4. Assets, intrinsic sizes, and crops
5. Background layers, masks, and pseudo-elements
6. Controls and interaction states
7. Micro-spacing and optical corrections

The order matters because upstream structure controls many downstream pixels. Fixing a font can repair every heading and button; fixing one shadow cannot.

## KEEP / FIX / RECHECK

After each round:

- **KEEP:** passes and has no shared-foundation dependency that changed
- **FIX:** contains confirmed measured drift, a missing region, or a failing region diff
- **RECHECK:** positional-only match, review-band difference, absent region evidence, or a previously passing region whose shared foundation changed this round

`verify` computes this classification into `verification/triage.json` and `triage.md`, orders the correction plan by causal priority, and names one next action. A positional match is never promoted to a measured comparison. Region crops are content-named, so renamed content is reported as a missing comparison instead of being compared by position.

Run at most five focused correction rounds. Stop earlier when all gates pass and every region is KEEP. If rounds no longer reduce meaningful error, record the concrete blocker in `.clone/lessons.md` rather than guessing.

## Final verdict

A clone is **Verified** only when every machine and manual gate passes. Otherwise the verdict is **Not verified**, with specific blockers and the evidence needed to resolve them.

The fidelity report always states the conclusion as **Not verified** until the manual gates are closed by a reviewer. A passing machine gate is a precondition, not a verdict.
