import { cp, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join, relative, sep } from "node:path";
import { MANIFEST_VERSION, TOOL_VERSION, readJson, sha256, writeJson } from "./core.mjs";

const BUNDLE_DIRECTORIES = ["source", "evidence"];
const EXCLUDED = new Set(["evidence/manifest.json", "evidence/manifest.sha256"]);

async function collectFiles(root, directory, acc, { includeSymlinks = false, invalidPaths = [] } = {}) {
  const absolutePath = join(root, directory);
  const stat = await lstat(absolutePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return acc;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    invalidPaths.push(directory);
    if (includeSymlinks && !EXCLUDED.has(directory)) acc.push(directory);
    return acc;
  }
  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      invalidPaths.push(path);
      if (includeSymlinks && !EXCLUDED.has(path)) acc.push(path);
    } else if (entry.isDirectory()) {
      await collectFiles(root, path, acc, { includeSymlinks, invalidPaths });
    } else if (entry.isFile() && !EXCLUDED.has(path)) {
      acc.push(path);
    } else {
      invalidPaths.push(path);
    }
  }
  return acc;
}

export async function assertSafeBundleRoot(root) {
  const rootStat = await lstat(root).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Unsafe evidence output root: ${root}`);
  const invalidPaths = [];
  for (const directory of BUNDLE_DIRECTORIES) {
    const stat = await lstat(join(root, directory)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) invalidPaths.push(directory);
    else if (stat) await collectFiles(root, directory, [], { invalidPaths });
  }
  if (invalidPaths.length) throw new Error(`Unsafe evidence bundle entries: ${[...new Set(invalidPaths)].sort().join(", ")}`);
}

/**
 * Manifest v3: artifact checksums make the frozen evidence tamper-evident.
 * Only the source bundle is hashed; verification output is intentionally
 * excluded so a new round does not rewrite the frozen baseline.
 */
export async function buildManifest({ out, sourceUrl, viewports, warnings = [], toolVersion = TOOL_VERSION, captureProfile = null }) {
  await assertSafeBundleRoot(out);
  const files = [];
  const invalidPaths = [];
  for (const directory of BUNDLE_DIRECTORIES) await collectFiles(out, directory, files, { invalidPaths });
  if (invalidPaths.length) throw new Error(`Unsafe evidence bundle entries: ${[...new Set(invalidPaths)].sort().join(", ")}`);
  const artifacts = [];
  for (const path of files.sort()) {
    const buffer = await readFile(join(out, path.split("/").join(sep)));
    artifacts.push({ path, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  const requiredArtifacts = new Set();
  const manifestViewports = [];
  for (const viewport of viewports ?? []) {
    if (!viewport?.name) continue;
    requiredArtifacts.add(`source/screenshots/${viewport.name}.png`);
    requiredArtifacts.add(`evidence/observation-${viewport.name}.json`);
    requiredArtifacts.add(`evidence/sections-${viewport.name}.json`);
    const summaryPath = join(out, "evidence", `sections-${viewport.name}.json`);
    const summary = await readFile(summaryPath, "utf8").then(JSON.parse, () => null);
    const sectionSlugs = (summary?.sections ?? []).map((section) => section.slug);
    for (const slug of sectionSlugs) requiredArtifacts.add(`source/sections/${viewport.name}/${slug}.png`);
    manifestViewports.push({ ...viewport, sectionSlugs });
  }
  for (const path of files) if (/^evidence\/states-[^/]+\.json$/.test(path)) requiredArtifacts.add(path);
  return {
    version: MANIFEST_VERSION,
    tool: { name: "pixel-perfect-clone", version: toolVersion },
    sourceUrl,
    capturedAt: new Date().toISOString(),
    captureProfile,
    viewports: manifestViewports,
    requiredArtifacts: [...requiredArtifacts].sort(),
    manifestChecksum: "evidence/manifest.sha256",
    interactionStates: files.filter((path) => /^evidence\/states-[^/]+\.json$/.test(path)).sort(),
    artifacts,
    warnings,
    safety: "Public rendering facts only; no copied scripts, credentials, headers, cookies, or response bodies.",
  };
}

export async function writeManifest(out, manifest) {
  await assertSafeBundleRoot(out);
  for (const name of ["manifest.json", "manifest.sha256"]) {
    const path = join(out, "evidence", name);
    const stat = await lstat(path).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Unsafe evidence metadata path: evidence/${name}`);
  }
  const manifestPath = join(out, "evidence", "manifest.json");
  await writeJson(manifestPath, manifest);
  const bytes = await readFile(manifestPath);
  await writeFile(join(out, "evidence", "manifest.sha256"), `${sha256(bytes)}\n`);
}

