import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  DEFAULT_CAPTURE_PROFILE,
  DEFAULT_THRESHOLDS,
  MANUAL_GATES,
  captureProfileFrom,
  captureProfileFromManifest,
  parseArgs,
  publicSourceUrl,
  resolveViewports,
  routeAwareViewports,
  safeName,
  thresholdsFromArgs,
  viewportsFromManifest,
} from "../lib/core.mjs";
import { clampRect, cropPng } from "../lib/crops.mjs";
import { archiveBaseline, buildManifest, readManifest, verifyArtifacts, writeManifest } from "../lib/evidence.mjs";
import { buildDesignSystem, renderDesignSystemMarkdown, renderDesignTokensCss } from "../lib/design-system.mjs";
import { normalizeRouteUrl } from "../lib/discover.mjs";
import {
  buildTriage,
  compareObservations,
  foundationSignature,
  matchSections,
  sectionSlugs,
} from "../lib/sections.mjs";
import { detectTransitions, extractTokens, renderTokensMarkdown } from "../lib/tokens.mjs";
import {
  buildFidelityReport,
  classifyGeometryComparison,
  classifySectionVisual,
  classifyVisualResult,
  exitCodeFor,
  finalizeVerdict,
  summarizeGate,
} from "../lib/verdict.mjs";
import { diffPng } from "../lib/visual.mjs";
import { verifyClone } from "../lib/verify.mjs";
import { HANDOFF_DOCUMENTS, generateHandoff } from "../lib/handoff.mjs";
import { buildEvidenceBinding, readProjectState, recordProjectStatus, resolveDeliveryStatus, statusFromVerdict } from "../lib/lifecycle.mjs";
import { snapshotInteractiveState, trackAssets } from "../lib/observe.mjs";

const BASE_STYLE = {
  fontFamily: "Arial",
  fontSize: "16px",
  fontWeight: "400",
  lineHeight: "24px",
  letterSpacing: "normal",
  color: "rgb(17, 24, 39)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  padding: "0px",
  gap: "normal",
  borderRadius: "0px",
  boxShadow: "none",
};

const section = (overrides = {}) => ({
  index: 0,
  selector: "section.hero",
  tag: "section",
  id: null,
  role: "main",
  heading: null,
  text: "Hero",
  rect: { x: 0, y: 0, width: 960, height: 400 },
  documentRect: { x: 0, y: 0, width: 960, height: 400 },
  style: { ...BASE_STYLE },
  before: {},
  after: {},
  ...overrides,
});

const observation = (sections, overrides = {}) => ({
  body: { selector: "body", style: { ...BASE_STYLE, backgroundColor: "rgb(248, 250, 252)" }, rect: { x: 0, y: 0, width: 1440, height: 1000 } },
  sections,
  interactive: [],
  cssVariables: { "--ink": "#111827" },
  mediaQueries: [{ condition: "(max-width: 700px)", minWidth: null, maxWidth: 700 }],
  fonts: [{ family: "Arial", weight: "400", style: "normal", status: "loaded" }],
  fontFaces: [{ family: "Arial", weight: "400", style: "normal", src: "url(a.woff2)", display: "swap" }],
  page: { viewport: { width: 1440, height: 1000 }, backgroundColor: "rgb(248, 250, 252)" },
  ...overrides,
});

const pngBuffer = (width, height, [r, g, b]) => {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = r;
    image.data[index + 1] = g;
    image.data[index + 2] = b;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
};

test("parseArgs preserves positionals, inline values, and boolean flags", () => {
  assert.deepEqual(parseArgs(["capture-source", "--url", "https://example.com", "--flag"]), {
    _: ["capture-source"],
    url: "https://example.com",
    flag: true,
  });
  assert.deepEqual(parseArgs(["--out=.clone", "--max=5"]), { _: [], out: ".clone", max: "5" });
});

test("safeName makes portable artifact names", () => {
  assert.equal(safeName("Hero / CTA!"), "Hero-CTA");
  assert.equal(safeName("!!!"), "capture");
});

test("resolveViewports accepts presets, widths, and explicit sizes", () => {
  assert.deepEqual(resolveViewports("desktop").map((view) => view.name), ["desktop"]);
  assert.deepEqual(resolveViewports("desktop,1024"), [
    { name: "desktop", viewport: { width: 1440, height: 1000 } },
    { name: "w1024", viewport: { width: 1024, height: 1000 } },
  ]);
  assert.deepEqual(resolveViewports("1280x900"), [{ name: "w1280", viewport: { width: 1280, height: 900 } }]);
  assert.deepEqual(resolveViewports().map((view) => view.name), ["desktop", "tablet", "mobile"]);
});

test("resolveViewports rejects nonsense instead of guessing", () => {
  assert.throws(() => resolveViewports("phone"), /Unrecognized viewport/);
  assert.throws(() => resolveViewports("desktop,desktop"), /Duplicate viewport/);
  assert.throws(() => resolveViewports("100"), /outside the supported/);
  assert.throws(() => resolveViewports("9999"), /outside the supported/);
  assert.throws(() => resolveViewports("5000"), /outside the supported/);
});

test("thresholdsFromArgs validates bands and defaults", () => {
  assert.deepEqual(thresholdsFromArgs({}), DEFAULT_THRESHOLDS);
  assert.equal(thresholdsFromArgs({ "pass-ratio": "0.01", "review-ratio": "0.05" }).visual.pass, 0.01);
  assert.throws(() => thresholdsFromArgs({ "pass-ratio": "0.05", "review-ratio": "0.01" }), /must not exceed/);
  assert.throws(() => thresholdsFromArgs({ "pass-ratio": "2" }), /between 0 and 1/);
});

test("viewportsFromManifest uses captured sizes and falls back to presets", () => {
  assert.deepEqual(viewportsFromManifest({ viewports: [{ name: "w1024", viewport: { width: 1024, height: 900 } }] }), [
    { name: "w1024", viewport: { width: 1024, height: 900 } },
  ]);
  assert.deepEqual(viewportsFromManifest({}).map((view) => view.name), ["desktop", "tablet", "mobile"]);
});

