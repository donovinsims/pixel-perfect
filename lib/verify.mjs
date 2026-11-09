import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_THRESHOLDS,
  readJson,
  readJsonIfExists,
  viewportsFromManifest,
  writeJson,
} from "./core.mjs";
import { captureTarget, writeCloneBundle } from "./capture.mjs";
import { readManifest, verifyArtifacts } from "./evidence.mjs";
import { buildTriage, compareObservations, renderTriageMarkdown } from "./sections.mjs";
import { buildFidelityReport, renderReportMarkdown } from "./verdict.mjs";
import { sectionDiff, visualDiffFiles } from "./visual.mjs";

export function sectionVisualIndex(report, viewport) {
  const entry = (report?.viewports ?? []).find((item) => item.viewport === viewport);
  if (!entry) return null;
  return Object.fromEntries((entry.sections ?? []).map((section) => [section.name, section]));
}

async function loadViewportInputs({ sourceDir, cloneDir, views, geometry, sectionsReport }) {
  const viewports = [];
  for (const view of views) {
    const sourceObservation = await readJson(join(sourceDir, "evidence", `observation-${view.name}.json`));
    const cloneObservation = await readJson(join(cloneDir, `observation-${view.name}.json`));
    const result = (geometry?.results ?? []).find((entry) => entry.viewport === view.name);
    viewports.push({
      viewport: view.name,
      sourceObservation,
      cloneObservation,
      comparisons: result?.comparisons ?? compareObservations(sourceObservation, cloneObservation).comparisons,
      sectionVisual: sectionVisualIndex(sectionsReport, view.name),
    });
  }
  return viewports;
}

/**
 * Re-classify an existing verification round and write triage.json / triage.md.
 * Shared by `verify` and the standalone `triage` command so both produce the
 * same KEEP / FIX / RECHECK output.
 */
export async function writeTriageRound({ sourceDir, cloneDir, views, geometry, sectionsReport, thresholds, sourceUrl, cloneUrl }) {
  const verificationDir = join(sourceDir, "verification");
  const previous = await readJsonIfExists(join(verificationDir, "triage.json"));
  const triage = buildTriage({
    viewports: await loadViewportInputs({ sourceDir, cloneDir, views, geometry, sectionsReport }),
    sourceUrl,
    cloneUrl,
    thresholds,
    previous,
  });
  await writeJson(join(verificationDir, "triage.json"), triage);
  await writeFile(join(verificationDir, "triage.md"), renderTriageMarkdown(triage));
  return triage;
}

/** Offline re-triage from an existing verification round. */
export async function triageEvidence({ sourceDir, thresholds = DEFAULT_THRESHOLDS, cloneUrl = null }) {
  const manifest = await readManifest(sourceDir);
  const views = viewportsFromManifest(manifest);
  const verificationDir = join(sourceDir, "verification");
  const geometry = await readJson(join(verificationDir, "geometry-report.json")).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`No verification round found in ${verificationDir}; run verify first.`);
    throw error;
  });
  const sectionsReport = await readJsonIfExists(join(verificationDir, "sections", "sections-report.json"));
  const triage = await writeTriageRound({
    sourceDir,
    cloneDir: join(verificationDir, "clone"),
    views,
    geometry,
    sectionsReport,
    thresholds,
    sourceUrl: manifest.sourceUrl,
    cloneUrl: cloneUrl ?? geometry.cloneUrl ?? null,
  });
  return { triage, manifest, views };
}

export async function verifyClone({
  sourceDir,
  cloneUrl,
  views,
  thresholds = DEFAULT_THRESHOLDS,
  requireFrozen = false,
  capture = captureTarget,
}) {
  const manifest = await readManifest(sourceDir);
  const resolvedViews = views ?? viewportsFromManifest(manifest);
  let integrity = null;
  if (requireFrozen) {
    integrity = await verifyArtifacts(sourceDir, manifest);
    if (!integrity.ok) throw new Error(integrity.message);
  }

  const verificationDir = join(sourceDir, "verification");
  const cloneDir = join(verificationDir, "clone");
  const cloneCapture = await capture({ url: cloneUrl, views: resolvedViews });
  await writeCloneBundle({ out: cloneDir, capture: cloneCapture });

  const visual = await visualDiffFiles({
    sourceDir: join(sourceDir, "source", "screenshots"),
    cloneDir,
    outDir: join(verificationDir, "diffs"),
    thresholds,
  });
  const sections = await sectionDiff({
    sourceDir: join(sourceDir, "source", "sections"),
    cloneDir: join(cloneDir, "sections"),
    outDir: join(verificationDir, "sections"),
    thresholds,
  });

  const results = [];
  for (const view of resolvedViews) {
    const sourceObservation = await readJson(join(sourceDir, "evidence", `observation-${view.name}.json`));
    const cloneObservation = await readJson(join(cloneDir, `observation-${view.name}.json`));
    const comparison = compareObservations(sourceObservation, cloneObservation);
    results.push({ viewport: view.name, ...comparison });
  }
  const geometry = { generatedAt: new Date().toISOString(), source: sourceDir, clone: cloneDir, cloneUrl, results };
  await writeJson(join(verificationDir, "geometry-report.json"), geometry);

  const triage = await writeTriageRound({
    sourceDir,
    cloneDir,
    views: resolvedViews,
    geometry,
    sectionsReport: sections,
    thresholds,
    sourceUrl: manifest.sourceUrl,
    cloneUrl,
  });

  const report = buildFidelityReport({ manifest, cloneUrl, visual, sections, geometry, triage, thresholds });
  await writeJson(join(verificationDir, "fidelity-report.json"), report);
  await writeFile(join(verificationDir, "fidelity-report.md"), renderReportMarkdown(report));

  return {
    report,
    triage,
    integrity,
    paths: {
      verificationDir,
      cloneDir,
      reportJson: join(verificationDir, "fidelity-report.json"),
      reportMarkdown: join(verificationDir, "fidelity-report.md"),
      triageJson: join(verificationDir, "triage.json"),
      triageMarkdown: join(verificationDir, "triage.md"),
      geometryReport: join(verificationDir, "geometry-report.json"),
    },
  };
}
