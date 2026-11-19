import { isDeepStrictEqual } from "node:util";
import { join, resolve } from "node:path";

/**
 * Gate classification and fidelity reporting. All functions here are pure so
 * verdicts can be tested without a browser.
 */

export const SECTION_SIZE_TOLERANCE = 2;
export const MANUAL_GATES = [
  "discovery route coverage",
  "structural completeness",
  "assets and loaded fonts",
  "high-value computed-style parity",
  "micro-detail audit",
  "functional behavior verification",
  "observed meaningful interactions",
  "build health",
  "handoff validation",
  "fresh independent review when supported",
  "post-correction regression",
];

function validRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function validVisualThresholds(thresholds) {
  return Number.isFinite(thresholds?.visual?.pass) && Number.isFinite(thresholds?.visual?.review) &&
    thresholds.visual.pass >= 0 && thresholds.visual.review <= 1 && thresholds.visual.pass <= thresholds.visual.review;
}

export function classifyVisualResult(result, thresholds) {
  if (!result || result.missing || result.dimensionMismatch || !validVisualThresholds(thresholds)) return "fail";
  const ratio = validRatio(result.changeRatio);
  if (ratio === null) return "fail";
  if (ratio > thresholds.visual.review) return "fail";
  if (ratio > thresholds.visual.pass) return "review";
  return "pass";
}

/** Section diffs tolerate a little reflow, but absent evidence fails closed. */
export function classifySectionVisual(result, thresholds) {
  if (!result || result.missing || !validVisualThresholds(thresholds)) return "fail";
  const ratio = validRatio(result.changeRatio);
  if (ratio === null) return "fail";
  const cloneWidth = Number(result.clone?.width ?? result.width);
  const cloneHeight = Number(result.clone?.height ?? result.height);
  const sourceWidth = Number(result.source?.width);
  const sourceHeight = Number(result.source?.height);
  if (![cloneWidth, cloneHeight, sourceWidth, sourceHeight].every(Number.isFinite) || [cloneWidth, cloneHeight, sourceWidth, sourceHeight].some((dimension) => dimension < 1)) return "fail";
  if (result.dimensionMismatch) {
    if (![cloneWidth, cloneHeight, sourceWidth, sourceHeight].every(Number.isFinite)) return "fail";
    const widthDelta = Math.abs(cloneWidth - sourceWidth);
    const heightDelta = Math.abs(cloneHeight - sourceHeight);
    if (widthDelta > SECTION_SIZE_TOLERANCE || heightDelta > SECTION_SIZE_TOLERANCE) return "fail";
    return "review";
  }
  if (ratio > thresholds.visual.review) return "fail";
  if (ratio > thresholds.visual.pass) return "review";
  return "pass";
}

/** Empty, missing, unknown, or invalid status collections are never proof. */
export function summarizeGate(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return "fail";
  if (statuses.some((status) => status === "fail" || !["pass", "review"].includes(status))) return "fail";
  if (statuses.some((status) => status === "review")) return "review";
  return "pass";
}

export function classifyGeometryComparison(comparison, thresholds) {
  if (!comparison || comparison.matchedBy === "missing" || comparison.status === "fail") return "fail";
  if (!["text", "id", "heading", "index", "ambiguous"].includes(comparison.matchedBy)) return "fail";
  const deltas = comparison.deltas;
  if (!deltas || !["x", "y", "width", "height"].every((key) => typeof deltas[key] === "number" && Number.isFinite(deltas[key]))) return "fail";
  if (!Array.isArray(comparison.styleMismatches)) return "fail";
  const { xy, size } = thresholds?.geometry ?? {};
  if (!Number.isFinite(xy) || !Number.isFinite(size) || xy < 0 || size < 0) return "fail";
  if (Math.abs(Number(deltas.x)) > xy || Math.abs(Number(deltas.y)) > xy) return "review";
  if (Math.abs(Number(deltas.width)) > size || Math.abs(Number(deltas.height)) > size) return "review";
  if (comparison.styleMismatches.length) return "review";
  if (["index", "ambiguous"].includes(comparison.matchedBy) || comparison.status === "review") return "review";
  if (comparison.status !== "measured") return "fail";
  return "pass";
}

