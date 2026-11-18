import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const TOOL_VERSION = "3.0.2";
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
  "discovery route coverage",
  "structural completeness",
  "assets and loaded fonts",
  "high-value computed-style parity",
  "micro-detail audit",
  "functional behavior verification",
  "observed meaningful interactions",
  "build health",
  "handoff validation",
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
  if (!entries.length) return resolveViewports();
  const views = entries.map((entry) => {
    if (!entry || typeof entry.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) {
      throw new Error("Manifest contains an invalid capture name.");
    }
    const width = Number(entry.viewport?.width);
    const height = Number(entry.viewport?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || width > 4000 || height < 240 || height > 4000) {
      throw new Error(`Manifest capture ${entry.name} has invalid viewport dimensions.`);
    }
    const view = { name: entry.name, viewport: { width, height } };
    if ((entry.routeId === undefined || entry.routeId === null) !== (entry.routePath === undefined || entry.routePath === null)) {
      throw new Error(`Manifest capture ${entry.name} has incomplete route metadata.`);
    }
    if (entry.routeId !== undefined && entry.routeId !== null) {
      if (typeof entry.routeId !== "string" || !/^route-[a-f0-9]{10}$/.test(entry.routeId)) throw new Error(`Manifest capture ${entry.name} has an invalid route id.`);
      if (typeof entry.routePath !== "string" || !entry.routePath.startsWith("/") || entry.routePath.startsWith("//") || /[\u0000-\u001f?#]/.test(entry.routePath)) {
        throw new Error(`Manifest capture ${entry.name} has an invalid route path.`);
      }
      const pathUrl = new URL(entry.routePath, "https://pixel-perfect.invalid");
      if (pathUrl.origin !== "https://pixel-perfect.invalid" || pathUrl.pathname !== entry.routePath) throw new Error(`Manifest capture ${entry.name} has an invalid route path.`);
      view.routeId = entry.routeId;
      view.routePath = entry.routePath;
    }
    if (entry.viewportName !== undefined && entry.viewportName !== null) {
      if (typeof entry.viewportName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.viewportName)) {
        throw new Error(`Manifest capture ${entry.name} has an invalid viewport name.`);
      }
      view.viewportName = entry.viewportName;
    }
    return view;
  });
  return views;
}

