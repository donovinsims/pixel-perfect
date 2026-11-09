import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { MANIFEST_VERSION, TOOL_VERSION, readJson, sha256 } from "./core.mjs";

const BUNDLE_DIRECTORIES = ["source", "evidence"];
const EXCLUDED = new Set(["evidence/manifest.json"]);

async function collectFiles(root, directory, acc) {
  const entries = await readdir(join(root, directory), { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectFiles(root, path, acc);
    else if (entry.isFile() && !EXCLUDED.has(path)) acc.push(path);
  }
  return acc;
}

/**
 * Manifest v3: artifact checksums make the frozen evidence tamper-evident.
 * Only the source bundle is hashed; verification output is intentionally
 * excluded so a new round does not rewrite the frozen baseline.
 */
export async function buildManifest({ out, sourceUrl, viewports, warnings = [], toolVersion = TOOL_VERSION }) {
  const files = [];
  for (const directory of BUNDLE_DIRECTORIES) await collectFiles(out, directory, files);
  const artifacts = [];
  for (const path of files.sort()) {
    const buffer = await readFile(join(out, path.split("/").join(sep)));
    artifacts.push({ path, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  return {
    version: MANIFEST_VERSION,
    tool: { name: "pixel-perfect-clone", version: toolVersion },
    sourceUrl,
    capturedAt: new Date().toISOString(),
    viewports,
    artifacts,
    warnings,
    safety: "Public rendering facts only; no copied scripts, credentials, headers, cookies, or response bodies.",
  };
}

export async function verifyArtifacts(root, manifest) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (!artifacts.length) {
    return { ok: false, checked: 0, missing: [], mismatched: [], message: "Manifest has no artifact checksums." };
  }
  const missing = [];
  const mismatched = [];
  for (const artifact of artifacts) {
    const buffer = await readFile(join(root, artifact.path.split("/").join(sep))).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!buffer) {
      missing.push(artifact.path);
      continue;
    }
    if (sha256(buffer) !== artifact.sha256) mismatched.push(artifact.path);
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    checked: artifacts.length,
    missing,
    mismatched,
    message: missing.length || mismatched.length
      ? `Evidence integrity failed: ${missing.length} missing, ${mismatched.length} modified.`
      : `Evidence integrity verified for ${artifacts.length} artifacts.`,
  };
}

export async function readManifest(root) {
  return readJson(join(root, "evidence", "manifest.json"));
}

export function relativeArtifact(root, path) {
  return relative(root, path).split(sep).join("/");
}