test("manifest view names are safe and viewport overrides preserve all captured routes", () => {
  const manifest = { viewports: [
    { name: "route-aaaaaaaaaa__desktop", viewport: { width: 1440, height: 1000 }, routeId: "route-aaaaaaaaaa", routePath: "/a", viewportName: "desktop" },
    { name: "route-bbbbbbbbbb__desktop", viewport: { width: 1440, height: 1000 }, routeId: "route-bbbbbbbbbb", routePath: "/b", viewportName: "desktop" },
  ] };
  const views = routeAwareViewports(manifest, resolveViewports("mobile"));
  assert.deepEqual(views.map(({ name, routeId, routePath, viewportName }) => ({ name, routeId, routePath, viewportName })), [
    { name: "route-aaaaaaaaaa__mobile", routeId: "route-aaaaaaaaaa", routePath: "/a", viewportName: "mobile" },
    { name: "route-bbbbbbbbbb__mobile", routeId: "route-bbbbbbbbbb", routePath: "/b", viewportName: "mobile" },
  ]);
  assert.throws(() => viewportsFromManifest({ viewports: [{ name: "../escape", viewport: { width: 1440, height: 1000 } }] }), /invalid capture name/);
});

test("sectionSlugs is content-derived, deterministic, and deduplicated", () => {
  const sections = [section({ index: 0, heading: "Pricing" }), section({ index: 1, text: "Pricing" }), section({ index: 2, text: "" })];
  const slugs = sectionSlugs(sections);
  assert.match(slugs[0], /^pricing-[0-9a-f]{10}$/);
  assert.notEqual(slugs[1], slugs[0]);
  assert.equal(slugs[2], "section");
  assert.deepEqual(sectionSlugs(sections), slugs);
});

test("duplicate region records get collision-safe slugs and ambiguous matches require review", () => {
  const repeated = [section({ text: "Same card", heading: "Same" }), section({ index: 1, text: "Same card", heading: "Same" })];
  const slugs = sectionSlugs(repeated);
  assert.equal(new Set(slugs).size, 2);
  const digest = slugs[0].split("-")[1];
  const craftedCollision = [
    section({ heading: `Same ${digest} 1 4`, text: "First" }),
    ...repeated,
    section({ heading: `Same ${digest} 1`, text: "Last" }),
  ];
  const collisionSafe = sectionSlugs(craftedCollision);
  assert.equal(new Set(collisionSafe).size, craftedCollision.length);
  const match = matchSections(repeated, [...repeated].reverse());
  assert.deepEqual(match.pairs.map((pair) => pair.matchedBy), ["ambiguous", "ambiguous"]);
  assert.ok(match.pairs.every((pair) => pair.matchingConfidence === "ambiguous"));
  assert.equal(classifyGeometryComparison({
    matchedBy: "ambiguous", status: "review", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [],
  }, DEFAULT_THRESHOLDS), "review");

  const reordered = matchSections([section({ text: "Card Alpha" }), section({ index: 1, text: "Card Beta" })], [
    section({ index: 0, text: "Card Beta" }), section({ index: 1, text: "Card Alpha" }),
  ]);
  assert.deepEqual(reordered.pairs.map((pair) => pair.cloneIndex), [1, 0]);
});

test("matchSections prefers text, then id and heading, then position", () => {
  const source = [
    section({ index: 0, text: "Header" }),
    section({ index: 1, text: "Hero", id: "one" }),
    section({ index: 2, text: "Pricing", heading: "Prices" }),
    section({ index: 3, text: "Footer" }),
  ];
  const clone = [
    section({ index: 0, text: "Header" }),
    section({ index: 1, text: "Changed hero", id: "one" }),
    section({ index: 2, text: "Pricing, updated", heading: "Prices" }),
    section({ index: 3, text: "Different footer" }),
  ];
  const { pairs } = matchSections(source, clone);
  assert.deepEqual(pairs.map((pair) => pair.matchedBy), ["text", "id", "heading", "index"]);
  assert.deepEqual(pairs.map((pair) => pair.cloneIndex), [0, 1, 2, 3]);

  const missing = matchSections(source, [clone[0]]);
  assert.equal(missing.pairs[3].matchedBy, "missing");
  assert.equal(missing.pairs[3].target, null);
});

test("compareObservations reports deltas, style mismatches, and extra regions", () => {
  const source = observation([section({ index: 0, text: "Hero" })]);
  const clone = observation([
    section({ index: 0, text: "Hero", rect: { x: 8, y: 0, width: 960, height: 412 }, style: { ...BASE_STYLE, borderRadius: "14px" } }),
    section({ index: 1, text: "Invented section" }),
  ]);
  const comparison = compareObservations(source, clone);
  assert.equal(comparison.comparisons[0].matchedBy, "text");
  assert.equal(comparison.comparisons[0].status, "measured");
  assert.equal(comparison.comparisons[0].deltas.x, 8);
  assert.equal(comparison.comparisons[0].deltas.height, 12);
  assert.deepEqual(comparison.comparisons[0].styleMismatches, ["borderRadius"]);
  assert.equal(comparison.extra.length, 1);
  assert.equal(comparison.matched, 1);
});

test("visual bands classify at documented boundaries", () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const result = (changeRatio, extra = {}) => ({ changeRatio, missing: false, dimensionMismatch: false, ...extra });
  assert.equal(classifyVisualResult(result(0.005), thresholds), "pass");
  assert.equal(classifyVisualResult(result(0.0051), thresholds), "review");
  assert.equal(classifyVisualResult(result(0.02), thresholds), "review");
  assert.equal(classifyVisualResult(result(0.0201), thresholds), "fail");
  assert.equal(classifyVisualResult(result(0, { missing: true }), thresholds), "fail");
  assert.equal(classifyVisualResult(result(0, { dimensionMismatch: true }), thresholds), "fail");
});

test("section diffs fail on real size drift but tolerate rounding", () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const base = { missing: false, dimensionMismatch: true, changeRatio: 0.001, source: { width: 960, height: 400 }, clone: { width: 960, height: 401 } };
  assert.equal(classifySectionVisual(base, thresholds), "review");
  assert.equal(classifySectionVisual({ ...base, clone: { width: 960, height: 412 } }, thresholds), "fail");
  assert.equal(classifySectionVisual({ ...base, dimensionMismatch: false }, thresholds), "pass");
  assert.equal(classifySectionVisual(null, thresholds), "fail");
  assert.equal(classifySectionVisual({ ...base, missing: true }, thresholds), "fail");
});

test("geometry confidence: text pass, position review, missing fail", () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const measured = { matchedBy: "text", status: "measured", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [] };
  assert.equal(classifyGeometryComparison(measured, thresholds), "pass");
  assert.equal(classifyGeometryComparison({ ...measured, deltas: { x: 2, y: 0, width: 0, height: 0 } }, thresholds), "review");
  assert.equal(classifyGeometryComparison({ ...measured, styleMismatches: ["fontFamily"] }, thresholds), "review");
  assert.equal(classifyGeometryComparison({ ...measured, matchedBy: "index", status: "review" }, thresholds), "review");
  assert.equal(classifyGeometryComparison({ matchedBy: "missing" }, thresholds), "fail");
});

