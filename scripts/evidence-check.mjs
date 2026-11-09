#!/usr/bin/env node
import { join } from "node:path";
import { absolute, parseArgs, requireOption } from "../lib/core.mjs";
import { readManifest, verifyArtifacts } from "../lib/evidence.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const manifest = await readManifest(source);
  const integrity = await verifyArtifacts(source, manifest);
  console.log(JSON.stringify({
    source: join(source, "evidence", "manifest.json"),
    manifestVersion: manifest.version,
    toolVersion: manifest.tool?.version ?? null,
    sourceUrl: manifest.sourceUrl,
    capturedAt: manifest.capturedAt,
    viewports: (manifest.viewports ?? []).map((viewport) => viewport.name),
    artifacts: integrity.checked,
    ok: integrity.ok,
    missing: integrity.missing,
    mismatched: integrity.mismatched,
    warnings: manifest.warnings ?? [],
    message: integrity.message,
  }, null, 2));
  process.exitCode = integrity.ok ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