function safeArtifactPath(path) {
  return typeof path === "string" && !path.startsWith("/") && !path.includes("\\") && !/[\u0000-\u001f\u007f]/.test(path) &&
    !EXCLUDED.has(path) && !path.split("/").some((part) => !part || part === ".." || part === ".") &&
    BUNDLE_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`));
}

async function verifyManifestChecksum(root, manifest) {
  const required = Boolean(manifest?.manifestChecksum);
  const invalidPaths = [];
  const rootStat = await lstat(root).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  const evidenceStat = await lstat(join(root, "evidence")).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) invalidPaths.push(".");
  if (!evidenceStat?.isDirectory() || evidenceStat.isSymbolicLink()) invalidPaths.push("evidence");
  if (required && manifest.manifestChecksum !== "evidence/manifest.sha256") invalidPaths.push("evidence/manifest.sha256");
  if (invalidPaths.length) return { ok: false, required, mismatched: required, missing: true, invalidPaths, sha256: null };

  const paths = ["evidence/manifest.json", "evidence/manifest.sha256"];
  const stats = await Promise.all(paths.map((path) => lstat(join(root, path)).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))));
  for (let index = 0; index < paths.length; index += 1) {
    if (stats[index] && (!stats[index].isFile() || stats[index].isSymbolicLink())) invalidPaths.push(paths[index]);
  }
  const manifestBytes = stats[0]?.isFile() && !stats[0].isSymbolicLink() ? await readFile(join(root, paths[0])).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)) : null;
  const checksum = required && stats[1]?.isFile() && !stats[1].isSymbolicLink()
    ? await readFile(join(root, paths[1]), "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error))
    : null;
  let diskManifest = null;
  if (manifestBytes) {
    try { diskManifest = JSON.parse(manifestBytes.toString("utf8")); } catch { /* malformed manifest is an integrity failure */ }
  }
  const checksumMatches = required ? Boolean(manifestBytes && checksum && sha256(manifestBytes) === checksum.trim()) : Boolean(manifestBytes);
  const argumentMatches = Boolean(diskManifest && isDeepStrictEqual(diskManifest, manifest));
  const ok = checksumMatches && argumentMatches && invalidPaths.length === 0;
  return {
    ok,
    required,
    mismatched: Boolean((required && manifestBytes && checksum && !checksumMatches) || (diskManifest && !argumentMatches)),
    missing: !manifestBytes || (required && !checksum),
    invalidPaths,
    sha256: manifestBytes ? sha256(manifestBytes) : null,
  };
}

export async function verifyArtifacts(root, manifest) {
  const manifestIntegrity = await verifyManifestChecksum(root, manifest);
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const missing = [];
  const mismatched = [];
  const invalidPaths = [];
  const actualPaths = [];
  for (const directory of BUNDLE_DIRECTORIES) {
    await collectFiles(root, directory, actualPaths, { includeSymlinks: true, invalidPaths });
  }
  const invalid = [...(manifestIntegrity.invalidPaths ?? []), ...invalidPaths];
  const expectedPaths = new Set();
  for (const artifact of artifacts) {
    if (!safeArtifactPath(artifact?.path) || expectedPaths.has(artifact.path) ||
        !Number.isInteger(artifact?.bytes) || artifact.bytes < 0 || !/^[0-9a-f]{64}$/.test(artifact?.sha256 ?? "")) {
      invalid.push(artifact?.path ?? "(missing path)");
      continue;
    }
    expectedPaths.add(artifact.path);
    if (invalidPaths.some((path) => artifact.path === path || artifact.path.startsWith(`${path}/`))) {
      invalid.push(artifact.path);
      continue;
    }
    const artifactPath = join(root, artifact.path.split("/").join(sep));
    const stats = await lstat(artifactPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stats) {
      missing.push(artifact.path);
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      invalid.push(artifact.path);
      continue;
    }
    const buffer = await readFile(artifactPath);
    if (buffer.byteLength !== artifact.bytes || sha256(buffer) !== artifact.sha256) mismatched.push(artifact.path);
  }
  if (manifest?.requiredArtifacts !== undefined && !Array.isArray(manifest.requiredArtifacts)) invalid.push("requiredArtifacts");
  const required = Array.isArray(manifest?.requiredArtifacts) ? manifest.requiredArtifacts : [];
  for (const path of required) {
    if (!safeArtifactPath(path)) {
      invalid.push(typeof path === "string" ? path : "(invalid required path)");
      continue;
    }
    if (!expectedPaths.has(path) && !missing.includes(path)) missing.push(path);
  }
  const unexpected = actualPaths.filter((path) => !expectedPaths.has(path)).sort();
  const ok = artifacts.length > 0 && missing.length === 0 && mismatched.length === 0 && unexpected.length === 0 && invalid.length === 0 && manifestIntegrity.ok;
  return {
    ok,
    checked: artifacts.length,
    missing: [...new Set(missing)].sort(),
    mismatched: [...new Set(mismatched)].sort(),
    unexpected,
    invalid: [...new Set(invalid)].sort(),
    manifestIntegrity,
    message: ok
      ? `Evidence integrity verified for ${artifacts.length} artifacts.`
      : `Evidence integrity failed: ${missing.length} missing, ${mismatched.length} modified, ${unexpected.length} unexpected, ${invalid.length} invalid, manifest checksum ${manifestIntegrity.ok ? "verified" : "invalid or missing"}.`,
  };
}

/** Preserve the complete prior frozen bundle before a deliberate refresh. */
export async function archiveBaseline(root, reason = "evidence refresh") {
  const rootStat = await lstat(root).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!rootStat) return null;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Unsafe evidence output root: ${root}`);
  for (const directory of BUNDLE_DIRECTORIES) {
    const stat = await lstat(join(root, directory)).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Unsafe evidence bundle directory: ${directory}`);
  }
  const manifestPath = join(root, "evidence", "manifest.json");
  for (const name of ["manifest.json", "manifest.sha256"]) {
    const path = join(root, "evidence", name);
    const stat = await lstat(path).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Unsafe evidence metadata path: evidence/${name}`);
  }
  const previous = await readFile(manifestPath, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!previous) return null;
  const unsafeEntries = [];
  for (const directory of BUNDLE_DIRECTORIES) await collectFiles(root, directory, [], { invalidPaths: unsafeEntries });
  if (unsafeEntries.length) throw new Error(`Cannot archive a bundle containing symlinks or unsafe entries: ${[...new Set(unsafeEntries)].sort().join(", ")}`);

  const archiveRoot = join(root, "baseline-history");
  const archiveRootStat = await lstat(archiveRoot).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (archiveRootStat && (!archiveRootStat.isDirectory() || archiveRootStat.isSymbolicLink())) throw new Error("Unsafe baseline-history output directory.");
  await mkdir(archiveRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archive = join(archiveRoot, timestamp);
  await mkdir(archive, { recursive: false });
  for (const directory of BUNDLE_DIRECTORIES) {
    await cp(join(root, directory), join(archive, directory), { recursive: true, errorOnExist: true, force: false }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await writeJson(join(archive, "audit.json"), { archivedAt: new Date().toISOString(), reason, manifest: previous });
  return archive;
}

export async function readManifest(root) {
  await assertSafeBundleRoot(root);
  const manifestPath = join(root, "evidence", "manifest.json");
  const stat = await lstat(manifestPath).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Unsafe evidence manifest path.");
  return readJson(manifestPath);
}

export function relativeArtifact(root, path) {
  return relative(root, path).split(sep).join("/");
}