test("gates summarize conservatively and map to exit codes", () => {
  assert.equal(summarizeGate(["pass", "pass"]), "pass");
  assert.equal(summarizeGate(["pass", "review"]), "review");
  assert.equal(summarizeGate(["review", "fail"]), "fail");
  assert.equal(summarizeGate([]), "fail");
  assert.equal(summarizeGate(["pass", "skipped"]), "fail");
  assert.equal(exitCodeFor("pass"), 0);
  assert.equal(exitCodeFor("fail"), 1);
  assert.equal(exitCodeFor("review"), 2);
  assert.equal(exitCodeFor("review", { allowReview: true }), 0);
});

/**
 * A section visual result must carry the measured source and clone dimensions:
 * classification fails closed without them, so fixtures cannot omit them and
 * accidentally assert a failure as if it were a classification.
 */
const sectionVisual = (overrides = {}) => ({
  changeRatio: 0,
  dimensionMismatch: false,
  missing: false,
  source: { width: 960, height: 400 },
  clone: { width: 960, height: 400 },
  ...overrides,
});

const triageInput = ({ cloneSections = [section({ index: 0 })], visual = { hero: sectionVisual() }, previous = null, cloneOverrides = {} } = {}) => {
  const sourceObservation = observation([section({ index: 0, text: "Hero" })]);
  const cloneObservation = observation(cloneSections, cloneOverrides);
  const comparisons = compareObservations(sourceObservation, cloneObservation).comparisons;
  return buildTriage({
    viewports: [{ viewport: "desktop", sourceObservation, cloneObservation, comparisons, sectionVisual: visual }],
    sourceUrl: "https://example.com",
    cloneUrl: "http://localhost:3000",
    thresholds: DEFAULT_THRESHOLDS,
    previous,
  });
};

test("triage keeps clean regions and reports no correction plan", () => {
  const triage = triageInput();
  assert.equal(triage.viewports[0].sections[0].status, "KEEP");
  assert.equal(triage.summary.fix, 0);
  assert.equal(triage.correctionPlan.length, 0);
  assert.match(triage.nextAction, /manual gates/);
});

test("triage fails closed when section screenshot evidence is absent", () => {
  const triage = triageInput({ visual: {} });
  const sectionResult = triage.viewports[0].sections[0];
  assert.equal(sectionResult.status, "FIX");
  assert.equal(sectionResult.cause, "assets");
  assert.match(sectionResult.reasons[0], /screenshot evidence is missing/);
});

test("triage labels malformed section comparisons as invalid evidence", () => {
  const triage = triageInput({ visual: { hero: { changeRatio: NaN, missing: false, dimensionMismatch: false } } });
  const sectionResult = triage.viewports[0].sections[0];
  assert.equal(sectionResult.status, "FIX");
  assert.equal(sectionResult.cause, "visual");
  assert.match(sectionResult.reasons[0], /evidence is invalid or incomplete/);
});

test("triage marks missing regions as structural fixes first", () => {
  const triage = triageInput({ cloneSections: [] });
  const sectionResult = triage.viewports[0].sections[0];
  assert.equal(sectionResult.status, "FIX");
  assert.equal(sectionResult.cause, "structural");
  assert.equal(triage.correctionPlan[0].priority, 1);
  assert.match(triage.nextAction, /FIX hero/);
});

test("triage sends positional-only matches to RECHECK", () => {
  const triage = triageInput({ cloneSections: [section({ index: 0, text: "Different hero" })] });
  assert.equal(triage.viewports[0].sections[0].status, "RECHECK");
  assert.equal(triage.viewports[0].sections[0].cause, "identity");
});

test("triage orders foundation drift ahead of visual drift", () => {
  const cloneSections = [section({ index: 0, text: "Hero", style: { ...BASE_STYLE, fontFamily: "Georgia", fontSize: "18px" } })];
  const triage = triageInput({ cloneSections });
  const sectionResult = triage.viewports[0].sections[0];
  assert.equal(sectionResult.status, "FIX");
  assert.equal(sectionResult.cause, "foundation");
  assert.ok(sectionResult.styleMismatches.includes("fontFamily"));
  assert.match(sectionResult.reasons[0], /fontFamily/);
});

test("a changed foundation promotes previous KEEP regions to RECHECK", () => {
  const sourceObservation = observation([section({ index: 0 })]);
  const cloneObservation = observation([section({ index: 0 })]);
  const previous = {
    viewports: [{
      viewport: "desktop",
      foundationSignature: foundationSignature(observation([], { body: { style: { ...BASE_STYLE, fontFamily: "Georgia" } } })),
      sections: [{ slug: "hero", status: "KEEP" }],
    }],
  };
  const triage = buildTriage({
    viewports: [{
      viewport: "desktop",
      sourceObservation,
      cloneObservation,
      comparisons: compareObservations(sourceObservation, cloneObservation).comparisons,
      sectionVisual: { hero: sectionVisual() },
    }],
    sourceUrl: "https://example.com",
    cloneUrl: "http://localhost:3000",
    thresholds: DEFAULT_THRESHOLDS,
    previous,
  });
  assert.equal(triage.viewports[0].foundationChanged, true);
  assert.equal(triage.viewports[0].sections[0].status, "RECHECK");
  assert.equal(triage.viewports[0].sections[0].cause, "foundation");
});

test("tokens capture colors, type scale, spacing, variables, and breakpoints", () => {
  const desktop = observation([
    section({ index: 0, style: { ...BASE_STYLE, padding: "32px 24px", gap: "16px", borderRadius: "14px", boxShadow: "0 14px 30px #312e8122" } }),
    section({ index: 1, text: "Pricing", style: { ...BASE_STYLE, padding: "24px", gridTemplateColumns: "repeat(2, 1fr)" } }),
  ]);
  const mobile = observation([
    section({ index: 0, style: { ...BASE_STYLE, padding: "24px 16px", gap: "16px", gridTemplateColumns: "1fr" } }),
    section({ index: 1, text: "Pricing", style: { ...BASE_STYLE, padding: "16px", gridTemplateColumns: "1fr" } }),
  ], { page: { viewport: { width: 390, height: 844 }, backgroundColor: "rgb(248, 250, 252)" } });
  const tokens = extractTokens({ desktop, mobile });

  assert.deepEqual(tokens.viewports, ["desktop", "mobile"]);
  assert.ok(tokens.colors.some((color) => color.value === "rgb(17, 24, 39)"));
  assert.ok(tokens.colors.every((color, index, list) => index === 0 || list[index - 1].count >= color.count));
  assert.ok(tokens.typography.scale.some((step) => step.fontSize === "16px" && step.lineHeight === "24px"));
  assert.deepEqual(tokens.spacing.map((entry) => entry.px), [16, 24, 32]);
  assert.ok(tokens.spacing.every((entry) => entry.count > 0));
  assert.equal(tokens.cssVariables["--ink"], "#111827");
  assert.equal(tokens.breakpoints.mediaQueries[0].maxWidth, 700);
  assert.ok(tokens.breakpoints.observedTransitions.some((transition) => transition.property === "gridTemplateColumns"));
  assert.equal(tokens.radii[0].value, "14px");
  assert.ok(renderTokensMarkdown(tokens).includes("## Color"));
});

