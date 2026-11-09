#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, parseArgs, readJson, requireOption, viewportsFromManifest, writeJson } from "../lib/core.mjs";
import { readManifest } from "../lib/evidence.mjs";
import { extractTokens, renderTokensMarkdown } from "../lib/tokens.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const manifest = await readManifest(source);
  const views = viewportsFromManifest(manifest);
  const observations = {};
  for (const view of views) {
    observations[view.name] = await readJson(join(source, "evidence", `observation-${view.name}.json`));
  }
  const tokens = extractTokens(observations);
  const out = absolute(String(args.out || join(source, "verification", "tokens")));
  await mkdir(out, { recursive: true });
  await writeJson(join(out, "tokens.json"), tokens);
  await writeFile(join(out, "tokens.md"), renderTokensMarkdown(tokens));
  console.log(`Design tokens: ${join(out, "tokens.md")} (${tokens.colors.length} colors, ${tokens.typography.scale.length} type steps, ${tokens.radii.length} radii)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
