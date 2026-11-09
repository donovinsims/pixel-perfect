#!/usr/bin/env node
import { captureTarget, writeCloneBundle } from "../lib/capture.mjs";
import { absolute, parseArgs, requireOption, resolveViewports } from "../lib/core.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const url = requireOption(args, "url");
  const out = absolute(requireOption(args, "out"));
  const views = resolveViewports(args.viewports);
  const capture = await captureTarget({ url, views });
  const bundle = await writeCloneBundle({ out, capture });
  const regions = Object.values(bundle.sections).reduce((total, section) => total + section.sections.length, 0);
  console.log(`Clone evidence: ${capture.pages.length} viewports, ${regions} regions in ${out}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