test("responsive transitions stay within a route and matched section", () => {
  const makeView = ({ capture, routeId, viewportName, width, columns }) => {
    const result = observation([section({ text: "Shared hero", heading: "Hero", style: { ...BASE_STYLE, gridTemplateColumns: columns } })], {
      page: { viewport: { width, height: 900 }, backgroundColor: "rgb(248, 250, 252)" },
      routeId,
      routePath: `/${routeId}`,
      viewportName,
    });
    return [capture, result];
  };
  const observations = Object.fromEntries([
    makeView({ capture: "route-a__desktop", routeId: "route-a", viewportName: "desktop", width: 1440, columns: "1fr 1fr" }),
    makeView({ capture: "route-a__mobile", routeId: "route-a", viewportName: "mobile", width: 390, columns: "1fr" }),
    makeView({ capture: "route-b__desktop", routeId: "route-b", viewportName: "desktop", width: 1440, columns: "1fr" }),
  ]);
  const transitions = detectTransitions(observations);
  assert.ok(transitions.some((entry) => entry.property === "gridTemplateColumns" && entry.routeId === "route-a"));
  assert.ok(transitions.every((entry) => entry.routeId === "route-a"));
  assert.deepEqual(transitions.find((entry) => entry.property === "gridTemplateColumns").values.map((value) => value.viewport), ["mobile", "desktop"]);

  const tokens = extractTokens(observations);
  assert.deepEqual(tokens.viewports, ["desktop", "mobile"]);
  assert.deepEqual(tokens.captures.map((capture) => capture.routeId), ["route-a", "route-a", "route-b"]);
  const system = buildDesignSystem(observations);
  assert.equal(system.sourceCaptures[0].viewportName, "desktop");
  assert.ok(system.layout.observedSectionGeometry.some((layout) => layout.routeId === "route-b"));
});

test("detectTransitions needs at least two widths", () => {
  assert.deepEqual(detectTransitions({ desktop: observation([section()]) }), []);
});

test("cropPng slices the stored screenshot and clamps out-of-bounds rects", () => {
  const buffer = pngBuffer(8, 6, [255, 0, 0]);
  const cropped = PNG.sync.read(cropPng(buffer, { x: 2, y: 1, width: 3, height: 4 }));
  assert.equal(cropped.width, 3);
  assert.equal(cropped.height, 4);
  assert.deepEqual(clampRect({ x: 6, y: 5, width: 10, height: 10 }, 8, 6), { x: 6, y: 5, width: 2, height: 1 });
  assert.equal(cropPng(buffer, { x: 20, y: 20, width: 5, height: 5 }), null);
});

test("diffPng detects identical, changed, and resized images", () => {
  const red = pngBuffer(10, 10, [255, 0, 0]);
  const blue = pngBuffer(10, 10, [0, 0, 255]);
  assert.equal(diffPng(red, red).changeRatio, 0);
  assert.equal(diffPng(red, blue).changeRatio, 1);
  assert.equal(diffPng(red, blue).largestDifferenceRegion.width, 10);
  const resized = diffPng(red, pngBuffer(10, 12, [255, 0, 0]));
  assert.equal(resized.dimensionMismatch, true);
  assert.equal(resized.clone.height, 12);
  const missing = diffPng(red, null);
  assert.equal(missing.missing, true);
  assert.equal(missing.changeRatio, 1);
});

