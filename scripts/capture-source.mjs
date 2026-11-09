#!/usr/bin/env node
import { captureTarget, writeSourceBundle } from "../lib/capture.mjs";
import { absolute, parseArgs, requireOption, resolveViewports } from "../lib/core.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const url = requireOption(args, "url");
  const out = absolute(args.out || ".clone");
  const views = resolveViewports(args.viewports);
  const capture = await captureTarget({ url, views, captureHtml: true });
  const { manifest, summaries } = await writeSourceBundle({ out, capture, sourceUrl: url });
  console.log(`Captured ${summaries.length} responsive source views in ${out}`);
  for (const summary of summaries) {
    console.log(`  ${summary.name} ${summary.viewport.width}x${summary.viewport.height}: ${summary.sections} regions, ${summary.cropped} cropped`);
  }
  console.log(`Frozen evidence: ${manifest.artifacts.length} checksummed artifacts in ${out}/evidence/manifest.json`);
  if (manifest.warnings.length) {
    for (const warning of manifest.warnings) console.log(`  warning: ${warning}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
