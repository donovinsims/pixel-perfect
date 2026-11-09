import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  DEFAULT_THRESHOLDS,
  parseArgs,
  resolveViewports,
  safeName,
  thresholdsFromArgs,
  viewportsFromManifest,
} from "../lib/core.mjs";
import { clampRect, cropPng } from "../lib/crops.mjs";
import { buildManifest, verifyArtifacts } from "../lib/evidence.mjs";
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
  summarizeGate,
} from "../lib/verdict.mjs";
import { diffPng } from "../lib/visual.mjs";

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

test("sectionSlugs is content-derived, deterministic, and deduplicated", () => {
  const sections = [section({ index: 0, heading: "Pricing" }), section({ index: 1, text: "Pricing" }), section({ index: 2, text: "" })];
  const slugs = sectionSlugs(sections);
  assert.match(slugs[0], /^pricing-[0-9a-f]{6}$/);
  assert.notEqual(slugs[1], slugs[0]);
  assert.match(slugs[2], /^section-[0-9a-f]{6}$/);
  assert.deepEqual(sectionSlugs(sections), slugs);
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
  assert.equal(classifySectionVisual(null, thresholds), "review");
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
  assert.equal(summarizeGate([]), "pass");
  assert.equal(exitCodeFor("pass"), 0);
  assert.equal(exitCodeFor("fail"), 1);
  assert.equal(exitCodeFor("review"), 2);
  assert.equal(exitCodeFor("review", { allowReview: true }), 0);
});

const triageInput = ({ cloneSections = [section({ index: 0 })], visual = { hero: { changeRatio: 0, dimensionMismatch: false, missing: false } }, previous = null, cloneOverrides = {} } = {}) => {
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
      sectionVisual: { hero: { changeRatio: 0, dimensionMismatch: false, missing: false } },
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
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "source", "desktop.png"), "image-bytes");
    await writeFile(join(root, "evidence", "observation-desktop.json"), "{\"sections\":[]}");
    const manifest = await buildManifest({ out: root, sourceUrl: "https://example.com", viewports: [{ name: "desktop", viewport: { width: 1440, height: 1000 } }] });
    assert.equal(manifest.version, 3);
    assert.equal(manifest.artifacts.length, 2);
    assert.ok(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)));

    const clean = await verifyArtifacts(root, manifest);
    assert.equal(clean.ok, true);
    assert.equal(clean.checked, 2);

    await writeFile(join(root, "source", "desktop.png"), "tampered");
    const tampered = await verifyArtifacts(root, manifest);
    assert.equal(tampered.ok, false);
    assert.deepEqual(tampered.mismatched, ["source/desktop.png"]);

    await rm(join(root, "evidence", "observation-desktop.json"));
    const missing = await verifyArtifacts(root, manifest);
    assert.deepEqual(missing.missing, ["evidence/observation-desktop.json"]);
    assert.match(missing.message, /integrity failed/);

    assert.equal((await verifyArtifacts(root, { artifacts: [] })).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fidelity report fails closed when a report is missing", () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const cleanVisual = { results: [{ viewport: "desktop", changedPixels: 0, totalPixels: 100, changeRatio: 0, dimensionMismatch: false, missing: false }] };
  const cleanSections = { viewports: [{ viewport: "desktop", sections: [{ name: "hero", changeRatio: 0, dimensionMismatch: false, missing: false, source: { width: 10, height: 10 }, clone: { width: 10, height: 10 } }], extra: [] }] };
  const cleanGeometry = { results: [{ viewport: "desktop", comparisons: [{ matchedBy: "text", status: "measured", deltas: { x: 0, y: 0, width: 0, height: 0 }, styleMismatches: [] }] }] };
  const manifest = { sourceUrl: "https://example.com", tool: { version: "3.0.0" } };
  const pass = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: cleanVisual, sections: cleanSections, geometry: cleanGeometry, triage: null, thresholds });
  assert.equal(pass.machineGate, "pass");
  assert.equal(pass.conclusion.startsWith("Not verified"), true);

  const fail = buildFidelityReport({ manifest, cloneUrl: "http://localhost:3000", visual: { results: [] }, sections: cleanSections, geometry: cleanGeometry, triage: null, thresholds });
  assert.equal(fail.machineGate, "fail");

  const extra = buildFidelityReport({
    manifest,
    cloneUrl: "http://localhost:3000",
    visual: cleanVisual,
    sections: { viewports: [{ viewport: "desktop", sections: [], extra: ["invented-region"] }] },
    geometry: cleanGeometry,
    triage: null,
    thresholds,
  });
  assert.deepEqual(extra.extraRegions, [{ viewport: "desktop", name: "invented-region" }]);
});

test("core exports the documented defaults", () => {
  assert.equal(DEFAULT_THRESHOLDS.visual.pass, 0.005);
  assert.equal(DEFAULT_THRESHOLDS.visual.review, 0.02);
  assert.deepEqual(DEFAULT_THRESHOLDS.geometry, { xy: 1, size: 2 });
});
