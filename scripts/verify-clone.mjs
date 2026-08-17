#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { absolute, parseArgs, requireOption, readJson, writeJson } from "../lib/core.mjs";

const args = parseArgs(process.argv.slice(2));
const source = absolute(requireOption(args, "source"));
const cloneUrl = requireOption(args, "clone-url");
const verification = join(source, "verification");
const scripts = new URL(".", import.meta.url);
const run = (file, values) => new Promise((resolve, reject) => {
  const processHandle = spawn(process.execPath, [fileURLToPath(new URL(file, scripts)), ...values], { stdio: "inherit" });
  processHandle.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)));
});

await mkdir(verification, { recursive: true });
await run("screenshot-target.mjs", ["--url", cloneUrl, "--out", join(verification, "clone-screenshots")]);
await run("visual-diff.mjs", ["--source", join(source, "source", "screenshots"), "--clone", join(verification, "clone-screenshots"), "--out", join(verification, "diffs")]);
await run("compare-geometry.mjs", ["--source", source, "--clone-url", cloneUrl, "--out", join(verification, "geometry-report.json")]);

const manifest = await readJson(join(source, "evidence", "manifest.json"));
const visual = await readJson(join(verification, "diffs", "visual-report.json"));
const geometry = await readJson(join(verification, "geometry-report.json"));
const viewports = visual.results.map((result) => ({
  ...result,
  result: result.missing || result.dimensionMismatch || result.changeRatio > 0.02
    ? "fail"
    : result.changeRatio > 0.005
      ? "review"
      : "pass",
}));
const visualGate = viewports.some((viewport) => viewport.result === "fail")
  ? "fail"
  : viewports.some((viewport) => viewport.result === "review")
    ? "review"
    : "pass";

const geometryComparisons = geometry.results.flatMap((result) => result.comparisons.map((comparison) => ({ viewport: result.viewport, ...comparison })));
const geometryGate = geometryComparisons.some((comparison) => comparison.status === "fail")
  ? "fail"
  : geometryComparisons.some((comparison) => {
      if (comparison.status === "review") return true;
      const { x = 0, y = 0, width = 0, height = 0 } = comparison.deltas || {};
      const styleMismatch = comparison.styleMatches && Object.values(comparison.styleMatches).some((matches) => !matches);
      return Math.abs(x) > 1 || Math.abs(y) > 1 || Math.abs(width) > 2 || Math.abs(height) > 2 || styleMismatch;
    })
    ? "review"
    : "pass";
const machineGate = visualGate === "fail" || geometryGate === "fail"
  ? "fail"
  : visualGate === "review" || geometryGate === "review"
    ? "review"
    : "pass";

const report = {
  sourceUrl: manifest.sourceUrl,
  cloneUrl,
  generatedAt: new Date().toISOString(),
  visualGate,
  geometryGate,
  machineGate,
  conclusion: "Not verified — manual structure, asset/font, micro-detail, interaction, independent-review, and regression gates remain.",
  viewports,
  geometrySummary: {
    measured: geometryComparisons.filter((comparison) => comparison.matchedBy === "text").length,
    review: geometryComparisons.filter((comparison) => comparison.status === "review").length,
    missing: geometryComparisons.filter((comparison) => comparison.status === "fail").length,
  },
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

await writeJson(join(verification, "fidelity-report.json"), report);
await writeFile(join(verification, "fidelity-report.md"), `# Fidelity report\n\n- Source: ${report.sourceUrl}\n- Clone: ${cloneUrl}\n- Visual gate: **${visualGate}**\n- Geometry gate: **${geometryGate}**\n- Machine gate: **${machineGate}**\n- Conclusion: **${report.conclusion}**\n\n| Viewport | Changed pixels | Ratio | Missing | Dimension mismatch | Result |\n| --- | ---: | ---: | --- | --- | --- |\n${viewports.map((viewport) => `| ${viewport.viewport} | ${viewport.changedPixels} | ${(viewport.changeRatio * 100).toFixed(3)}% | ${viewport.missing ? "yes" : "no"} | ${viewport.dimensionMismatch ? "yes" : "no"} | ${viewport.result} |`).join("\n")}\n\nGeometry: ${report.geometrySummary.measured} measured; ${report.geometrySummary.review} review; ${report.geometrySummary.missing} missing.\n\nRequired manual gates: ${report.requiredManualGates.join("; ")}\n`);
console.log(`Verification report: ${join(verification, "fidelity-report.md")}`);