/** Expand explicit viewport overrides across every route in a captured inventory. */
export function routeAwareViewports(manifest, viewportOverrides) {
  if (!viewportOverrides) return viewportsFromManifest(manifest);
  const captured = viewportsFromManifest(manifest);
  const routes = new Map();
  for (const view of captured) {
    if (!view.routeId) continue;
    const existing = routes.get(view.routeId);
    if (existing && existing.routePath !== view.routePath) throw new Error(`Manifest route ${view.routeId} has inconsistent paths.`);
    if (!existing) routes.set(view.routeId, { routeId: view.routeId, routePath: view.routePath });
  }
  if (!routes.size) return viewportOverrides;
  return [...routes.values()].flatMap((route) => viewportOverrides.map((viewport) => ({
    ...viewport,
    name: `${route.routeId}__${viewport.name}`,
    viewportName: viewport.name,
    ...route,
  })));
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

export const DEFAULT_CAPTURE_PROFILE = {
  browser: "chromium",
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "UTC",
  waitForFonts: true,
  waitForImages: true,
  stabilizationFrames: 2,
  stabilitySamples: 2,
  stabilityIntervalMs: 100,
  resourceTimeoutMs: 5000,
};

const CAPTURE_PROFILE_KEYS = new Set(Object.keys(DEFAULT_CAPTURE_PROFILE));

export function captureProfileFrom(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Capture profile must be a JSON object.");
  const unknown = Object.keys(value).filter((key) => !CAPTURE_PROFILE_KEYS.has(key));
  if (unknown.length) throw new Error(`Unsupported capture profile field: ${unknown[0]}.`);
  const profile = { ...DEFAULT_CAPTURE_PROFILE, ...value };
  if (profile.browser !== "chromium") throw new Error("Only the installed Chromium browser is supported.");
  if (!Number.isFinite(Number(profile.deviceScaleFactor)) || Number(profile.deviceScaleFactor) < 0.5 || Number(profile.deviceScaleFactor) > 3) {
    throw new Error("Capture profile deviceScaleFactor must be between 0.5 and 3.");
  }
  if (!["light", "dark", "no-preference"].includes(profile.colorScheme)) throw new Error("Capture profile colorScheme must be light, dark, or no-preference.");
  if (!["reduce", "no-preference"].includes(profile.reducedMotion)) throw new Error("Capture profile reducedMotion must be reduce or no-preference.");
  for (const key of ["locale", "timezoneId"]) {
    if (typeof profile[key] !== "string" || !profile[key].trim() || profile[key].length > 100) throw new Error(`Capture profile ${key} must be a non-empty string of at most 100 characters.`);
  }
  for (const key of ["waitForFonts", "waitForImages"]) {
    if (typeof profile[key] !== "boolean") throw new Error(`Capture profile ${key} must be a boolean.`);
  }
  if (!Number.isInteger(profile.stabilizationFrames) || profile.stabilizationFrames < 1 || profile.stabilizationFrames > 10) {
    throw new Error("Capture profile stabilizationFrames must be an integer from 1 to 10.");
  }
  if (!Number.isInteger(profile.stabilitySamples) || profile.stabilitySamples < 2 || profile.stabilitySamples > 4) {
    throw new Error("Capture profile stabilitySamples must be an integer from 2 to 4.");
  }
  if (!Number.isInteger(profile.stabilityIntervalMs) || profile.stabilityIntervalMs < 50 || profile.stabilityIntervalMs > 2000) {
    throw new Error("Capture profile stabilityIntervalMs must be an integer from 50 to 2000.");
  }
  if (!Number.isInteger(profile.resourceTimeoutMs) || profile.resourceTimeoutMs < 500 || profile.resourceTimeoutMs > 30_000) {
    throw new Error("Capture profile resourceTimeoutMs must be an integer from 500 to 30000.");
  }
  profile.deviceScaleFactor = Number(profile.deviceScaleFactor);
  return profile;
}

/** Validate a persisted profile while ignoring the runtime's browser-version annotation. */
export function captureProfileFromManifest(value) {
  if (value === undefined || value === null) return captureProfileFrom();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest capture profile must be a JSON object.");
  const profile = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "browserVersion"));
  return captureProfileFrom(profile);
}

export function publicSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Source URL must be an absolute HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Source URL must use HTTP(S) and must not contain embedded credentials.");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

export async function stablePage(browser, viewport, profile = DEFAULT_CAPTURE_PROFILE) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: profile.deviceScaleFactor ?? 1,
    colorScheme: profile.colorScheme ?? "light",
    reducedMotion: profile.reducedMotion ?? "reduce",
    locale: profile.locale ?? "en-US",
    timezoneId: profile.timezoneId ?? "UTC",
  });
  const page = await context.newPage();
  return { context, page };
}

export async function settle(page, url, profile = DEFAULT_CAPTURE_PROFILE) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const warnings = await page.evaluate(async (captureProfile) => {
    const warnings = [];
    const waitBounded = async (promise) => {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve(promise).then(() => true, () => true),
          new Promise((resolve) => { timer = setTimeout(() => resolve(false), captureProfile.resourceTimeoutMs); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    if (captureProfile.waitForFonts && !(await waitBounded(document.fonts?.ready ?? Promise.resolve()))) {
      warnings.push("font readiness wait timed out");
    }
    if (captureProfile.waitForImages) {
      const images = [...document.images].filter((image) => !image.complete).map((image) => new Promise((done) => {
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      }));
      if (images.length && !(await waitBounded(Promise.all(images)))) warnings.push("image readiness wait timed out");
    }
    for (let frame = 0; frame < captureProfile.stabilizationFrames; frame += 1) {
      await new Promise((done) => requestAnimationFrame(done));
    }
    return warnings;
  }, profile);
  // Measurements and crops assume the top of the document.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return { response, warnings };
}
