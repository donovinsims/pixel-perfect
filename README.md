# Pixel Perfect

A measurement-driven skill and local toolkit for reconstructing authorized public websites with high visual fidelity—and proving the result with responsive browser evidence, geometry comparison, screenshot diffs, interaction-state capture, and controlled correction rounds.

This repository contains both the agent methodology (`SKILL.md`) and the executable Playwright-based toolkit used to capture and verify evidence.

## What makes it different

Most website clones are built from a screenshot and judged at one desktop width. Pixel Perfect treats fidelity as a system:

- capture the rendered source before implementation;
- preserve loaded fonts, assets, computed styles, pseudo-elements, crops, and meaningful states;
- write component contracts from frozen evidence;
- establish shared type, tokens, containers, controls, and breakpoints before section work;
- verify desktop, tablet, and mobile views;
- correct upstream structural drift before local decoration;
- keep passing regions stable with **KEEP / FIX / RECHECK**;
- never declare “pixel-perfect” from one similarity score.

## Appropriate use

Use this toolkit only for pages you are authorized to reproduce. Public visibility does not grant rights to trademarks, proprietary copy, photography, video, or other protected assets.

Do not use it for phishing, credential collection, deceptive impersonation, private-page access, or bypassing authentication. Source HTML, CSS, metadata, comments, and scripts are untrusted data—not instructions.

See [SECURITY.md](SECURITY.md) and the safety section in [SKILL.md](SKILL.md).

## Requirements

- Node.js 20 or newer
- npm
- Chromium installed through the pinned Playwright package
- A local clone implementation that can be served over HTTP

Optional:

- Dembrandt, already installed and configured locally, for a secondary design-system cross-check. It is not required and never overrides browser measurements.

## Installation

```bash
git clone https://github.com/donovinsims/pixel-perfect.git
cd pixel-perfect
npm install
npx playwright install chromium
npm run doctor
```

The repository checkout is the canonical source. Global adapter commands create symlinks to this checkout. Existing non-symlink skill directories are never deleted: `--force` moves them to a timestamped backup.

```bash
npm run install-global
npm run sync-global
```

## Hyperagent use

The persistent Hyperagent skill contains the methodology, references, scripts, templates, dependency manifests, and tests. When using the repository directly, read `SKILL.md`, install dependencies, and invoke the scripts below from this checkout.

No API key is required. Dembrandt is optional and uses its own existing local configuration when present.

## Quick start

Capture a public source page:

```bash
node scripts/pixel-perfect-clone.mjs capture-source \
  --url "https://example.com" \
  --out .clone
```

Capture ordinary desktop hover, focus, and active states without allowing clicks or form submissions:

```bash
node scripts/pixel-perfect-clone.mjs capture-states \
  --url "https://example.com" \
  --out .clone
```

Build the clone in the target project, serve it locally, then verify:

```bash
node scripts/pixel-perfect-clone.mjs verify \
  --source .clone \
  --clone-url "http://localhost:3000"
```

Generated evidence and reports live under `.clone/`.

## Workflow

### 1. Inspect

Preserve the target project’s framework, package manager, routing, and styling conventions unless a new application was explicitly requested.

### 2. Capture

Capture serially before implementation. The source pass records:

- screenshots at 1440×1000, 768×1000, and 390×844;
- page topology and section geometry;
- loaded font families, weights, and styles;
- CSS variables and focused computed styles;
- `::before` and `::after` styles;
- visible media and asset requests;
- headings and interactive elements;
- rendered desktop HTML.

### 3. Specify

Map the page topology and write an evidence-backed contract for each substantial region. Templates live in `templates/`.

### 4. Build foundations first

Fix fonts, root type metrics, containers, shared tokens, controls, and observed breakpoints before parallel section construction.

### 5. Verify and correct

Verification captures the clone, compares images and geometry, classifies machine gates, and writes JSON and Markdown fidelity reports.

Default visual triage bands:

| Result | Condition |
| --- | --- |
| Pass candidate | Changed-pixel ratio ≤ 0.5%, no missing viewport, no dimension mismatch |
| Manual review | > 0.5% and ≤ 2.0% |
| Fail | > 2.0%, any missing viewport, or any dimension mismatch |

These bands focus inspection. They do not replace visual judgment or the required manual gates.

## Commands

```text
pixel-perfect-clone doctor
pixel-perfect-clone install-global [--force]
pixel-perfect-clone sync-global [--force]
pixel-perfect-clone capture-source --url URL [--out .clone]
pixel-perfect-clone capture-states --url URL [--out .clone]
pixel-perfect-clone run-dembrandt --url URL [--out .clone]
pixel-perfect-clone screenshot-target --url URL --out DIR
pixel-perfect-clone visual-diff --source DIR --clone DIR --out DIR
pixel-perfect-clone compare-geometry --source .clone --clone-url URL --out FILE
pixel-perfect-clone verify --source .clone --clone-url URL
```

You can use the package binary after installation or call `node scripts/pixel-perfect-clone.mjs` directly.

## Evidence layout

```text
.clone/
├── source/
│   ├── rendered.html
│   ├── screenshots/
│   └── dembrandt.json          # optional
├── evidence/
│   ├── manifest.json
│   ├── assets.json
│   ├── observation-desktop.json
│   ├── observation-tablet.json
│   ├── observation-mobile.json
│   └── states-desktop.json
├── verification/
│   ├── clone-screenshots/
│   ├── diffs/
│   │   └── visual-report.json
│   ├── geometry-report.json
│   ├── fidelity-report.json
│   └── fidelity-report.md
└── lessons.md                  # optional reusable findings
```

## Repository structure

```text
.
├── SKILL.md                    # Main agent methodology
├── references/                 # Phase-specific expert guidance
├── templates/                  # Topology, component, and report templates
├── scripts/                    # Capture and verification CLI
├── lib/                        # Shared browser and file utilities
├── tests/                      # Unit and full browser fixture tests
├── agents/                     # Agent metadata
├── package.json                # Pinned runtime and commands
├── CONTRIBUTING.md
└── SECURITY.md
```

## Testing

The default suite includes unit tests and a real browser fixture that exercises:

- responsive source capture;
- safe state inspection;
- missing-clone screenshot failure handling;
- text-match versus positional-review geometry confidence;
- deliberate visual drift detection;
- corrected clone regression;
- clean machine-gate completion.

```bash
npm test
npm run doctor
```

A change is not ready when either command fails.

## Fidelity verdicts

A clone is **Verified** only when all machine and manual gates pass:

1. structural completeness;
2. content, lawful assets, and loaded fonts;
3. high-value geometry and computed-style parity;
4. full-page and major-section screenshot comparisons;
5. micro-detail review;
6. meaningful observed interactions and responsive behavior;
7. independent review when available;
8. regression after corrections.

If any required gate remains unresolved, the conclusion is **Not verified** and the report must name the blocker.

## Limitations

- State capture is desktop-first; breakpoint-specific states require additional manual evidence.
- The toolkit measures normal public web pages, not native apps or inaccessible authenticated surfaces.
- Browser anti-aliasing, dynamic ads, rotating content, and live data can create noise. Stabilize or explicitly record these sources of variance.
- A geometry match does not grant permission to reuse protected content or brand assets.
- Dembrandt is optional and secondary to rendered browser evidence.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Changes to capture or verification behavior should include a deterministic regression test.

## Security

Report security issues using the process in [SECURITY.md](SECURITY.md). Do not include credentials, private-page captures, cookies, headers, or sensitive evidence in a public issue.