/** 0 = pass, 1 = fail, 2 = review (attention required, not a pass). */
export function exitCodeFor(machineGate, { allowReview = false } = {}) {
  if (machineGate === "pass") return 0;
  if (machineGate === "review") return allowReview ? 0 : 2;
  return 1;
}

function expectedRegionCount(manifestViewport) {
  const count = Number(manifestViewport?.sections);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function documentedNoRegions(manifestViewport) {
  return manifestViewport?.regionExpectation === "documented-none";
}

function completeViewportCoverage(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length === 0) return false;
  const expectedNames = expected.map((entry) => entry.name);
  const actualNames = actual.map((entry) => entry.viewport);
  return expectedNames.every((name) => typeof name === "string") &&
    new Set(expectedNames).size === expectedNames.length &&
    new Set(actualNames).size === actualNames.length &&
    expectedNames.length === actualNames.length &&
    actualNames.every((name) => expectedNames.includes(name));
}

/** Recompute machine gates from the serialized report before allowing finalization. */
function validateMachineReport(report, manifest) {
  const expected = Array.isArray(manifest?.viewports) ? manifest.viewports : [];
  if (!expected.length || typeof manifest?.capturedAt !== "string" || report?.sourceCapturedAt !== manifest.capturedAt || report?.sourceUrl !== manifest.sourceUrl) return null;
  if (!Array.isArray(report.requiredManualGates) || report.requiredManualGates.length !== MANUAL_GATES.length || MANUAL_GATES.some((gate, index) => report.requiredManualGates[index] !== gate)) return null;
  const names = new Set(expected.map((entry) => entry?.name));
  if (names.size !== expected.length || expected.some((entry) => !entry || entry.captureStatus === "failed")) return null;
  const thresholds = report.thresholds;

  const visualEntries = Array.isArray(report.viewports) ? report.viewports : [];
  if (!completeViewportCoverage(expected, visualEntries)) return null;
  const visualGate = summarizeGate(visualEntries.map((entry) => {
    const status = classifyVisualResult(entry, thresholds);
    return entry.result === status ? status : "fail";
  }));

  if (!Array.isArray(report.sections) || !Array.isArray(report.extraRegions)) return null;
  if (report.sections.some((section) => !names.has(section.viewport)) || report.extraRegions.length) return null;
  const sectionStatuses = expected.map((viewport) => {
    const items = report.sections.filter((section) => section.viewport === viewport.name);
    const count = expectedRegionCount(viewport);
    if (count === 0 && documentedNoRegions(viewport)) return items.length === 0 ? "pass" : "fail";
    if (count === null || count === 0 || items.length !== count) return "fail";
    return summarizeGate(items.map((section) => {
      const status = classifySectionVisual(section, thresholds);
      return section.result === status ? status : "fail";
    }));
  });
  const sectionGate = summarizeGate(sectionStatuses);

  const geometryEntries = Array.isArray(report.geometryResults) ? report.geometryResults : [];
  if (!completeViewportCoverage(expected, geometryEntries)) return null;
  const geometryStatuses = expected.map((viewport) => {
    const entry = geometryEntries.find((candidate) => candidate.viewport === viewport.name);
    if (!entry || !Array.isArray(entry.comparisons) || !Array.isArray(entry.extra) || entry.extra.length) return "fail";
    const count = expectedRegionCount(viewport);
    if (count === 0 && documentedNoRegions(viewport)) return entry.comparisons.length === 0 ? "pass" : "fail";
    if (count === null || count === 0 || entry.comparisons.length !== count) return "fail";
    return summarizeGate(entry.comparisons.map((comparison) => classifyGeometryComparison(comparison, thresholds)));
  });
  const geometryGate = summarizeGate(geometryStatuses);
  const machineGate = summarizeGate([visualGate, sectionGate, geometryGate]);
  const consistent = report.visualGate === visualGate && report.sectionGate === sectionGate &&
    report.geometryGate === geometryGate && report.machineGate === machineGate &&
    report.machineChecksPassed === (machineGate === "pass") &&
    report.finalStatus === (machineGate === "fail" ? "failed" : "manual_review_required");
  return consistent ? { visualGate, sectionGate, geometryGate, machineGate } : null;
}

