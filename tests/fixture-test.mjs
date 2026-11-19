#!/usr/bin/env node
/**
 * Full browser fixture: capture, freeze, verify, triage, and regression.
 * Uses a controlled local page so every assertion is deterministic.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MANUAL_GATES } from "../lib/core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await readFile(join(root, "tests", "fixture.html"), "utf8");

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname === "/robots.txt") {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(["User-agent: *", "Disallow: /private", `Sitemap: http://${request.headers.host}/sitemap.xml`, ""].join("\n"));
    return;
  }
  if (requestUrl.pathname === "/sitemap.xml") {
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.end(`<?xml version="1.0"?><urlset><url><loc>http://${request.headers.host}/sitemap-only</loc></url><url><loc>http://${request.headers.host}/about/?q=1</loc></url><url><loc>http://${request.headers.host}/about</loc></url></urlset>`);
    return;
  }
  if (requestUrl.pathname === "/missing") {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("not found");
    return;
  }
  if (requestUrl.pathname === "/state-pixel") {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
    return;
  }
  let body = fixture;
  if (requestUrl.searchParams.has("drift")) body = body.replace("border-radius:14px", "border-radius:2px").replace("height:48px", "height:36px");
  if (requestUrl.searchParams.has("textdrift")) {
    body = body.replace("Measured CTA card", "Changed measured CTA card").replace('id="one"', 'id="uno"');
  }
  if (requestUrl.pathname === "/") {
    body = body.replace("</body>", '<nav id="discovery-links"><a href="/about/">About</a><a href="/missing">Missing</a><a href="/private">Private</a><a href="https://example.invalid/out">External</a></nav></body>');
  }
  if (requestUrl.pathname === "/snapshot") {
    body = body.replace("</body>", '<style>:root{--snapshot-private:url("https://user:pass@example.invalid/asset?access_token=style-secret#fragment")}</style><script type="application/json">{"marker":"snapshot-script-secret"}</script><form style="display:none"><input type="password" value="snapshot-form-secret"></form><a style="display:none" href="/private?access_token=snapshot-url-secret#private">private link</a></body>');
  }
  if (requestUrl.pathname === "/state-css") {
    // Append the rule after the existing stylesheet: the .cta rule sets the
    // `background` shorthand, which would reset an earlier background-image.
    body = body.replace("</style>", `.cta{background-image:url("http://user:pass@127.0.0.1:${server.address().port}/state-pixel?state_token=state-secret#fragment")}</style>`);
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
  const snapshotOut = join(out, "sanitized-snapshot");
  await expectCode("capture-source.mjs", ["--url", `${url}/snapshot`, "--out", snapshotOut, "--viewports", "desktop"], 0);
  const snapshotHtml = await readFile(join(snapshotOut, "source", "rendered.html"), "utf8");
  assert.doesNotMatch(snapshotHtml, /<script\b/i);
  assert.doesNotMatch(snapshotHtml, /snapshot-script-secret|snapshot-form-secret|snapshot-url-secret|style-secret|user:pass|access_token|unsafe=1/);
  assert.match(snapshotHtml, /href="http:\/\/127\.0\.0\.1:[0-9]+\/private"/);
  const snapshotObservation = await readJson(join(snapshotOut, "evidence", "observation-desktop.json"));
  assert.equal(snapshotObservation.cssVariables["--snapshot-private"], 'url("https://example.invalid/asset")');

  const desktopSections = await readJson(join(out, "evidence", "sections-desktop.json"));
  assert.equal(desktopSections.sections.length, 4);
  assert.deepEqual(desktopSections.sections.map((section) => section.slug), [
    "pixel-fixture-overview-pricing",
    "measured-cta-card",
    "transparent-pricing",
    "measured-footer-content",
  ]);
  for (const section of desktopSections.sections) assert.ok(section.bytes > 0, `${section.slug} was not cropped`);

  // 2. Discover routes conservatively from sitemap and same-origin navigation.
  const discoveryOut = join(out, "discovery-run");
  await expectCode("pixel-perfect-clone.mjs", ["discover", "--url", url, "--out", discoveryOut, "--max-routes", "20", "--max-depth", "2"], 0);
  const routeInventoryPath = join(discoveryOut, "discovery", "routes.json");
  const routeInventory = await readJson(routeInventoryPath);
  const coverage = await readJson(join(discoveryOut, "discovery", "route-coverage.json"));
  assert.ok(routeInventory.routes.some((route) => route.routePath === "/about"));
  assert.ok(routeInventory.routes.some((route) => route.routePath === "/sitemap-only"));
  assert.equal(routeInventory.routes.some((route) => route.url.includes("example.invalid")), false);
  assert.equal(routeInventory.routes.filter((route) => route.routePath === "/about").length, 1);
  assert.ok(routeInventory.routes.some((route) => route.discoveryStatus === "robots_disallowed" && route.routePath === "/private"));
  assert.ok(coverage.missingPages.some((page) => page.url.endsWith("/missing") && page.status === 404));
  assert.match(await readFile(join(discoveryOut, "discovery", "SITE-MAP.md"), "utf8"), /Website route map/);
  const limitedOut = join(out, "limited-discovery");
  await expectCode("pixel-perfect-clone.mjs", ["discover", "--url", url, "--out", limitedOut, "--max-routes", "2", "--max-depth", "1"], 0);
  const limitedCoverage = await readJson(join(limitedOut, "discovery", "route-coverage.json"));
  assert.equal(limitedCoverage.discovered, 2);
  assert.equal(limitedCoverage.routeLimitReached, true);
  assert.equal(limitedCoverage.truncated, true);

  // Route capture respects robots exclusions and writes route-qualified evidence.
  const routeCaptureOut = join(out, "route-source");
  const routeCapture = await run("capture-source.mjs", ["--url", url, "--routes", routeInventoryPath, "--out", routeCaptureOut, "--viewports", "desktop"]);
  assert.equal(routeCapture.code, 1, `${routeCapture.stdout}\\n${routeCapture.stderr}`);
  const routeManifest = await readJson(join(routeCaptureOut, "evidence", "manifest.json"));
  assert.equal(routeManifest.viewports.length, routeInventory.routes.length);
  assert.ok(routeManifest.viewports.some((view) => view.routeId && view.routePath === "/about"));
  assert.ok(routeManifest.viewports.some((view) => view.routePath === "/private" && view.captureStatus === "failed"));
  assert.ok(routeManifest.artifacts.some((artifact) => artifact.path.startsWith("source/screenshots/route-")));

  const routeSubset = join(out, "route-subset.json");
  const successfulRoutes = routeInventory.routes.filter((route) => route.discoveryStatus === "captured" && ["/", "/about"].includes(route.routePath));
  assert.equal(successfulRoutes.length, 2);
  await writeFile(routeSubset, JSON.stringify({ ...routeInventory, routes: successfulRoutes }));
  const routeSubsetOut = join(out, "route-subset-source");
  await expectCode("capture-source.mjs", ["--url", url, "--routes", routeSubset, "--out", routeSubsetOut, "--viewports", "desktop"], 0);
  await expectCode("pixel-perfect-clone.mjs", ["export-design", "--source", routeSubsetOut], 0);
  const routeTokens = await readJson(join(routeSubsetOut, "evidence", "tokens.json"));
  assert.equal(routeTokens.captures.length, 2);
  assert.equal(new Set(routeTokens.captures.map((capture) => capture.routeId)).size, 2);
  assert.deepEqual(routeTokens.breakpoints.observedTransitions, []);
  const routeDesign = await readJson(join(routeSubsetOut, "design-system", "design-system.json"));
  assert.equal(routeDesign.sourceCaptures.length, 2);
  assert.ok(routeDesign.layout.observedSectionGeometry.every((layout) => layout.routeId));

  // Verify all discovered routes and finalize only after the machine report and human gates pass.
  await expectCode("verify-clone.mjs", ["--source", routeSubsetOut, "--clone-url", url], 0);
  const manualReviewPath = join(routeSubsetOut, "verification", "manual-review.json");
  const manualGates = {
    "structural completeness": "pass",
    "assets and loaded fonts": "pass",
    "high-value computed-style parity": "pass",
    "micro-detail audit": "pass",
    "observed meaningful interactions": "pass",
    "fresh independent review when supported": "pass",
    "post-correction regression": "pass",
  };
  await writeFile(manualReviewPath, JSON.stringify({ gates: manualGates, gateReasons: {}, limitations: [] }));
  await expectCode("finalize.mjs", ["--source", routeSubsetOut], 2);
  const finalVerdict = await readJson(join(routeSubsetOut, "verification", "final-verdict.json"));
  assert.equal(finalVerdict.status, "manual_review_required");
  assert.equal(finalVerdict.manualGates["discovery route coverage"], "pending");
  assert.equal(finalVerdict.manualGates["functional behavior verification"], "pending");
  assert.equal(finalVerdict.manualGates["build health"], "pending");
  assert.equal(finalVerdict.manualGates["handoff validation"], "pending");
  assert.doesNotMatch(finalVerdict.conclusion, /^VERIFIED/);
  const savedReportPath = join(routeSubsetOut, "verification", "fidelity-report.json");
  const savedReport = await readJson(savedReportPath);
  await writeFile(savedReportPath, JSON.stringify({ ...savedReport, sectionGate: "fail" }));
  await expectCode("finalize.mjs", ["--source", routeSubsetOut], 1);
  const rejectedVerdict = await readJson(join(routeSubsetOut, "verification", "final-verdict.json"));
  assert.equal(rejectedVerdict.status, "blocked");
  await writeFile(savedReportPath, JSON.stringify(savedReport));

  // 3. Frozen evidence is checksum-clean and the token report is generated.
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
  const stateCssOut = join(out, "state-css");
  await expectCode("capture-states.mjs", ["--url", `${url}/state-css`, "--out", stateCssOut], 0);
  const stateCss = await readJson(join(stateCssOut, "evidence", "states-desktop.json"));
  const stateCssText = JSON.stringify(stateCss);
  assert.doesNotMatch(stateCssText, /user:pass|state_token|state-secret|fragment/);
  assert.ok(stateCss.some((state) => state.base.backgroundImage.includes(`${url}/state-pixel`)));

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

  // 12. Complete delivery workflow: discover, capture, export-design, verify,
  // final review, finalize, handoff, and a dashboard inspected in a browser.
  const delivery = join(out, "delivery");
  await expectCode("pixel-perfect-clone.mjs", ["discover", "--url", url, "--out", delivery, "--max-routes", "20", "--max-depth", "2"], 0);
  const deliveryInventory = await readJson(join(delivery, "discovery", "routes.json"));
  const deliverableRoutes = deliveryInventory.routes.filter((route) => route.discoveryStatus === "captured");
  assert.ok(deliverableRoutes.length >= 2, `expected at least two capturable routes, found ${deliverableRoutes.length}`);
  await writeFile(join(delivery, "routes-subset.json"), JSON.stringify({ ...deliveryInventory, routes: deliverableRoutes }));
  await expectCode("capture-source.mjs", ["--url", url, "--routes", join(delivery, "routes-subset.json"), "--out", delivery, "--viewports", "desktop,mobile"], 0);
  await expectCode("pixel-perfect-clone.mjs", ["export-design", "--source", delivery], 0);
  await expectCode("verify-clone.mjs", ["--source", delivery, "--clone-url", url], 0);
  const deliveryReport = await readJson(join(delivery, "verification", "fidelity-report.json"));
  assert.equal(deliveryReport.machineGate, "pass");
  assert.equal(deliveryReport.viewports.length, deliverableRoutes.length * 2);
  assert.ok(deliveryReport.sections.length > 0);

  // Incomplete review cannot reach VERIFIED.
  const deliveryReview = join(delivery, "verification", "manual-review.json");
  const pendingGates = Object.fromEntries(MANUAL_GATES.map((gate) => [gate, gate === "handoff validation" ? "pending" : "pass"]));
  await writeFile(deliveryReview, JSON.stringify({ gates: pendingGates, gateReasons: {}, limitations: [] }));
  await expectCode("finalize.mjs", ["--source", delivery], 2);
  const awaiting = await readJson(join(delivery, "project-state.json"));
  assert.equal(awaiting.status, "AWAITING_REVIEW");
  assert.equal(awaiting.verdictStatus, "manual_review_required");
  const firstHandoff = await run("pixel-perfect-clone.mjs", ["handoff", "--source", delivery]);
  assert.equal(firstHandoff.code, 0, `${firstHandoff.stdout}\n${firstHandoff.stderr}`);
  assert.match(await readFile(join(delivery, "handoff", "COMPLETION-REPORT.md"), "utf8"), /AWAITING_REVIEW/);

  // Complete review reaches VERIFIED and the handoff reflects that verdict.
  const completeGates = Object.fromEntries(MANUAL_GATES.map((gate) => [gate, "pass"]));
  await writeFile(deliveryReview, JSON.stringify({ gates: completeGates, gateReasons: {}, limitations: [] }));
  await expectCode("finalize.mjs", ["--source", delivery], 0);
  const verified = await readJson(join(delivery, "project-state.json"));
  assert.equal(verified.status, "VERIFIED");
  assert.ok(verified.history.length >= 3);
  assert.ok(verified.binding?.fingerprint);

  // Repeated finalization is safe and idempotent.
  await expectCode("finalize.mjs", ["--source", delivery], 0);
  const repeated = await readJson(join(delivery, "project-state.json"));
  assert.equal(repeated.status, "VERIFIED");
  assert.equal(repeated.binding.fingerprint, verified.binding.fingerprint);

  // Project state survives a new process.
  const statusRun = await expectCode("pixel-perfect-clone.mjs", ["status", "--source", delivery], 0);
  const statusJson = JSON.parse(statusRun.stdout);
  assert.equal(statusJson.status, "VERIFIED");
  assert.equal(statusJson.stale, false);

  await expectCode("pixel-perfect-clone.mjs", ["handoff", "--source", delivery], 0);
  const handoff = join(delivery, "handoff");
  for (const name of ["START-HERE.md", "COMPLETION-REPORT.md", "REBUILD-GUIDE.md", "KNOWN-LIMITATIONS.md", "SITE-MAP.md", "PAGE-BLUEPRINTS.md", "INTERACTIONS.md", "DESIGN-GUIDE.md", "COMPONENTS.md", "RESPONSIVE-RULES.md", "tokens.json", "tokens.css", "index.html"]) {
    assert.ok((await readFile(join(handoff, name), "utf8")).length > 0, `${name} is missing from the handoff package`);
  }
  assert.match(await readFile(join(handoff, "COMPLETION-REPORT.md"), "utf8"), /VERIFIED/);
  assert.match(await readFile(join(handoff, "SITE-MAP.md"), "utf8"), /## Routes/);
  const handoffManifest = await readJson(join(delivery, "evidence", "manifest.json"));
  for (const viewport of handoffManifest.viewports) {
    assert.ok((await readFile(join(handoff, "screenshots", "original", `${viewport.name}.png`))).length > 0, `${viewport.name} original screenshot missing`);
    assert.ok((await readFile(join(handoff, "screenshots", "reconstructed", `${viewport.name}.png`))).length > 0, `${viewport.name} reconstructed screenshot missing`);
    assert.ok((await readFile(join(handoff, "screenshots", "diff", `${viewport.name}.png`))).length > 0, `${viewport.name} diff screenshot missing`);
  }

  // The dashboard is opened and interacted with in a real browser.
  const { chromium } = await import("playwright");
  const dashboardBrowser = await chromium.launch({ headless: true });
  try {
    const dashboard = await dashboardBrowser.newPage();
    const dashboardErrors = [];
    dashboard.on("pageerror", (error) => dashboardErrors.push(String(error)));
    const dashboardUrl = pathToFileURL(join(handoff, "index.html")).href;
    await dashboard.goto(dashboardUrl, { waitUntil: "load" });
    assert.ok(await dashboard.locator("h1").first().isVisible(), "dashboard heading is not visible");
    const dashboardData = await dashboard.evaluate(() => JSON.parse(document.getElementById("dashboard-data").textContent));
    assert.equal(dashboardData.status, "VERIFIED");
    await dashboard.locator('[data-tab="screens"]').click();
    assert.ok(await dashboard.locator('[data-panel="screens"]').isVisible(), "screens panel did not open");
    assert.equal(await dashboard.locator('[data-panel="overview"]').isVisible(), false);
    const viewNames = await dashboard.locator("[data-view-target]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-view-target")));
    assert.ok(viewNames.length >= 2, "expected a viewport selector with multiple captures");
    await dashboard.locator(`[data-view-target="${viewNames[1]}"]`).click();
    assert.ok(await dashboard.locator(`[data-view-panel="${viewNames[1]}"]`).isVisible(), "selected view panel is hidden");
    assert.equal(await dashboard.locator(`[data-view-panel="${viewNames[0]}"]`).isVisible(), false);
    await dashboard.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await dashboard.waitForTimeout(250);
    const images = await dashboard.evaluate(() => [...document.images].map((image) => ({ src: image.currentSrc || image.src, width: image.naturalWidth })));
    assert.ok(images.length > 0, "dashboard rendered no screenshots");
    assert.ok(images.every((image) => image.width > 0), `screenshots failed to load: ${images.filter((image) => !image.width).map((image) => image.src).join(", ")}`);
    const references = await dashboard.evaluate(() => [...document.querySelectorAll("[href], [src]")].map((node) => node.getAttribute("href") ?? node.getAttribute("src")));
    for (const reference of references) {
      if (!reference || reference.startsWith("#") || /^https?:/i.test(reference)) continue;
      const target = fileURLToPath(new URL(reference, dashboardUrl));
      assert.ok(existsSync(target), `dashboard reference does not resolve: ${reference}`);
    }
    assert.equal(references.some((reference) => /^javascript:/i.test(reference ?? "")), false);
    assert.deepEqual(dashboardErrors, []);
  } finally {
    await dashboardBrowser.close();
  }

  // Missing evidence can never reach VERIFIED, and the handoff reports that.
  const negative = join(out, "negative-delivery");
  await cp(delivery, negative, { recursive: true });
  const negativeManifest = await readJson(join(negative, "evidence", "manifest.json"));
  const doomed = negativeManifest.artifacts.find((artifact) => artifact.path.startsWith("source/screenshots/"));
  assert.ok(doomed, "expected a checksummed screenshot artifact");
  await rm(join(negative, doomed.path));
  await expectCode("finalize.mjs", ["--source", negative], 1);
  const blocked = await readJson(join(negative, "project-state.json"));
  assert.equal(blocked.status, "BLOCKED");
  await expectCode("pixel-perfect-clone.mjs", ["handoff", "--source", negative], 0);
  const blockedStart = await readFile(join(negative, "handoff", "START-HERE.md"), "utf8");
  assert.match(blockedStart, /BLOCKED/);
  assert.doesNotMatch(blockedStart, /Delivery status: VERIFIED/);

  console.log("fixture: capture, tokens, states, section crops, missing-clone failure, drift triage, clean pass, regression, offline triage, tamper detection, delivery workflow, dashboard, and blocked finalization all passed");
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
