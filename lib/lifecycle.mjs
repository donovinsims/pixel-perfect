import { join } from "node:path";
import { readJsonIfExists, sha256, writeJson } from "./core.mjs";

/**
 * Persistent project lifecycle. The status file lives in the evidence root so
 * every command can read the same authoritative delivery decision, across
 * separate processes and sessions.
 */
export const PROJECT_STATUSES = Object.freeze([
  "IN_PROGRESS",
  "AWAITING_REVIEW",
  "VERIFIED",
  "READY_WITH_LIMITATIONS",
  "BLOCKED",
  "FAILED",
]);

export const PROJECT_STATE_FILE = "project-state.json";

const FINALIZED_STATUSES = new Set(["VERIFIED", "READY_WITH_LIMITATIONS"]);

export function statusFromVerdict(verdictStatus) {
  switch (verdictStatus) {
    case "fully_verified":
      return "VERIFIED";
    case "ready_with_limitations":
      return "READY_WITH_LIMITATIONS";
    case "manual_review_required":
      return "AWAITING_REVIEW";
    case "failed":
      return "FAILED";
    case "blocked":
      return "BLOCKED";
    default:
      return "IN_PROGRESS";
  }
}

/**
 * A fingerprint of exactly which baseline and verification round a decision
 * covers: source, capture time, manifest checksum, routes, viewports, region
 * counts, and the round the machine report was generated in.
 */
export function buildEvidenceBinding({ manifest = null, manifestSha256 = null, report = null } = {}) {
  const viewports = (manifest?.viewports ?? []).map((viewport) => ({
    name: viewport?.name ?? null,
    routeId: viewport?.routeId ?? null,
    routePath: viewport?.routePath ?? null,
    width: viewport?.viewport?.width ?? null,
    height: viewport?.viewport?.height ?? null,
    sections: Number.isInteger(viewport?.sections) ? viewport.sections : null,
    regionExpectation: viewport?.regionExpectation ?? null,
  }));
  const fingerprint = sha256(JSON.stringify({
    sourceUrl: manifest?.sourceUrl ?? null,
    capturedAt: manifest?.capturedAt ?? null,
    baseline: manifestSha256 ?? null,
    round: report?.generatedAt ?? null,
    viewports,
  }));
  return {
    fingerprint,
    baselineSha256: manifestSha256 ?? null,
    capturedAt: manifest?.capturedAt ?? null,
    roundGeneratedAt: report?.generatedAt ?? null,
    sourceUrl: manifest?.sourceUrl ?? null,
    captures: viewports.map((viewport) => viewport.name),
    routes: [...new Set(viewports.map((viewport) => viewport.routePath).filter(Boolean))],
    viewports: [...new Set(viewports.map((viewport) => viewport.width).filter((width) => width !== null))],
    regions: viewports.reduce((total, viewport) => total + (viewport.sections ?? 0), 0),
  };
}

export async function readProjectState(sourceDir) {
  const stored = await readJsonIfExists(join(sourceDir, PROJECT_STATE_FILE));
  if (!stored) {
    return {
      version: 1,
      status: "IN_PROGRESS",
      updatedAt: null,
      reason: "No finalization has been recorded for this bundle.",
      sourceUrl: null,
      cloneUrl: null,
      binding: null,
      verdictStatus: null,
      history: [],
    };
  }
  if (!PROJECT_STATUSES.includes(stored.status)) throw new Error(`Invalid persisted project status: ${stored.status}`);
  return {
    version: 1,
    status: "IN_PROGRESS",
    updatedAt: null,
    reason: null,
    sourceUrl: null,
    cloneUrl: null,
    binding: null,
    verdictStatus: null,
    ...stored,
    history: Array.isArray(stored.history) ? stored.history : [],
  };
}

export async function recordProjectStatus({ sourceDir, status, reason = null, binding = null, sourceUrl = null, cloneUrl = null, verdictStatus = null }) {
  if (!PROJECT_STATUSES.includes(status)) throw new Error(`Unsupported project status: ${status}`);
  const state = await readProjectState(sourceDir);
  const at = new Date().toISOString();
  const entry = { at, status, reason, binding, verdictStatus };
  const history = [...state.history, entry].slice(-100);
  const next = {
    version: 1,
    status,
    updatedAt: at,
    reason,
    sourceUrl: sourceUrl ?? state.sourceUrl ?? null,
    cloneUrl: cloneUrl ?? state.cloneUrl ?? null,
    binding: binding ?? state.binding ?? null,
    verdictStatus,
    history,
  };
  await writeJson(join(sourceDir, PROJECT_STATE_FILE), next);
  return next;
}

/**
 * Delivery status is only as good as the evidence it was bound to. If the
 * baseline or verification round changed after finalization, a finalized
 * status is demoted instead of being presented as current.
 */
export function resolveDeliveryStatus({ state, currentFingerprint = null } = {}) {
  const status = PROJECT_STATUSES.includes(state?.status) ? state.status : "IN_PROGRESS";
  const recordedFingerprint = state?.binding?.fingerprint ?? null;
  const stale = Boolean(recordedFingerprint && currentFingerprint && recordedFingerprint !== currentFingerprint);
  if (stale && FINALIZED_STATUSES.has(status)) {
    return {
      status: "AWAITING_REVIEW",
      recordedStatus: status,
      stale: true,
      note: "The evidence bundle or verification round changed after the last finalization; re-run verify and finalize before delivery.",
    };
  }
  return {
    status,
    recordedStatus: status,
    stale,
    note: stale
      ? "Evidence changed since the last recorded finalization."
      : status === "IN_PROGRESS"
        ? "No completed verification round has been finalized."
        : "Delivery status matches the recorded finalization.",
  };
}
