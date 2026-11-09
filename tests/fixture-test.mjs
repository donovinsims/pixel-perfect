#!/usr/bin/env node
/**
 * Full browser fixture: capture, freeze, verify, triage, and regression.
 * Uses a controlled local page so every assertion is deterministic.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await readFile(join(root, "tests", "fixture.html"), "utf8");

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  let body = fixture;
  if (requestUrl.searchParams.has("drift")) body = body.replace("border-radius:14px", "border-radius:2px").replace("height:48px", "height:36px");
  if (requestUrl.searchParams.has("textdrift")) {
    body = body.replace("Measured CTA card", "Changed measured CTA card").replace('id="one"', 'id="uno"');
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const out = join(root, ".tmp-fixture");

function run(file, values) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "scripts", file), ...values], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function expectCode(file, values, expected) {
  const result = await run(file, values);
  assert.equal(
    result.code,
    expected,
    `${file} ${values.join(" ")} exited ${result.code}, expected ${expected}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

// A failing run must leave its evidence bundle behind so CI can upload it, and
// CI runs keep it even when green. A passing local run still cleans up.
const retainEvidence = /^(1|true|yes)$/i.test(process.env.CI ?? "");
let failed = false;

try {
  await rm(out, { recursive: true, force: true });

  // 1. Capture the source across presets plus an observed custom width.
  await expectCode("capture-source.mjs", ["--url", url, "--out", out, "--viewports", "desktop,tablet,mobile,1024"], 0);
  const manifest = await readJson(join(out, "evidence", "manifest.json"));
  assert.equal(manifest.version, 3);
  assert.equal(manifest.viewports.length, 4);
  assert.deepEqual(manifest.viewports.map((viewport) => viewport.name), ["desktop", "tablet", "mobile", "w1024"]);
  assert.ok(manifest.artifacts.length > 0);
  assert.ok(manifest.artifacts.some((artifact) => artifact.path === "evidence/tokens.json"));
  assert.ok(manifest.artifacts.some((artifact) => artifact.path === "evidence/manifest.json") === false);
  assert.ok(manifest.artifacts.some((artifact) => /^source\/sections\/desktop\/.+\.png$/.test(artifact.path)));
  assert.ok(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)));

  const desktopSections = await readJson(join(out, "evidence", "sections-desktop.json"));
  assert.equal(desktopSections.sections.length, 4);
  assert.deepEqual(desktopSections.sections.map((section) => section.slug), [
    "pixel-fixture-overview-pricing",
    "measured-cta-card",
    "transparent-pricing",
    "measured-footer-content",
  ]);
  for (const section of desktopSections.sections) assert.ok(section.bytes > 0, `${section.slug} was not cropped`);

  // 2. Frozen evidence is checksum-clean and the token report is generated.
  await expectCode("evidence-check.mjs", ["--source", out], 0);
  const tokens = await readJson(join(out, "evidence", "tokens.json"));
  assert.ok(tokens.colors.some((color) => color.value === "rgb(17, 24, 39)"));
  assert.ok(tokens.radii.some((radius) => radius.value === "14px"));
  assert.ok(tokens.breakpoints.mediaQueries.some((query) => query.maxWidth === 700));
  assert.ok(tokens.breakpoints.observedTransitions.some((transition) => transition.property === "gridTemplateColumns"));
  assert.match(await readFile(join(out, "evidence", "tokens.md"), "utf8"), /## Color/);

  const desktopObservation = await readJson(join(out, "evidence", "observation-desktop.json"));
  const mobileObservation = await readJson(join(out, "evidence", "observation-mobile.json"));
  assert.equal(desktopObservation.mediaQueries[0].maxWidth, 700);
  assert.ok(desktopObservation.fontFaces.some((face) => face.family === "Fixture Sans" && face.weight === "400"));
  assert.ok(Array.isArray(desktopObservation.fonts));
  const desktopCard = desktopObservation.sections.find((section) => section.heading === "Measured CTA card");
  const mobileCard = mobileObservation.sections.find((section) => section.heading === "Measured CTA card");
  assert.ok(desktopCard.before.backgroundImage.includes("radial-gradient"));
  assert.equal(desktopCard.style.borderRadius, "14px");
  assert.ok(desktopObservation.interactive.some((item) => item.style.borderRadius === "11px"));
  assert.notEqual(desktopCard.style.padding, mobileCard.style.padding);
  const desktopPricing = desktopObservation.sections.find((section) => section.heading === "Transparent pricing");
  const mobilePricing = mobileObservation.sections.find((section) => section.heading === "Transparent pricing");
  assert.equal(desktopPricing.style.gridTemplateColumns.trim().split(/\s+/).length, 2);
  assert.equal(mobilePricing.style.gridTemplateColumns.trim().split(/\s+/).length, 1);

  // 3. Token extraction can be re-run offline without touching frozen evidence.
  await expectCode("extract-tokens.mjs", ["--source", out], 0);
  assert.match(await readFile(join(out, "verification", "tokens", "tokens.md"), "utf8"), /Extracted design tokens/);
  await expectCode("evidence-check.mjs", ["--source", out], 0);

  // 4. Interaction states are captured without activating the page.
  await expectCode("capture-states.mjs", ["--url", url, "--out", out], 0);
  const states = await readJson(join(out, "evidence", "states-desktop.json"));
  assert.ok(states.length >= 3);
  const cta = states.find((state) => state.text === "Start now");
  assert.ok(cta, "CTA state was not captured");
  assert.ok(cta.hover && cta.hover.transform !== cta.base.transform);

  // 5. A missing clone fails the visual gate instead of passing silently.
  const emptyClone = join(out, "empty-clone");
  await mkdir(emptyClone, { recursive: true });
  await expectCode("visual-diff.mjs", ["--source", join(out, "source", "screenshots"), "--clone", emptyClone, "--out", join(out, "missing-diffs")], 0);
  const missing = await readJson(join(out, "missing-diffs", "visual-report.json"));
  assert.ok(missing.results.length === 4);
  assert.ok(missing.results.every((result) => result.missing && result.changeRatio === 1 && result.result === "fail"));

  // 6. Text drift cannot be measured by position; it becomes review.
  await expectCode("compare-geometry.mjs", ["--source", out, "--clone-url", `${url}?textdrift=1`, "--out", join(out, "text-drift-geometry.json")], 0);
  const textDrift = await readJson(join(out, "text-drift-geometry.json"));
  assert.ok(textDrift.results.some((result) => result.comparisons.some((comparison) => comparison.matchedBy === "index" && comparison.status === "review")));

  // 7. Deliberate visual drift fails verification and produces a correction plan.
  const drift = await run("verify-clone.mjs", ["--source", out, "--clone-url", `${url}?drift=1`]);
  assert.ok([1, 2].includes(drift.code), `drift verification exited ${drift.code}\n${drift.stdout}\n${drift.stderr}`);
  const driftReport = await readJson(join(out, "verification", "fidelity-report.json"));
  assert.notEqual(driftReport.machineGate, "pass");
  assert.ok(driftReport.sections.some((section) => section.name === "measured-cta-card" && section.dimensionMismatch));
  const driftTriage = await readJson(join(out, "verification", "triage.json"));
  assert.ok(driftTriage.summary.fix > 0);
  assert.ok(driftTriage.correctionPlan.some((entry) => entry.slug === "measured-cta-card" && entry.action === "FIX"));
  assert.ok(driftTriage.correctionPlan.length > 0);
  assert.match(await readFile(join(out, "verification", "triage.md"), "utf8"), /## Correction plan/);
  assert.ok(driftReport.correctionPlan.length > 0);

  // 8. The corrected clone passes every machine gate with no region left open.
  const corrected = await run("verify-clone.mjs", ["--source", out, "--clone-url", url]);
  assert.equal(corrected.code, 0, `corrected verification exited ${corrected.code}\n${corrected.stdout}\n${corrected.stderr}`);
  const correctedReport = await readJson(join(out, "verification", "fidelity-report.json"));
  assert.equal(correctedReport.machineGate, "pass");
  assert.equal(correctedReport.visualGate, "pass");
  assert.equal(correctedReport.sectionGate, "pass");
  assert.equal(correctedReport.geometryGate, "pass");
  assert.ok(correctedReport.geometrySummary.measured >= 4);
  assert.equal(correctedReport.geometrySummary.missing, 0);
  const correctedTriage = await readJson(join(out, "verification", "triage.json"));
  assert.equal(correctedTriage.summary.fix, 0);
  assert.equal(correctedTriage.summary.recheck, 0);
  assert.equal(correctedTriage.summary.keep, correctedTriage.summary.total);
  assert.equal(correctedTriage.correctionPlan.length, 0);

  // 9. Regression is not reclassified when the foundation is unchanged.
  const regression = await run("verify-clone.mjs", ["--source", out, "--clone-url", url, "--require-frozen"]);
  assert.equal(regression.code, 0, `regression verification exited ${regression.code}\n${regression.stdout}\n${regression.stderr}`);
  const regressionTriage = await readJson(join(out, "verification", "triage.json"));
  assert.equal(regressionTriage.viewports[0].foundationChanged, false);
  assert.equal(regressionTriage.summary.recheck, 0);
  assert.equal(regressionTriage.summary.keep, correctedTriage.summary.keep);

  // 10. Offline triage reproduces the same classification.
  const offline = await run("pixel-perfect-clone.mjs", ["triage", "--source", out]);
  assert.equal(offline.code, 0, `triage exited ${offline.code}\n${offline.stdout}\n${offline.stderr}`);
  const offlineTriage = await readJson(join(out, "verification", "triage.json"));
  assert.equal(offlineTriage.summary.keep, correctedTriage.summary.keep);

  // 11. Tampering with frozen evidence is detected.
  const artifact = manifest.artifacts.find((entry) => entry.path.startsWith("source/sections/desktop/") && entry.path.endsWith(".png"));
  const artifactPath = join(out, artifact.path);
  await writeFile(artifactPath, Buffer.concat([await readFile(artifactPath), Buffer.from([0])]));
  const tampered = await run("evidence-check.mjs", ["--source", out]);
  assert.equal(tampered.code, 1);
  const tamperReport = JSON.parse(tampered.stdout);
  assert.deepEqual(tamperReport.mismatched, [artifact.path]);
  assert.equal(tamperReport.ok, false);

  console.log("fixture: capture, tokens, states, section crops, missing-clone failure, drift triage, clean pass, regression, offline triage, and tamper detection all passed");
} catch (error) {
  failed = true;
  throw error;
} finally {
  server.close();
  if (failed || retainEvidence) {
    console.error(`fixture: evidence retained at ${out} (${failed ? "failure" : "CI"})`);
  } else {
    await rm(out, { recursive: true, force: true });
  }
}
