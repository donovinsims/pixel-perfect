#!/usr/bin/env node
import { absolute, parseArgs, requireOption } from "../lib/core.mjs";
import { generateHandoff } from "../lib/handoff.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const out = args.out ? absolute(String(args.out)) : null;
  const result = await generateHandoff({ sourceDir: source, out });
  console.log(`Handoff generated at ${result.out}`);
  console.log(`Delivery status: ${result.status}${result.stale ? ` (recorded: ${result.recordedStatus}, evidence changed since finalization)` : ""}`);
  console.log(`Documents: ${result.documents.length}; screenshots: ${result.screenshots}`);
  console.log(`Dashboard: ${result.dashboard}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
