#!/usr/bin/env node
import { absolute, parseArgs, requireOption, resolveViewports, thresholdsFromArgs } from "../lib/core.mjs";
import { exitCodeFor } from "../lib/verdict.mjs";
import { verifyClone } from "../lib/verify.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = absolute(requireOption(args, "source"));
  const cloneUrl = requireOption(args, "clone-url");
  const thresholds = thresholdsFromArgs(args);
  const views = args.viewports ? resolveViewports(args.viewports) : undefined;
  const { report, triage, paths } = await verifyClone({
    sourceDir,
    cloneUrl,
    views,
    thresholds,
    requireFrozen: Boolean(args["require-frozen"]),
  });
  console.log(`Verification report: ${paths.reportMarkdown}`);
  console.log(`Triage: ${paths.triageMarkdown}`);
  console.log(`Machine gate: ${report.machineGate} (full page ${report.visualGate}, sections ${report.sectionGate}, geometry ${report.geometryGate})`);
  console.log(`Regions: ${triage.summary.keep} KEEP / ${triage.summary.fix} FIX / ${triage.summary.recheck} RECHECK`);
  console.log(`Next action: ${triage.nextAction}`);
  process.exitCode = exitCodeFor(report.machineGate, { allowReview: Boolean(args["allow-review"]) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
