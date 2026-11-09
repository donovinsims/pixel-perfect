#!/usr/bin/env node
import { join } from "node:path";
import { absolute, parseArgs, readJson, requireOption, resolveViewports, thresholdsFromArgs, viewportsFromManifest, writeJson } from "../lib/core.mjs";
import { captureTarget, writeCloneBundle } from "../lib/capture.mjs";
import { readManifest } from "../lib/evidence.mjs";
import { compareObservations } from "../lib/sections.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const cloneUrl = args["clone-url"] ? String(args["clone-url"]) : null;
  const cloneDir = args.clone ? absolute(String(args.clone)) : cloneUrl ? join(source, "verification", "clone") : null;
  if (!cloneDir) throw new Error("Provide --clone <dir> or --clone-url <url>.");
  const views = args.viewports ? resolveViewports(args.viewports) : viewportsFromManifest(await readManifest(source));

  if (cloneUrl) {
    const capture = await captureTarget({ url: cloneUrl, views });
    await writeCloneBundle({ out: cloneDir, capture });
  }

  const results = [];
  for (const view of views) {
    const sourceObservation = await readJson(join(source, "evidence", `observation-${view.name}.json`));
    const cloneObservation = await readJson(join(cloneDir, `observation-${view.name}.json`));
    const comparison = compareObservations(sourceObservation, cloneObservation);
    results.push({ viewport: view.name, ...comparison });
  }

  const out = absolute(requireOption(args, "out"));
  await writeJson(out, { generatedAt: new Date().toISOString(), source, clone: cloneDir, cloneUrl, results });
  const compared = results.reduce((total, result) => total + result.comparisons.length, 0);
  const styleMismatches = results.reduce((total, result) => total + result.comparisons.reduce((count, comparison) => count + (comparison.styleMismatches?.length ?? 0), 0), 0);
  console.log(`Geometry report: ${out} (${compared} regions, ${styleMismatches} style mismatches)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
