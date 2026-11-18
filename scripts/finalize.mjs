#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, parseArgs, readJson, readJsonIfExists, requireOption, writeJson } from "../lib/core.mjs";
import { readManifest, verifyArtifacts } from "../lib/evidence.mjs";
import { buildEvidenceBinding, recordProjectStatus, statusFromVerdict } from "../lib/lifecycle.mjs";
import { finalizeVerdict, renderFinalVerdictMarkdown } from "../lib/verdict.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(requireOption(args, "source"));
  const verification = join(source, "verification");
  const report = await readJson(join(verification, "fidelity-report.json"));
  const manifest = await readManifest(source);
  const integrity = await verifyArtifacts(source, manifest);
  const reviewPath = absolute(String(args.review || join(verification, "manual-review.json")));
  const review = await readJsonIfExists(reviewPath) ?? {};
  const binding = buildEvidenceBinding({ manifest, manifestSha256: integrity.manifestIntegrity?.sha256 ?? null, report });
  const verdict = finalizeVerdict({ report, review, integrity, manifest, binding });
  await writeJson(join(verification, "final-verdict.json"), verdict);
  await writeFile(join(verification, "final-verdict.md"), renderFinalVerdictMarkdown(verdict));
  const state = await recordProjectStatus({
    sourceDir: source,
    status: statusFromVerdict(verdict.status),
    reason: `finalize: ${verdict.status}`,
    binding: verdict.binding ?? binding,
    sourceUrl: manifest.sourceUrl,
    cloneUrl: report?.cloneUrl ?? null,
    verdictStatus: verdict.status,
  });
  console.log(`${verdict.status}: ${verdict.conclusion}`);
  console.log(`Project status: ${state.status}`);
  console.log(`Evidence binding: ${binding.fingerprint}`);
  const unresolved = Object.entries(verdict.manualGates).filter(([, status]) => status === "pending").map(([gate]) => gate);
  if (unresolved.length) console.log(`Unresolved manual gates: ${unresolved.join("; ")}`);
  if (!integrity.ok) console.log(`Evidence integrity: ${integrity.message}`);
  process.exitCode = verdict.status === "fully_verified" || verdict.status === "ready_with_limitations"
    ? 0
    : verdict.status === "manual_review_required" ? 2 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
