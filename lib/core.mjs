import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const TOOL_VERSION = "3.0.1";
export const MANIFEST_VERSION = 3;

export const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1000 },
  mobile: { width: 390, height: 844 },
};

/**
 * Machine triage bands. Ratios are fractions of changed pixels, so 0.005 is
 * the documented 0.5% pass band. Geometry tolerances are CSS pixels.
 */
export const DEFAULT_THRESHOLDS = {
  visual: { pass: 0.005, review: 0.02 },
  geometry: { xy: 1, size: 2 },
};

export const MANUAL_GATES = [
  "structural completeness",
  "assets and loaded fonts",
  "high-value computed-style parity",
  "micro-detail audit",
  "observed meaningful interactions",
  "fresh independent review when supported",
  "post-correction regression",
];

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      out._.push(item);
      continue;
    }
    const [key, inline] = item.slice(2).split("=", 2);
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

export function requireOption(args, key) {
  const value = args[key];
  if (value === undefined || value === true || value === "") throw new Error(`Missing --${key}.`);
  return String(value);
}

export function numberOption(args, key, fallback) {
  if (args[key] === undefined) return fallback;
  if (args[key] === true) throw new Error(`--${key} needs a numeric value.`);
  const value = Number(args[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number.`);
  return value;
}

/**
 * Resolve a `--viewports` specification into named viewports.
 * Accepts presets (`desktop,tablet,mobile`), widths (`1024`), or explicit
 * sizes (`1024x900`). Custom widths are named `w1024`.
 */
export function resolveViewports(spec) {
  if (spec === undefined) {
    return Object.entries(VIEWPORTS).map(([name, viewport]) => ({ name, viewport: { ...viewport } }));
  }
  if (spec === true) throw new Error("--viewports needs a comma-separated list.");
  const parts = String(spec).split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("--viewports needs at least one entry.");
  const seen = new Set();
  return parts.map((part) => {
    const preset = VIEWPORTS[part];
    const match = preset ? null : /^(\d{3,4})(?:x(\d{3,4}))?$/.exec(part);
    if (!preset && !match) throw new Error(`Unrecognized viewport "${part}". Use desktop, tablet, mobile, WIDTH, or WIDTHxHEIGHT.`);
    const name = preset ? part : `w${match[1]}`;
    const viewport = preset ? { ...preset } : { width: Number(match[1]), height: Number(match[2] || 1000) };
    if (viewport.width < 240 || viewport.width > 4000 || viewport.height < 240 || viewport.height > 4000) {
      throw new Error(`Viewport "${part}" is outside the supported 240-4000px range.`);
    }
    if (seen.has(name)) throw new Error(`Duplicate viewport "${name}".`);
    seen.add(name);
    return { name, viewport };
  });
}

export function viewportsFromManifest(manifest) {
  const entries = Array.isArray(manifest?.viewports) ? manifest.viewports : [];
  const views = entries
    .filter((entry) => entry && typeof entry.name === "string" && entry.viewport && Number(entry.viewport.width) && Number(entry.viewport.height))
    .map((entry) => ({ name: entry.name, viewport: { width: Number(entry.viewport.width), height: Number(entry.viewport.height) } }));
  return views.length ? views : resolveViewports();
}

export function thresholdsFromArgs(args) {
  const visual = {
    pass: numberOption(args, "pass-ratio", DEFAULT_THRESHOLDS.visual.pass),
    review: numberOption(args, "review-ratio", DEFAULT_THRESHOLDS.visual.review),
  };
  if (visual.pass < 0 || visual.review < 0 || visual.pass > 1 || visual.review > 1) {
    throw new Error("--pass-ratio and --review-ratio must be between 0 and 1.");
  }
  if (visual.pass > visual.review) throw new Error("--pass-ratio must not exceed --review-ratio.");
  return { visual, geometry: { ...DEFAULT_THRESHOLDS.geometry } };
}

export const absolute = (path) => resolve(process.cwd(), path);

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "capture";
}

export function rectOf(rect) {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value, length = 6) {
  return sha256(String(value)).slice(0, length);
}

export function commandExists(binary) {
  try {
    execFileSync("/usr/bin/env", ["which", binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function commandVersion(binary, values = ["--version"]) {
  try {
    return execFileSync(binary, values, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export async function loadBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

export async function stablePage(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  return { context, page };
}

export async function settle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all([...document.images].filter((image) => !image.complete).map((image) => new Promise((done) => {
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    })));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  // Measurements and crops assume the top of the document.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}