test("manifests checksum evidence and detect tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixel-perfect-evidence-"));
  try {
    await mkdir(join(root, "source", "screenshots"), { recursive: true });
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "source", "screenshots", "desktop.png"), "image-bytes");
    await writeFile(join(root, "evidence", "observation-desktop.json"), "{\"sections\":[]}");
    await writeFile(join(root, "evidence", "sections-desktop.json"), "{\"sections\":[]}");
    await writeFile(join(root, "evidence", "states-desktop.json"), "[]");
    const manifest = await buildManifest({ out: root, sourceUrl: "https://example.com", viewports: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, sections: 0, regionExpectation: "documented-none" }] });
    assert.equal(manifest.version, 3);
    assert.equal(manifest.artifacts.length, 4);
    assert.ok(manifest.requiredArtifacts.includes("source/screenshots/desktop.png"));
    assert.deepEqual(manifest.interactionStates, ["evidence/states-desktop.json"]);
    assert.ok(manifest.requiredArtifacts.includes("evidence/states-desktop.json"));
    assert.ok(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)));
    await writeManifest(root, manifest);

    const clean = await verifyArtifacts(root, manifest);
    assert.equal(clean.ok, true);
    assert.equal(clean.checked, 4);
    assert.equal(clean.manifestIntegrity.ok, true);
    const checksumBytes = await readFile(join(root, "evidence", "manifest.sha256"));
    const externalChecksum = join(root, "outside-checksum.sha256");
    await writeFile(externalChecksum, checksumBytes);
    await rm(join(root, "evidence", "manifest.sha256"));
    await symlink(externalChecksum, join(root, "evidence", "manifest.sha256"));
    const linkedManifestMetadata = await verifyArtifacts(root, manifest);
    assert.equal(linkedManifestMetadata.ok, false);
    assert.ok(linkedManifestMetadata.invalid.includes("evidence/manifest.sha256"));
    await rm(join(root, "evidence", "manifest.sha256"));
    await writeFile(join(root, "evidence", "manifest.sha256"), checksumBytes);
    const substitutedManifest = await verifyArtifacts(root, { ...manifest, sourceUrl: "https://altered.example" });
    assert.equal(substitutedManifest.manifestIntegrity.ok, false);
    const archive = await archiveBaseline(root, "test refresh");
    assert.ok(archive);
    assert.match(await readFile(join(archive, "audit.json"), "utf8"), /test refresh/);
    assert.ok(await readFile(join(archive, "evidence", "manifest.sha256"), "utf8"));

    await writeFile(join(root, "source", "screenshots", "desktop.png"), "tampered");
    const tampered = await verifyArtifacts(root, manifest);
    assert.equal(tampered.ok, false);
    assert.deepEqual(tampered.mismatched, ["source/screenshots/desktop.png"]);

    await writeFile(join(root, "evidence", "unexpected.json"), "untracked");
    const unexpected = await verifyArtifacts(root, manifest);
    assert.deepEqual(unexpected.unexpected, ["evidence/unexpected.json"]);

    await writeFile(join(root, "outside.json"), "outside bundle");
    await symlink(join(root, "outside.json"), join(root, "source", "linked.json"));
    const linked = await verifyArtifacts(root, manifest);
    assert.ok(linked.unexpected.includes("source/linked.json"));
    const invalidPath = await verifyArtifacts(root, {
      ...manifest,
      artifacts: [...manifest.artifacts, { path: "source/../outside.json", bytes: 13, sha256: "a".repeat(64) }],
    });
    assert.ok(invalidPath.invalid.includes("source/../outside.json"));

    await rm(join(root, "evidence", "observation-desktop.json"));
    const missing = await verifyArtifacts(root, manifest);
    assert.deepEqual(missing.missing, ["evidence/observation-desktop.json"]);
    assert.match(missing.message, /integrity failed/);
    await writeFile(join(root, "evidence", "manifest.json"), JSON.stringify({ ...manifest, sourceUrl: "https://altered.example" }));
    const alteredManifest = await verifyArtifacts(root, manifest);
    assert.equal(alteredManifest.ok, false);
    assert.equal(alteredManifest.manifestIntegrity.ok, false);

    assert.equal((await verifyArtifacts(root, { artifacts: [] })).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest metadata files are skipped, never reported invalid, and symlinked metadata still fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixel-perfect-manifest-"));
  try {
    await mkdir(join(root, "source", "screenshots"), { recursive: true });
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "source", "screenshots", "desktop.png"), "image-bytes");
    await writeFile(join(root, "evidence", "observation-desktop.json"), "{\"sections\":[]}");
    await writeFile(join(root, "evidence", "sections-desktop.json"), "{\"sections\":[]}");
    const manifest = await buildManifest({ out: root, sourceUrl: "https://example.com", viewports: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, sections: 0, regionExpectation: "documented-none" }] });
    await writeManifest(root, manifest);

    // The written manifest and its checksum are intentional bundle metadata:
    // they must not be hashed as artifacts nor reported as invalid entries.
    assert.ok(manifest.artifacts.every((artifact) => artifact.path !== "evidence/manifest.json" && artifact.path !== "evidence/manifest.sha256"));
    const clean = await verifyArtifacts(root, manifest);
    assert.equal(clean.ok, true);
    assert.equal(clean.manifestIntegrity.ok, true);
    assert.deepEqual(clean.invalid, []);
    assert.deepEqual(clean.unexpected, []);
    assert.deepEqual(clean.missing, []);
    assert.deepEqual(clean.mismatched, []);

    const manifestBytes = await readFile(join(root, "evidence", "manifest.json"));
    const checksumBytes = await readFile(join(root, "evidence", "manifest.sha256"));
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "manifest.json"), manifestBytes);
    await writeFile(join(outside, "manifest.sha256"), checksumBytes);

    await rm(join(root, "evidence", "manifest.json"));
    await symlink(join(outside, "manifest.json"), join(root, "evidence", "manifest.json"));
    const linkedManifest = await verifyArtifacts(root, manifest);
    assert.equal(linkedManifest.ok, false);
    assert.ok(linkedManifest.invalid.includes("evidence/manifest.json"));
    await assert.rejects(() => readManifest(root), /Unsafe evidence/);
    await rm(join(root, "evidence", "manifest.json"));
    await writeFile(join(root, "evidence", "manifest.json"), manifestBytes);

    await rm(join(root, "evidence", "manifest.sha256"));
    await symlink(join(outside, "manifest.sha256"), join(root, "evidence", "manifest.sha256"));
    const linkedChecksum = await verifyArtifacts(root, manifest);
    assert.equal(linkedChecksum.ok, false);
    assert.ok(linkedChecksum.invalid.includes("evidence/manifest.sha256"));
    await rm(join(root, "evidence", "manifest.sha256"));
    await writeFile(join(root, "evidence", "manifest.sha256"), checksumBytes);
    assert.equal((await verifyArtifacts(root, manifest)).ok, true);

    // Ordinary bundle entries are unaffected: a real symlink is still unsafe.
    await writeFile(join(root, "outside.png"), "outside");
    await symlink(join(root, "outside.png"), join(root, "source", "screenshots", "linked.png"));
    const linkedArtifact = await verifyArtifacts(root, manifest);
    assert.equal(linkedArtifact.ok, false);
    assert.ok(linkedArtifact.invalid.includes("source/screenshots/linked.png"));
    await assert.rejects(() => buildManifest({ out: root, sourceUrl: "https://example.com", viewports: [] }), /Unsafe evidence bundle entries/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a verification round scores only its own capture, not stale clone evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixel-perfect-round-"));
  try {
    const png = pngBuffer(20, 20, [10, 20, 30]);
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const observed = observation([section({ text: "Hero", rect, documentRect: rect })], {
      page: { viewport: { width: 1440, height: 1000 }, scrollWidth: 20, scrollHeight: 20, backgroundColor: "rgb(248, 250, 252)" },
    });
    const crop = cropPng(png, rect);
    await mkdir(join(root, "source", "screenshots"), { recursive: true });
    await mkdir(join(root, "source", "sections", "desktop"), { recursive: true });
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "source", "screenshots", "desktop.png"), png);
    await writeFile(join(root, "source", "sections", "desktop", "hero.png"), crop);
    await writeFile(join(root, "evidence", "observation-desktop.json"), JSON.stringify(observed));
    await writeFile(join(root, "evidence", "sections-desktop.json"), JSON.stringify({
      viewport: "desktop",
      viewportSize: { width: 1440, height: 1000 },
      regionExpectation: "required",
      sections: [{ index: 0, slug: "hero", selector: "section.hero", role: "main", text: "Hero", rect, documentRect: rect, bytes: crop.byteLength, captureStatus: "captured" }],
    }));
    const manifest = await buildManifest({
      out: root,
      sourceUrl: "https://example.com",
      viewports: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, sections: 1, regionExpectation: "required", captureStatus: "captured" }],
    });
    await writeManifest(root, manifest);

    // Evidence left behind by an earlier round or a compare-geometry run.
    const staleCrop = join(root, "verification", "clone", "sections", "desktop", "invented-region.png");
    await mkdir(join(root, "verification", "clone", "sections", "desktop"), { recursive: true });
    await writeFile(staleCrop, "stale-crop");
    const staleObservation = join(root, "verification", "clone", "observation-desktop.json");
    await writeFile(staleObservation, JSON.stringify({ sections: [] }));

    const capture = async () => ({
      pages: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, screenshot: png, observation: observed, html: null }],
      assets: [],
      warnings: [],
    });
    const { report } = await verifyClone({ sourceDir: root, cloneUrl: "http://localhost:3000", capture });
    assert.equal(report.sectionGate, "pass");
    assert.equal(report.geometryGate, "pass");
    assert.equal(report.machineGate, "pass");
    assert.ok(await readFile(join(root, "verification", "clone", "sections", "desktop", "hero.png")));
    await assert.rejects(() => readFile(staleCrop), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fidelity gates fail closed on empty, missing, invalid, or unsupported evidence", () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const cleanVisual = { results: [{ viewport: "desktop", changedPixels: 0, totalPixels: 100, changeRatio: 0, dimensionMismatch: false, missing: false }] };
  const cleanSections = { viewports: [{ viewport: "desktop", expectedCount: 1, capturedCount: 1, coverage: "complete", sections: [{ name: "hero", changeRatio: 0, dimensionMismatch: false, missing: false, source: { width: 10, height: 10 }, clone: { width: 10, height: 10 } }], extra: [] }] };
  const cleanGeometry = { results: [{ viewport: "desktop", comparisons: [{ matchedBy: "text", status: "measured", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [] }], extra: [] }] };
  const manifest = { sourceUrl: "https://example.com", tool: { version: "3.0.0" }, viewports: [{ name: "desktop", sections: 1, regionExpectation: "required" }] };
  const pass = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: cleanSections, geometry: cleanGeometry, triage: null, thresholds });
  assert.equal(pass.machineGate, "pass");
  assert.equal(pass.machineChecksPassed, true);
  assert.equal(pass.finalStatus, "manual_review_required");
  assert.match(pass.conclusion, /Machine checks passed/);

  const missingVisual = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: { results: [] }, sections: cleanSections, geometry: cleanGeometry, triage: null, thresholds });
  assert.equal(missingVisual.machineGate, "fail");
  const missingRegions = buildFidelityReport({
    manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual,
    sections: { viewports: [{ viewport: "desktop", expectedCount: 0, capturedCount: 0, coverage: "missing", sections: [], extra: [] }] },
    geometry: cleanGeometry, triage: null, thresholds,
  });
  assert.equal(missingRegions.sectionGate, "fail");
  assert.equal(missingRegions.machineGate, "fail");
  const failedCrop = buildFidelityReport({
    manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual,
    sections: { viewports: [{ viewport: "desktop", expectedCount: 1, capturedCount: 0, coverage: "failed", sections: [{ name: "hero", missing: true, sourceCaptureFailed: true }], extra: [] }] },
    geometry: cleanGeometry, triage: null, thresholds,
  });
  assert.equal(failedCrop.sectionGate, "fail");
  const missingGeometry = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: cleanSections, geometry: { results: [] }, triage: null, thresholds });
  assert.equal(missingGeometry.geometryGate, "fail");
  const invalidRatio = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: { results: [{ ...cleanVisual.results[0], changeRatio: NaN }] }, sections: cleanSections, geometry: cleanGeometry, triage: null, thresholds });
  assert.equal(invalidRatio.visualGate, "fail");
  const extraGeometry = buildFidelityReport({
    manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: cleanSections,
    geometry: { results: [{ ...cleanGeometry.results[0], extra: [{ index: 1, selector: "section.extra", text: "Unexpected" }] }] },
    triage: null, thresholds,
  });
  assert.equal(extraGeometry.geometryGate, "fail");
  assert.equal(extraGeometry.machineGate, "fail");
  const unsupported = buildFidelityReport({
    manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: cleanSections,
    geometry: { results: [{ viewport: "desktop", comparisons: [{ matchedBy: "unknown", status: "measured", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [] }] }] },
    triage: null, thresholds,
  });
  assert.equal(unsupported.geometryGate, "fail");

  const documentedNone = buildFidelityReport({
    manifest: { ...manifest, viewports: [{ name: "desktop", sections: 0, regionExpectation: "documented-none" }] },
    cloneUrl: "http://localhost:3000", visual: cleanVisual,
    sections: { viewports: [{ viewport: "desktop", expectedCount: 0, capturedCount: 0, regionExpectation: "documented-none", coverage: "not_expected", sections: [], extra: [] }] },
    geometry: { results: [{ viewport: "desktop", comparisons: [], extra: [] }] }, triage: null, thresholds,
  });
  assert.equal(documentedNone.machineGate, "pass");

  const extra = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: { viewports: [{ viewport: "desktop", sections: [], extra: ["invented-region"] }] }, geometry: cleanGeometry, triage: null, thresholds });
  assert.deepEqual(extra.extraRegions, [{ viewport: "desktop", name: "invented-region" }]);
});

