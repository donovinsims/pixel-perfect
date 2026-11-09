# Topology and component contracts

This is where clones usually die: a builder receives a screenshot and fills the missing facts with familiar frontend defaults.

## Page topology

Produce an ordered map before implementation: header, announcement, hero, content sections, CTA, footer, and overlays. Mark each region as static, sticky, overlapping, shared-background, or interaction-driven. Every item needs build and QA status.

## Component contract

Use `templates/component-spec.md` for each substantial region. Evidence must cover source location, screenshots and region crops, content, assets, DOM shape, geometry, typography, colors, background layers, borders, radii, shadows, gradients, pseudo-elements, responsive behavior, observed states, dependencies, and acceptance criteria.

Derive type, spacing, color, radius, and surface values from `evidence/tokens.md` and the region observation, not from framework defaults. Name the crop file and observation key a builder should inspect when two values disagree.

Missing evidence means investigate. It is never permission to approximate.

## Worked example

**Weak spec**

> Hero with centered heading, paragraph, and blue CTA. Use responsive Tailwind spacing.

This describes a category, not the source. A hundred different pages satisfy it.

**Evidence-backed spec**

- Source selector: `main > section:nth-of-type(1)`
- Viewports: desktop 1440, tablet 768, mobile 390
- Container: 1184px max width; 32px desktop side padding; 24px tablet; 20px mobile
- Heading: measured family and loaded font file; 64/68 desktop, 48/52 tablet, 38/42 mobile; wraps after “teams” at 768
- Copy column: 624px desktop; centered; 20/30 body type
- CTA: 47px height, 18px inline padding, 11px radius, 14/20 medium label
- Background: two radial gradients plus blurred `::before`; no solid-color substitute
- Image: original aspect ratio, `object-fit: cover`, crop anchored 42% 50%
- States: CTA hover darkens fill and raises shadow; focus uses 2px ring; active translates 1px
- Acceptance: heading wraps identically at all viewports; CTA geometry within 1px; background layers visually present; no section dimension mismatch

The second spec transfers truth. The first transfers guesswork.

## Parallel work

Foundations can regress every section. Freeze fonts, tokens, container rules, controls, and breakpoints before parallel work. Give each builder only its relevant frozen contract and artifacts. Assemble centrally, then run controlled verification.