export function buildFidelityReport({ manifest, cloneUrl, visual, sections, geometry, triage, thresholds }) {
  const sourceViewports = Array.isArray(manifest?.viewports) ? manifest.viewports : [];
  const visualResults = Array.isArray(visual?.results) ? visual.results : [];
  const viewports = visualResults.map((result) => ({ ...result, result: classifyVisualResult(result, thresholds) }));
  const visualByName = new Map(viewports.map((entry) => [entry.viewport, entry]));
  const visualStatuses = sourceViewports.map((entry) => visualByName.get(entry.name)?.result ?? "fail");
  if (!completeViewportCoverage(sourceViewports, viewports)) visualStatuses.push("fail");
  const visualGate = summarizeGate(visualStatuses);

  const sectionViewports = Array.isArray(sections?.viewports) ? sections.viewports : [];
  const sectionByName = new Map(sectionViewports.map((entry) => [entry.viewport, entry]));
  const sectionResults = sectionViewports.flatMap((viewport) => (Array.isArray(viewport.sections) ? viewport.sections : []).map((section) => ({ viewport: viewport.viewport, ...section })));
  const sectionStatuses = sourceViewports.map((manifestViewport) => {
    const viewport = sectionByName.get(manifestViewport.name);
    if (!viewport) return "fail";
    if ((viewport.extra ?? []).length) return "fail";
    const expected = expectedRegionCount(manifestViewport);
    if (expected === 0 && documentedNoRegions(manifestViewport)) {
      return viewport.expectedCount === 0 && viewport.regionExpectation === "documented-none" &&
        viewport.sections?.length === 0 && viewport.coverage === "not_expected" ? "pass" : "fail";
    }
    if (expected === null || expected === 0 || viewport.coverage !== "complete" || viewport.expectedCount !== expected) return "fail";
    const statuses = (viewport.sections ?? []).map((section) => classifySectionVisual(section, thresholds));
    return statuses.length === expected ? summarizeGate(statuses) : "fail";
  });
  if (!completeViewportCoverage(sourceViewports, sectionViewports)) sectionStatuses.push("fail");
  const sectionGate = summarizeGate(sectionStatuses);

  const geometryResults = Array.isArray(geometry?.results) ? geometry.results : [];
  const geometryByName = new Map(geometryResults.map((entry) => [entry.viewport, entry]));
  const geometryComparisons = geometryResults.flatMap((result) => (Array.isArray(result.comparisons) ? result.comparisons : []).map((comparison) => ({ viewport: result.viewport, ...comparison })));
  const geometryStatuses = sourceViewports.map((manifestViewport) => {
    const result = geometryByName.get(manifestViewport.name);
    if (!result || !Array.isArray(result.comparisons)) return "fail";
    const expected = expectedRegionCount(manifestViewport);
    if (!Array.isArray(result.extra) || result.extra.length) return "fail";
    if (expected === 0 && documentedNoRegions(manifestViewport)) return result.comparisons.length === 0 ? "pass" : "fail";
    if (expected === null || expected === 0 || result.comparisons.length !== expected) return "fail";
    return summarizeGate(result.comparisons.map((comparison) => classifyGeometryComparison(comparison, thresholds)));
  });
  if (!completeViewportCoverage(sourceViewports, geometryResults)) geometryStatuses.push("fail");
  const geometryGate = summarizeGate(geometryStatuses);
  const machineGate = sourceViewports.length ? summarizeGate([visualGate, sectionGate, geometryGate]) : "fail";
  const machineChecksPassed = machineGate === "pass";
  const conclusion = machineGate === "fail"
    ? "Failed — one or more required machine checks failed or were unavailable."
    : machineGate === "review"
      ? "Manual review required — machine checks found unresolved review-band results."
      : "Machine checks passed — manual and functional review is still required before verification.";

  return {
    toolVersion: manifest?.tool?.version ?? null,
    sourceUrl: manifest?.sourceUrl ?? null,
    sourceCapturedAt: manifest?.capturedAt ?? null,
    cloneUrl,
    generatedAt: new Date().toISOString(),
    thresholds,
    visualGate,
    sectionGate,
    geometryGate,
    machineGate,
    machineChecksPassed,
    finalStatus: machineGate === "fail" ? "failed" : "manual_review_required",
    conclusion,
    viewports,
    sections: sectionResults,
    geometryResults,
    geometrySummary: {
      measured: geometryComparisons.filter((comparison) => ["text", "id", "heading"].includes(comparison.matchedBy)).length,
      review: geometryComparisons.filter((comparison) => ["index", "ambiguous"].includes(comparison.matchedBy)).length,
      missing: geometryComparisons.filter((comparison) => comparison.matchedBy === "missing").length,
      styleMismatches: geometryComparisons.reduce((total, comparison) => total + (comparison.styleMismatches?.length ?? 0), 0),
    },
    triageSummary: triage?.summary ?? null,
    correctionPlan: triage?.correctionPlan ?? [],
    extraRegions: sectionViewports.flatMap((viewport) => (viewport.extra ?? []).map((name) => ({ viewport: viewport.viewport, name }))),
    requiredManualGates: MANUAL_GATES,
    manualGates: Object.fromEntries(MANUAL_GATES.map((gate) => [gate, "pending"])),
  };
}