test("final verdict requires current complete machine evidence and documented manual gates", () => {
  const manifest = {
    sourceUrl: "https://example.com",
    capturedAt: "2026-01-01T00:00:00.000Z",
    viewports: [{ name: "desktop", sections: 1, regionExpectation: "required", captureStatus: "captured" }],
  };
  const makeReport = (changeRatio = 0) => buildFidelityReport({
    manifest,
    cloneUrl: "http://localhost",
    visual: { results: [{ viewport: "desktop", changedPixels: 0, totalPixels: 100, changeRatio, dimensionMismatch: false, missing: false }] },
    sections: { viewports: [{
      viewport: "desktop", expectedCount: 1, capturedCount: 1, coverage: "complete", regionExpectation: "required",
      sections: [{ name: "hero", missing: false, dimensionMismatch: false, changeRatio: 0, source: { width: 10, height: 10 }, clone: { width: 10, height: 10 }, result: "pass" }],
      extra: [],
    }] },
    geometry: { results: [{
      viewport: "desktop",
      comparisons: [{ matchedBy: "text", status: "measured", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [] }],
      extra: [],
    }] },
    thresholds: DEFAULT_THRESHOLDS,
  });
  const report = makeReport();
  const integrity = { ok: true, message: "verified" };
  const gates = Object.fromEntries(Object.keys(report.manualGates).map((gate) => [gate, "pass"]));
  assert.equal(finalizeVerdict({ report, integrity, manifest }).status, "manual_review_required");
  assert.equal(finalizeVerdict({ report, integrity, manifest, review: { gates } }).status, "fully_verified");

  const limitation = "Source interaction endpoint was unavailable for observation";
  const limitedGates = { ...gates, "observed meaningful interactions": "not_applicable" };
  assert.equal(finalizeVerdict({
    report, integrity, manifest,
    review: { gates: limitedGates, gateReasons: { "observed meaningful interactions": limitation }, limitations: [limitation] },
  }).status, "ready_with_limitations");
  assert.equal(finalizeVerdict({
    report, integrity, manifest,
    review: { gates: limitedGates, gateReasons: { "observed meaningful interactions": limitation }, limitations: ["unrelated limitation"] },
  }).status, "manual_review_required");

  const inconsistent = { ...report, sectionGate: "fail" };
  assert.equal(finalizeVerdict({ report: inconsistent, integrity, manifest, review: { gates } }).status, "blocked");
  assert.equal(finalizeVerdict({ report, integrity, manifest: { ...manifest, capturedAt: "2026-02-01T00:00:00.000Z" }, review: { gates } }).status, "blocked");
  assert.equal(finalizeVerdict({ report, integrity: { ok: false, message: "tampered" }, manifest, review: { gates } }).status, "blocked");
  assert.equal(finalizeVerdict({ report: makeReport(0.5), integrity, manifest, review: { gates } }).status, "failed");
  const staleReview = finalizeVerdict({
    report, integrity, manifest,
    binding: { fingerprint: "current-evidence" },
    review: { gates, binding: { fingerprint: "older-evidence" } },
  });
  assert.equal(staleReview.status, "blocked");
  assert.match(staleReview.conclusion, /bound to different evidence/);
  assert.equal(finalizeVerdict({
    report, integrity, manifest,
    binding: { fingerprint: "current-evidence" },
    review: { gates, binding: { fingerprint: "current-evidence" } },
  }).status, "fully_verified");
});

