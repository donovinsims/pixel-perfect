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

- Unique exact id, normalized text, or heading match: eligible for measured comparison.
- Duplicate or competing identity candidates: ambiguous, with candidate indexes; review only.
- Positional fallback: review only; never a pass. Missing targets fail.
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
- **RECHECK:** positional-only/ambiguous match, review-band difference, or a previously passing region whose shared foundation changed this round
- **FIX:** missing section screenshot evidence (assets/evidence)

`verify` computes this classification into `verification/triage.json` and `triage.md`, orders the correction plan by causal priority, and names one next action. Positional and ambiguous matches are never promoted to measured comparisons. Region crop names are based on content and structure; when identity cannot be established, a positional geometry fallback is marked for review, and missing crops fail the region gate.

Run at most five focused correction rounds. Stop earlier when all gates pass and every region is KEEP. If rounds no longer reduce meaningful error, record the concrete blocker in `.clone/lessons.md` rather than guessing.

## Final verdict

A clone is **fully verified** only when every machine and manual gate passes. Otherwise it is not fully verified, even if a separate `ready_with_limitations` status is accepted for a documented, bounded exception; the verdict must name blockers and evidence needed to resolve them.

The machine fidelity report is not a final verdict. Run `finalize --source .clone` after human review; it rechecks the frozen bundle and reads `verification/manual-review.json`. The seven required gates default to pending. A `not_applicable` gate needs a reason plus a documented limitation. Final statuses distinguish `fully_verified`, `ready_with_limitations`, `manual_review_required`, `failed`, and `blocked`; only the first two exit 0.
