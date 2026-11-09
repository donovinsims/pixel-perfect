/**
 * Gate classification and fidelity reporting. All functions here are pure so
 * the verdict can be unit tested without a browser.
 */

export const SECTION_SIZE_TOLERANCE = 2;

export function classifyVisualResult(result, thresholds) {
  if (!result) return "fail";
  if (result.missing) return "fail";
  if (result.dimensionMismatch) return "fail";
  const ratio = Number(result.changeRatio ?? 1);
  if (ratio > thresholds.visual.review) return "fail";
  if (ratio > thresholds.visual.pass) return "review";
  return "pass";
}

/**
 * Section diffs tolerate a little reflow. A size change larger than the
 * section tolerance is a real structural difference, not rounding.
 */
export function classifySectionVisual(result, thresholds) {
  if (!result) return "review";
  const cloneWidth = result.clone?.width ?? result.width ?? 0;
  const cloneHeight = result.clone?.height ?? result.height ?? 0;
  const sourceWidth = result.source?.width ?? 0;
  const sourceHeight = result.source?.height ?? 0;
  if (result.missing) return "fail";
  if (result.dimensionMismatch) {
    const widthDelta = Math.abs(cloneWidth - sourceWidth);
    const heightDelta = Math.abs(cloneHeight - sourceHeight);
    return widthDelta > SECTION_SIZE_TOLERANCE || heightDelta > SECTION_SIZE_TOLERANCE ? "fail" : "review";
  }
  const ratio = Number(result.changeRatio ?? 1);
  if (ratio > thresholds.visual.review) return "fail";
  if (ratio > thresholds.visual.pass) return "review";
  return "pass";
}

export function summarizeGate(statuses) {
  if (statuses.some((status) => status === "fail")) return "fail";
  if (statuses.some((status) => status === "review")) return "review";
  return "pass";
}

export function classifyGeometryComparison(comparison, thresholds) {
  if (!comparison) return "fail";
  if (comparison.matchedBy === "missing") return "fail";
  if (comparison.status === "fail") return "fail";
  const deltas = comparison.deltas || {};
  const { xy, size } = thresholds.geometry;
  if (Math.abs(deltas.x ?? 0) > xy || Math.abs(deltas.y ?? 0) > xy) return "review";
  if (Math.abs(deltas.width ?? 0) > size || Math.abs(deltas.height ?? 0) > size) return "review";
  if ((comparison.styleMismatches || []).length) return "review";
  if (comparison.matchedBy === "index" || comparison.status === "review") return "review";
  return "pass";
}

/** 0 = pass, 1 = fail, 2 = review (attention required, not a pass). */
export function exitCodeFor(machineGate, { allowReview = false } = {}) {
  if (machineGate === "pass") return 0;
  if (machineGate === "review") return allowReview ? 0 : 2;
  return 1;
}

export function buildFidelityReport({ manifest, cloneUrl, visual, sections, geometry, triage, thresholds }) {
  const viewports = (visual?.results ?? []).map((result) => ({ ...result, result: classifyVisualResult(result, thresholds) }));
  const visualGate = summarizeGate(viewports.map((viewport) => viewport.result));
  const sectionResults = (sections?.viewports ?? []).flatMap((viewport) => viewport.sections.map((section) => ({ viewport: viewport.viewport, ...section })));
  const sectionGate = summarizeGate(sectionResults.map((section) => classifySectionVisual(section, thresholds)));
  const geometryComparisons = (geometry?.results ?? []).flatMap((result) => result.comparisons.map((comparison) => ({ viewport: result.viewport, ...comparison })));
  const geometryGate = summarizeGate(geometryComparisons.map((comparison) => classifyGeometryComparison(comparison, thresholds)));
  const missingReports = !viewports.length;
  const machineGate = missingReports ? "fail" : summarizeGate([visualGate, sectionGate, geometryGate]);

  return {
    toolVersion: manifest?.tool?.version ?? null,
    sourceUrl: manifest?.sourceUrl ?? null,
    cloneUrl,
    generatedAt: new Date().toISOString(),
    thresholds,
    visualGate,
    sectionGate,
    geometryGate,
    machineGate,
    conclusion: "Not verified — manual structure, asset/font, micro-detail, interaction, independent-review, and regression gates remain.",
    viewports,
    sections: sectionResults,
    geometrySummary: {
      measured: geometryComparisons.filter((comparison) => comparison.matchedBy === "text" || comparison.matchedBy === "id" || comparison.matchedBy === "heading").length,
      review: geometryComparisons.filter((comparison) => comparison.matchedBy === "index").length,
      missing: geometryComparisons.filter((comparison) => comparison.matchedBy === "missing").length,
      styleMismatches: geometryComparisons.reduce((total, comparison) => total + (comparison.styleMismatches?.length ?? 0), 0),
    },
    triageSummary: triage?.summary ?? null,
    correctionPlan: triage?.correctionPlan ?? [],
    extraRegions: (sections?.viewports ?? []).flatMap((viewport) => (viewport.extra ?? []).map((name) => ({ viewport: viewport.viewport, name }))),
    requiredManualGates: [
      "structural completeness",
      "assets and loaded fonts",
      "high-value computed-style parity",
      "micro-detail audit",
      "observed meaningful interactions",
      "fresh independent review when supported",
      "post-correction regression",
    ],
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
${sectionRows || "| - | no section crops | - | - | - |"}

## Geometry

${report.geometrySummary.measured} measured; ${report.geometrySummary.review} positional-only (review); ${report.geometrySummary.missing} missing; ${report.geometrySummary.styleMismatches} style mismatches.

## Correction plan

${plan}

## Required manual gates

${report.requiredManualGates.map((gate) => `- [ ] ${gate}`).join("\n")}
`;
}