test("discovery URL normalization keeps scope narrow and collapses query and fragments", () => {
  const allowed = new Set(["https://example.com"]);
  assert.equal(normalizeRouteUrl("/pricing/?campaign=x#plans", "https://example.com/start", allowed), "https://example.com/pricing");
  assert.equal(normalizeRouteUrl("https://outside.example/path", "https://example.com", allowed), null);
  assert.equal(normalizeRouteUrl("javascript:alert(1)", "https://example.com", allowed), null);
  assert.equal(publicSourceUrl("https://example.com/path?access_token=secret#fragment"), "https://example.com/path");
  assert.throws(() => publicSourceUrl("https://user:pass@example.com/path"), /embedded credentials/);
  assert.throws(() => publicSourceUrl("file:///etc/passwd"), /HTTP\(S\)/);
});

test("interaction-state CSS and asset failures never retain credentialed or query-bearing URLs", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { baseURI: "https://fixture.example/page" };
  globalThis.getComputedStyle = () => ({
    background: 'url("https://user:pass@assets.example/image.svg?access_token=private#fragment")',
    backgroundImage: 'url("/asset.svg?session=private#state")',
    color: "rgb(1, 2, 3)",
  });
  try {
    const element = {
      tagName: "BUTTON",
      innerText: "Start",
      tabIndex: 0,
      disabled: false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 40, height: 20 }),
    };
    const state = snapshotInteractiveState(element, ["background", "backgroundImage", "color"]);
    assert.equal(state.style.background, 'url("https://assets.example/image.svg")');
    assert.equal(state.style.backgroundImage, 'url("https://fixture.example/asset.svg")');
    assert.doesNotMatch(JSON.stringify(state), /user:pass|access_token|private|session|fragment|state/);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = originalGetComputedStyle;
  }

  const handlers = new Map();
  const assets = trackAssets({ on: (event, handler) => handlers.set(event, handler) });
  handlers.get("requestfailed")({
    resourceType: () => "image",
    url: () => "https://user:pass@assets.example/image.svg?access_token=private#fragment",
    failure: () => ({ errorText: "net::ERR_FAILED while loading https://user:pass@assets.example/image.svg?access_token=private#fragment" }),
  });
  const serialized = JSON.stringify([...assets.values()]);
  assert.doesNotMatch(serialized, /user:pass|access_token|private|fragment|assets\.example.*\?/);
  assert.match(serialized, /net::ERR_FAILED/);
});

test("capture profiles are deterministic and validate browser context options", () => {
  assert.deepEqual(captureProfileFrom(), DEFAULT_CAPTURE_PROFILE);
  assert.deepEqual(captureProfileFromManifest({ ...DEFAULT_CAPTURE_PROFILE, browserVersion: "Chromium 123" }), DEFAULT_CAPTURE_PROFILE);
  assert.throws(() => captureProfileFrom({ browserVersion: "Chromium 123" }), /Unsupported capture profile field/);
  assert.equal(captureProfileFrom({ colorScheme: "dark", locale: "fr-FR" }).colorScheme, "dark");
  assert.throws(() => captureProfileFrom({ browser: "firefox" }), /Only the installed Chromium/);
  assert.throws(() => captureProfileFrom({ deviceScaleFactor: 10 }), /deviceScaleFactor/);
  assert.throws(() => captureProfileFrom({ stabilizationFrames: 0 }), /stabilizationFrames/);
  assert.throws(() => captureProfileFrom({ stabilitySamples: 1 }), /stabilitySamples/);
  assert.throws(() => captureProfileFrom({ resourceTimeoutMs: 30_001 }), /resourceTimeoutMs/);
  assert.throws(() => captureProfileFrom({ waitForImages: "false" }), /waitForImages.*boolean/);
  assert.throws(() => captureProfileFrom({ accessToken: "secret" }), /Unsupported capture profile field/);
  // Reveal-on-scroll is opt-in: a capture that skips the scroll pass must stay
  // the default so existing profiles keep measuring the same pixels.
  assert.equal(captureProfileFrom({}).revealScroll, false);
  assert.equal(captureProfileFrom({ revealScroll: true }).revealScroll, true);
  assert.equal(captureProfileFromManifest({ ...DEFAULT_CAPTURE_PROFILE, revealScroll: true, browserVersion: "Chromium 123" }).revealScroll, true);
  assert.throws(() => captureProfileFrom({ revealScroll: "yes" }), /revealScroll.*boolean/);
});

test("design-system export includes measured headings, layouts, components, docs, and CSS", () => {
  const desktop = observation([section({
    classes: ["hero"],
    style: { ...BASE_STYLE, display: "grid", maxWidth: "960px", gridTemplateColumns: "1fr 1fr", gap: "24px" },
  })], {
    headingObservations: [{ level: "h1", text: "Welcome", rect: { x: 0, y: 0, width: 100, height: 32 }, style: { ...BASE_STYLE, fontSize: "32px", fontWeight: "700" } }],
    interactive: [
      section({ tag: "button", text: "Start now", classes: ["primary"], style: { ...BASE_STYLE, borderRadius: "11px", backgroundColor: "rgb(109, 40, 217)" } }),
      section({ tag: "button", text: "Learn more", classes: ["secondary"], style: { ...BASE_STYLE, borderRadius: "11px", backgroundColor: "rgb(109, 40, 217)" } }),
    ],
  });
  const system = buildDesignSystem({ desktop });
  assert.equal(system.typography.headingHierarchy[0].level, "h1");
  assert.equal(system.layout.gridAndFlex[0].display, "grid");
  const buttons = system.components.filter((component) => component.tag === "button");
  assert.equal(buttons.length, 2);
  assert.equal(new Set(buttons.map((component) => component.id)).size, 2);
  assert.match(renderDesignSystemMarkdown(system), /Reusable design system/);
  assert.match(renderDesignTokensCss(system), /--pp-color-01/);
});

