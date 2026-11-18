# Pixel Perfect v4 implementation status

This matrix records the requirements recoverable from the interrupted request and the current follow-up task. The original v4 specification ended mid-requirement, so this is not a substitute for its missing text. Status describes source inspection only unless a test result is explicitly recorded.

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Preserve and audit the existing implementation | Implemented; checkpoint is the preserved working tree | Starting `HEAD` is `153f79f`. At audit start, all 25 modified tracked files and six added files remained in the working tree; no reset, restore, commit, push, or branch change was performed. Recheck `git status` before handoff. |
| Bounded route discovery and explicit scope | Implemented, unverified | `lib/discover.mjs` and `scripts/discover.mjs` include navigation/sitemap discovery, robots handling, limits, route IDs, and coverage output. Browser fixture assertions exist. Verify redirects, robots group semantics, route/depth truncation, and external scope behavior by running the fixture. |
| Multi-page route capture and route-aware comparisons | Implemented, unverified | `scripts/capture-source.mjs`, `lib/core.mjs`, `lib/verify.mjs`, and `scripts/compare-geometry.mjs` carry route IDs/paths. A persisted capture profile includes `browserVersion`; a replay helper now strips that annotation before strict profile validation. Run multi-route capture and verify fixtures. |
| Design-system JSON, Markdown, and CSS export | Implemented, unverified | `lib/design-system.mjs` and `scripts/export-design.mjs` export observed tokens, layouts, heading styles, component signatures, and provenance. No export has been executed or visually inspected in this environment. |
| Fail-closed visual, section, geometry, and evidence-integrity gates | Implemented, unverified | `lib/verdict.mjs`, `lib/visual.mjs`, and `lib/evidence.mjs` check missing/duplicate/extra coverage, checksums, required artifacts, and symlinks. New checks and fixture cases are present but not run. |
| Finalization and explicit human review | In progress; source checks strengthened, unverified | Finalization now recomputes gates from the serialized report, binds it to the current manifest capture timestamp/source, checks full route/region coverage, and requires an N/A reason to match a listed limitation. Needs CLI and end-to-end verification. |
| Interaction-state CSS URL sanitization | Implemented, unverified | State observations use URL cleanup for CSS URLs in `lib/observe.mjs`; unit and browser-fixture regression cases were added. |
| Asset request-failure URL redaction | Implemented, unverified | `lib/observe.mjs` retains only a safe network error code or generic failure text. Unit coverage was added. |
| Deterministic multi-page end-to-end verification and false-verification rejection | Implemented in test source, unverified | `tests/fixture-test.mjs` now verifies an exported two-route fixture and rejects a report with an inconsistent section gate. No browser run has occurred. |
| Completion-state lifecycle management | Incomplete | Current code writes final-verdict JSON/Markdown, but there is no broader completion-state history or handoff lifecycle beyond that report. Clarify against the missing original v4 text if it is recovered. |
| Human-friendly handoff package with working preview, rebuild instructions, and completion report | Missing / not generated | No reconstruction project or preview has been run, and no actual handoff package or completion report has been produced. The existing fixture is a test target, not a validated user-facing preview. |
| `npm ci`, doctor, unit tests, Playwright fixtures, final full suite | Unverified / blocked by tooling | This environment exposes project file and Git tools but no terminal or command-execution tool. Do not claim these checks passed. Run `npm ci`, `npm run doctor`, and `npm test` in a Node 20 environment with Playwright Chromium installed. |
| Version, lockfile, changelog, and compatibility | Unverified; intentionally unchanged | Package/tool version remains 3.0.2, lockfile unchanged, manifest remains v3 with additive fields. Do not bump versions or present the unreleased notes as validated until the full suite passes and compatibility is tested. |

## Required validation before claiming completion

1. Run `npm ci`, `npm run doctor`, and `npm test` under Node 20 with Chromium installed; preserve and diagnose every failure.
2. Confirm route discovery scope/robots behavior and multi-route capture/verification on the deterministic local fixture.
3. Confirm `export-design` produces inspectable JSON, Markdown, and CSS from the captured route set.
4. Confirm `finalize` remains pending for incomplete gates, rejects stale/inconsistent machine reports and failed integrity, and only emits `VERIFIED` when every machine and human gate passes.
5. Produce and inspect a real handoff directory with reusable design documentation, a working preview, rebuild steps, and a completion report.
6. Re-run the entire suite after any final edits and review the final Git diff. Keep all changes uncommitted unless separately authorized.
