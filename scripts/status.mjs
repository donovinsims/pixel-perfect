#!/usr/bin/env node
import { join } from "node:path";
import { absolute, parseArgs, readJsonIfExists } from "../lib/core.mjs";
import { verifyArtifacts } from "../lib/evidence.mjs";
import { buildEvidenceBinding, readProjectState, resolveDeliveryStatus } from "../lib/lifecycle.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const source = absolute(String(args.source || ".clone"));
  const state = await readProjectState(source);
  let currentBinding = null;
  const manifest = await readJsonIfExists(join(source, "evidence", "manifest.json"));
  if (manifest) {
    const report = await readJsonIfExists(join(source, "verification", "fidelity-report.json"));
    let integrity = null;
    try {
      integrity = await verifyArtifacts(source, manifest);
    } catch {
      integrity = null;
    }
    currentBinding = buildEvidenceBinding({ manifest, manifestSha256: integrity?.manifestIntegrity?.sha256 ?? null, report });
  }
  const delivery = resolveDeliveryStatus({ state, currentFingerprint: currentBinding?.fingerprint ?? null });
  console.log(JSON.stringify({
    status: delivery.status,
    recordedStatus: delivery.recordedStatus,
    stale: delivery.stale,
    note: delivery.note,
    updatedAt: state.updatedAt,
    reason: state.reason,
    verdictStatus: state.verdictStatus,
    binding: state.binding,
    currentBinding,
    history: state.history.slice(-20),
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