test("core exports the documented defaults", () => {
  assert.equal(DEFAULT_THRESHOLDS.visual.pass, 0.005);
  assert.equal(DEFAULT_THRESHOLDS.visual.review, 0.02);
  assert.deepEqual(DEFAULT_THRESHOLDS.geometry, { xy: 1, size: 2 });
});

test("project lifecycle persists statuses and demotes a stale finalization", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixel-perfect-state-"));
  try {
    const first = await recordProjectStatus({ sourceDir: root, status: "IN_PROGRESS", reason: "capture", binding: { fingerprint: "a", baselineSha256: "x" } });
    assert.equal(first.status, "IN_PROGRESS");
    assert.equal(first.history.length, 1);
    const second = await recordProjectStatus({ sourceDir: root, status: "VERIFIED", reason: "finalize", binding: { fingerprint: "a", baselineSha256: "x" } });
    assert.equal(second.history.length, 2);

    // A fresh read stands in for a new process: the status lives on disk.
    const restored = await readProjectState(root);
    assert.equal(restored.status, "VERIFIED");
    assert.equal(restored.history.length, 2);
    assert.equal(restored.history[1].reason, "finalize");
    assert.equal(resolveDeliveryStatus({ state: restored, currentFingerprint: "a" }).status, "VERIFIED");

    const stale = resolveDeliveryStatus({ state: restored, currentFingerprint: "b" });
    assert.equal(stale.status, "AWAITING_REVIEW");
    assert.equal(stale.recordedStatus, "VERIFIED");
    assert.equal(stale.stale, true);
    assert.match(stale.note, /changed after the last finalization/);

    await assert.rejects(() => recordProjectStatus({ sourceDir: root, status: "DONE" }), /Unsupported project status/);
    assert.equal(statusFromVerdict("ready_with_limitations"), "READY_WITH_LIMITATIONS");
    assert.equal(statusFromVerdict("blocked"), "BLOCKED");
    assert.equal(statusFromVerdict(undefined), "IN_PROGRESS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("handoff package is evidence-derived, sanitised, and reflects the final verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixel-perfect-handoff-"));
  try {
    const png = pngBuffer(20, 20, [12, 24, 36]);
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const hostile = '<script>alert("captured")</script><img src=x onerror="alert(1)">';
    const sourceSections = [section({ text: `Hero ${hostile}`, rect, documentRect: rect })];
    const [regionSlug] = sectionSlugs(sourceSections);
    const observed = observation(sourceSections, {
      title: `Captured ${hostile}`,
      page: { viewport: { width: 1440, height: 1000 }, scrollWidth: 20, scrollHeight: 20, backgroundColor: "rgb(248, 250, 252)" },
    });
    const crop = cropPng(png, rect);
    await mkdir(join(root, "source", "screenshots"), { recursive: true });
    await mkdir(join(root, "source", "sections", "desktop"), { recursive: true });
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "source", "screenshots", "desktop.png"), png);
    await writeFile(join(root, "source", "sections", "desktop", `${regionSlug}.png`), crop);
    await writeFile(join(root, "evidence", "observation-desktop.json"), JSON.stringify(observed));
    await writeFile(join(root, "evidence", "sections-desktop.json"), JSON.stringify({
      viewport: "desktop",
      viewportSize: { width: 1440, height: 1000 },
      regionExpectation: "required",
      sections: [{ index: 0, slug: regionSlug, selector: "section.hero", role: "main", text: `Hero ${hostile}`, rect, documentRect: rect, bytes: crop.byteLength, captureStatus: "captured" }],
    }));
    const manifest = await buildManifest({
      out: root,
      sourceUrl: "https://example.com",
      viewports: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, sections: 1, regionExpectation: "required", captureStatus: "captured" }],
    });
    await writeManifest(root, manifest);

    const capture = async () => ({
      pages: [{ name: "desktop", viewport: { width: 1440, height: 1000 }, screenshot: png, observation: observed, html: null }],
      assets: [],
      warnings: [],
    });
    const { report } = await verifyClone({ sourceDir: root, cloneUrl: "http://localhost:3000", capture });
    assert.equal(report.machineGate, "pass");

    const storedManifest = await readManifest(root);
    const integrity = await verifyArtifacts(root, storedManifest);
    const binding = buildEvidenceBinding({ manifest: storedManifest, manifestSha256: integrity.manifestIntegrity?.sha256 ?? null, report });
    const gates = Object.fromEntries(MANUAL_GATES.map((gate) => [gate, "pass"]));
    const verdict = finalizeVerdict({ report, integrity, manifest: storedManifest, binding, review: { gates } });
    assert.equal(verdict.status, "fully_verified");
    await writeFile(join(root, "verification", "final-verdict.json"), JSON.stringify(verdict));
    await recordProjectStatus({
      sourceDir: root,
      status: statusFromVerdict(verdict.status),
      reason: "unit finalize",
      binding,
      sourceUrl: storedManifest.sourceUrl,
      cloneUrl: report.cloneUrl,
      verdictStatus: verdict.status,
    });

    const result = await generateHandoff({ sourceDir: root });
    assert.equal(result.status, "VERIFIED");
    for (const doc of HANDOFF_DOCUMENTS) {
      assert.ok((await readFile(join(result.out, doc.file), "utf8")).length > 0, `${doc.file} was not written`);
    }
    assert.ok(existsSync(join(result.out, "index.html")));
    assert.ok(existsSync(join(result.out, "tokens.css")));
    assert.ok(result.screenshots >= 3);

    const html = await readFile(join(result.out, "index.html"), "utf8");
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /onerror="/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
    for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|#)/.test(reference)) continue;
      const target = resolve(result.out, decodeURIComponent(reference.split("#")[0]));
      assert.ok(existsSync(target), `dashboard reference does not resolve: ${reference}`);
    }
    assert.match(await readFile(join(result.out, "COMPLETION-REPORT.md"), "utf8"), /VERIFIED/);
    assert.match(await readFile(join(result.out, "START-HERE.md"), "utf8"), /Delivery status: VERIFIED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
