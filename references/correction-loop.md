# Correction loop

This is where clones usually die: corrections are made from memory, previously passing regions regress unnoticed, and “done” means the last screenshot looked acceptable.

## One round, four artifacts

Run:

```bash
pixel-perfect-clone verify --source .clone --clone-url "http://localhost:3000"
```

One round produces:

| Artifact | Use |
| --- | --- |
| `verification/fidelity-report.md` | Full-page, region, and geometry gates |
| `verification/triage.md` | KEEP / FIX / RECHECK per region, correction plan |
| `verification/triage.json` | Machine-readable status, cause, priority, evidence |
| `verification/geometry-report.json` | Measured deltas and style mismatches |

`pixel-perfect-clone triage --source .clone` recomputes triage from the existing round without recapturing.

## Status meanings

| Status | Meaning | Allowed action |
| --- | --- | --- |
| **KEEP** | Measured clean, identity confirmed, no foundation change | Do not touch. Evidence is required before editing a KEEP region |
| **FIX** | Confirmed drift: missing region, out-of-band pixels, or measured bounds/style difference | Correct in priority order |
| **RECHECK** | Positional-only match, review-band difference, absent region evidence, or a KEEP region invalidated by a foundation change | Re-measure or re-decide; never treat as a pass |

A region without a clone counterpart is `FIX` with cause `structural`. A region paired only by position is `RECHECK` with cause `identity`; positional agreement is not evidence of correctness.

## Causes and priorities

Triage assigns a cause and a correction priority. Work top-down.

| Priority | Cause | Typical evidence |
| ---: | --- | --- |
| 1 | `structural` | Region missing from the clone |
| 2 | `foundation` | Font family/size/weight, line-height, letter-spacing, padding, or gap mismatch |
| 3 | `geometry` | Bounds, radius, color, or surface style mismatch |
| 4 | `assets` | Region screenshot unavailable for comparison |
| 5 | `visual` | Changed-pixel ratio outside the pass band |
| 6 | `identity` | No text, id, or heading match; positional comparison only |

Fixing a font can repair every heading and button on the page; fixing one shadow cannot. The plan exists to enforce that order.

## Foundation signature

Each viewport records a foundation signature built from the body type metrics, page background, and every region's font family, size, line-height, and width.

Across rounds:

- signature unchanged and region measured clean → **KEEP** stays;
- signature changed and previously KEEP → **RECHECK**, because the shared foundation that justified the earlier pass no longer holds.

This is what makes “the report was green last round” insufficient. Re-run verification after foundation work instead of assuming stability.

## Region evidence

Region crops are named from measured content. Two consequences:

- a region whose text changed gets a different crop name, so it is reported as missing rather than silently compared;
- a region present only in the clone appears in `sections-report.json` as `extra`, which is evidence of invented content.

A region crop that cannot be produced (zero-size or out-of-bounds) is a missing comparison, not a pass.

## Round limit and stopping

- At most five focused rounds.
- Stop when every region is KEEP, every machine gate passes, and the manual gates in the fidelity report are closed.
- If rounds stop reducing error, record the concrete blocker in `.clone/lessons.md` and stop.
- Never convert a blocker into a threshold change. Threshold changes belong in `references/visual-verification.md` with a reason.

## Reusable lesson format

```markdown
## <viewport> — <region>
- Symptom:
- Root cause:
- Evidence (file, delta, ratio):
- Correction:
- Verification after correction:
- Reusable rule:
```
