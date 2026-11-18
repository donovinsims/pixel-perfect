#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, parseArgs, readJson, requireOption, viewportsFromManifest, writeJson } from "../lib/core.mjs";
import { readManifest } from "../lib/evidence.mjs";
import { buildDesignSystem, renderDesignSystemMarkdown, renderDesignTokensCss } from "../lib/design-system.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const manifest = await readManifest(source);
  const observations = {};
  for (const view of viewportsFromManifest(manifest)) {
    const observation = await readJson(join(source, "evidence", `observation-${view.name}.json`));
    observations[view.name] = {
      ...observation,
      routeId: view.routeId ?? observation.routeId ?? null,
      routePath: view.routePath ?? observation.routePath ?? null,
      viewportName: view.viewportName ?? observation.viewportName ?? view.name,
    };
  }
  const system = buildDesignSystem(observations);
  const out = absolute(String(args.out || join(source, "design-system")));
  await mkdir(out, { recursive: true });
  await writeJson(join(out, "design-system.json"), system);
  await writeFile(join(out, "DESIGN-SYSTEM.md"), renderDesignSystemMarkdown(system));
  await writeFile(join(out, "tokens.css"), renderDesignTokensCss(system));
  console.log(`Design documentation exported to ${out} (${system.components.length} component signatures, ${system.typography.headingHierarchy.length} heading styles).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