/** Apply explicit human review and mandatory frozen-evidence integrity. */
export function finalizeVerdict({ report, review = {}, integrity, manifest, binding = null }) {
  const gates = review?.gates && typeof review.gates === "object" && !Array.isArray(review.gates) ? review.gates : {};
  const suppliedReasons = review?.gateReasons && typeof review.gateReasons === "object" && !Array.isArray(review.gateReasons) ? review.gateReasons : {};
  const limitations = Array.isArray(review?.limitations)
    ? [...new Set(review.limitations.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  const gateReasons = Object.fromEntries(MANUAL_GATES.map((gate) => [gate, typeof suppliedReasons[gate] === "string" ? suppliedReasons[gate].trim() : ""]));
  const manualGates = Object.fromEntries(MANUAL_GATES.map((gate) => {
    const status = gates[gate];
    const valid = ["pass", "review", "fail", "blocked", "not_applicable"].includes(status);
    const documented = status !== "not_applicable" || (gateReasons[gate] && limitations.includes(gateReasons[gate]));
    return [gate, valid && documented ? status : "pending"];
  }));
  const validatedMachine = validateMachineReport(report, manifest);
  const reviewBinding = review?.binding && typeof review.binding === "object" && !Array.isArray(review.binding) ? review.binding : null;
  const staleReview = Boolean(reviewBinding?.fingerprint && binding?.fingerprint && reviewBinding.fingerprint !== binding.fingerprint);
  let status;
  let conclusion;
  if (staleReview) {
    status = "blocked";
    conclusion = "Blocked — the human review is bound to different evidence than the current baseline or verification round; review the current round and finalize again.";
  } else if (!integrity?.ok) {
    status = "blocked";
    conclusion = `Blocked — frozen source evidence integrity is not verified${integrity?.message ? ` (${integrity.message})` : "."}`;
  } else if (!validatedMachine) {
    status = "blocked";
    conclusion = "Blocked — the machine report is missing, stale, inconsistent, or incomplete for the current source manifest.";
  } else if (validatedMachine.machineGate === "fail") {
    status = "failed";
    conclusion = "Failed — required machine verification failed.";
  } else if (Object.values(manualGates).includes("fail")) {
    status = "failed";
    conclusion = "Failed — a required manual review gate failed.";
  } else if (Object.values(manualGates).includes("blocked")) {
    status = "blocked";
    conclusion = "Blocked — a required manual review gate is blocked.";
  } else if (
    validatedMachine.machineGate !== "pass" ||
    Object.values(manualGates).some((value) => !["pass", "not_applicable"].includes(value))
  ) {
    status = "manual_review_required";
    conclusion = "Manual review required — machine checks and every required review gate must pass or have a documented limitation.";
  } else if (limitations.length || Object.values(manualGates).includes("not_applicable")) {
    status = "ready_with_limitations";
    conclusion = `Ready with limitations — ${limitations.join("; ")}`;
  } else {
    status = "fully_verified";
    conclusion = "VERIFIED — all required machine checks, manual reviews, and evidence-integrity checks passed.";
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceUrl: report?.sourceUrl ?? null,
    cloneUrl: report?.cloneUrl ?? null,
    machineGate: validatedMachine?.machineGate ?? report?.machineGate ?? "fail",
    machineChecksPassed: validatedMachine?.machineGate === "pass",
    integrity,
    manualGates,
    gateReasons,
    limitations,
    binding,
    status,
    conclusion,
  };
}

export function renderReportMarkdown(report) {
  const viewportRows = report.viewports.map((viewport) => `| ${viewport.viewport} | ${viewport.changedPixels} | ${(viewport.changeRatio * 100).toFixed(3)}% | ${viewport.missing ? "yes" : "no"} | ${viewport.dimensionMismatch ? "yes" : "no"} | ${viewport.result} |`).join("\n");
  const sectionRows = report.sections.map((section) => `| ${section.viewport} | ${section.name} | ${(Number(section.changeRatio ?? 0) * 100).toFixed(3)}% | ${section.missing ? "yes" : "no"} | ${section.dimensionMismatch ? "yes" : "no"} |`).join("\n");
  const plan = report.correctionPlan?.length
    ? report.correctionPlan.map((entry) => `- **${entry.action}** \`${entry.slug}\` (${entry.viewports.join(", ")}) — ${entry.evidence.join(" ")}`).join("\n")
    : "- No measured drift; continue with the manual gates.";
  const triage = report.triageSummary
    ? `${report.triageSummary.keep} KEEP / ${report.triageSummary.fix} FIX / ${report.triageSummary.recheck} RECHECK across ${report.viewports.length} viewports`
    : "not generated";
  return `# Fidelity report

- Source: ${report.sourceUrl}
- Clone: ${report.cloneUrl}
- Tool: pixel-perfect-clone ${report.toolVersion ?? ""}
- Visual gate (full page): **${report.visualGate}**
- Visual gate (sections): **${report.sectionGate}**
- Geometry gate: **${report.geometryGate}**
- Machine gate: **${report.machineGate}**
- Triage: ${triage}
- Conclusion: **${report.conclusion}**

## Full-page comparison

| Viewport | Changed pixels | Ratio | Missing | Dimension mismatch | Result |
| --- | ---: | ---: | --- | --- | --- |
${viewportRows || "| - | - | - | - | - | fail |"}

## Section comparison

| Viewport | Region | Ratio | Missing | Dimension mismatch |
| --- | --- | ---: | --- | --- |
${sectionRows || "| - | no region evidence | - | - | - |"}

## Geometry

${report.geometrySummary.measured} measured; ${report.geometrySummary.review} uncertain (review); ${report.geometrySummary.missing} missing; ${report.geometrySummary.styleMismatches} style mismatches.

## Correction plan

${plan}

## Required manual gates

${report.requiredManualGates.map((gate) => `- [ ] ${gate}`).join("\n")}
`;
}

export function renderFinalVerdictMarkdown(verdict) {
  const gates = Object.entries(verdict.manualGates).map(([gate, status]) => {
    const reason = verdict.gateReasons?.[gate] ? ` — ${verdict.gateReasons[gate]}` : "";
    return `- ${status === "pass" ? "[x]" : "[ ]"} ${gate}: **${status}**${reason}`;
  }).join("\n");
  const limitations = verdict.limitations.length ? verdict.limitations.map((item) => `- ${item}`).join("\n") : "- None documented.";
  const binding = verdict.binding?.fingerprint
    ? `- Evidence binding: **${verdict.binding.fingerprint}**\n- Bound baseline: ${verdict.binding.baselineSha256 ? `**${verdict.binding.baselineSha256}**` : "not recorded"}\n- Verification round: ${verdict.binding.roundGeneratedAt ?? "not recorded"}\n`
    : "";
  return `# Final verification verdict\n\n- Status: **${verdict.status}**\n- Conclusion: ${verdict.conclusion}\n- Machine checks: **${verdict.machineChecksPassed ? "passed" : "not passed"}**\n- Frozen evidence: **${verdict.integrity?.ok ? "verified" : "blocked"}**\n${binding}\n## Manual gates\n\n${gates}\n\n## Limitations\n\n${limitations}\n`;
}
