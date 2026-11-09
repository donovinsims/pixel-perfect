#!/usr/bin/env node
import { absolute, parseArgs, requireOption, thresholdsFromArgs } from "../lib/core.mjs";
import { sectionDiff, visualDiffFiles } from "../lib/visual.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const clone = absolute(requireOption(args, "clone"));
  const out = absolute(requireOption(args, "out"));
  const thresholds = thresholdsFromArgs(args);
  const full = await visualDiffFiles({ sourceDir: source, cloneDir: clone, outDir: out, thresholds });
  console.log(`Generated ${full.results.length} visual comparisons in ${out}`);
  if (args["source-sections"] && args["clone-sections"]) {
    const sections = await sectionDiff({
      sourceDir: absolute(String(args["source-sections"])),
      cloneDir: absolute(String(args["clone-sections"])),
      outDir: out,
      thresholds,
    });
    console.log(`Generated section comparisons for ${sections.viewports.length} viewports in ${out}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
