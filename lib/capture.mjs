import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { DEFAULT_CAPTURE_PROFILE, captureProfileFrom, loadBrowser, sha256, stablePage, settle, writeJson } from "./core.mjs";
import { clampRect, cropPng } from "./crops.mjs";
import { assertSafeBundleRoot, buildManifest, writeManifest } from "./evidence.mjs";
import { observePage, trackAssets } from "./observe.mjs";
import { isValidSectionSlug, sectionSlugs } from "./sections.mjs";
import { extractTokens, renderTokensMarkdown } from "./tokens.mjs";

/**
 * Capture every viewport serially. Serial capture is deliberate: parallel
 * navigation against one source makes measurements race.
 */
function screenshotPixelHash(buffer) {
  return sha256(PNG.sync.read(buffer).data);
}

async function sanitizedRenderedHtml(page) {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script,noscript,iframe,object,embed,template,base").forEach((element) => element.remove());
    const sensitive = /token|secret|password|authorization|session|csrf|nonce|api[-_]?key/i;
    clone.querySelectorAll("meta").forEach((element) => {
      const name = [element.getAttribute("name"), element.getAttribute("http-equiv"), element.getAttribute("property")].filter(Boolean).join(" ");
      if (sensitive.test(name)) element.remove();
    });
    const urlAttributes = new Set(["href", "src", "action", "formaction", "poster", "cite", "xlink:href"]);
    const safeUrl = (value) => {
      try {
        const url = new URL(value, document.baseURI);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.href;
      } catch {
        return null;
      }
    };
    const safeCss = (value) => value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;]+);?/gi, "").replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_match, doubleQuoted, singleQuoted, bare) => {
      const value = safeUrl((doubleQuoted ?? singleQuoted ?? bare ?? "").trim());
      return value ? `url("${value.replace(/"/g, "%22")}")` : "none";
    });
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || ["srcdoc", "srcset"].includes(name) || sensitive.test(name)) {
          element.removeAttribute(attribute.name);
        } else if (urlAttributes.has(name)) {
          const value = safeUrl(attribute.value);
          if (value === null) element.removeAttribute(attribute.name);
          else element.setAttribute(attribute.name, value);
        } else if (name === "style") {
          element.setAttribute(attribute.name, safeCss(attribute.value));
        }
      }
      if (["input", "textarea", "select", "option"].includes(element.tagName.toLowerCase())) {
        for (const name of ["value", "checked", "selected"]) element.removeAttribute(name);
        if (element.tagName.toLowerCase() === "textarea") element.textContent = "";
      }
      if (element.tagName.toLowerCase() === "form") element.removeAttribute("action");
      if (element.tagName.toLowerCase() === "style") element.textContent = safeCss(element.textContent);
    }
    return `<!doctype html>\n${clone.outerHTML}`;
  });
}

export async function captureViews({ browser, url, views, captureHtml = false, profile = DEFAULT_CAPTURE_PROFILE }) {
  profile = captureProfileFrom(profile);
  const pages = [];
  const assets = new Map();
  const warnings = [];
  for (const view of views) {
    if (view.blockedReason) {
      warnings.push(`${view.name}: capture blocked: ${view.blockedReason}`);
      pages.push({ ...view, observation: null, screenshot: null, html: null, error: view.blockedReason });
      continue;
    }
    let context = null;
    let tracked = new Map();
    try {
      const stable = await stablePage(browser, view.viewport, profile);
      context = stable.context;
      const page = stable.page;
      tracked = trackAssets(page);
      const settled = await settle(page, view.url ?? url, profile);
      const httpStatus = settled.response?.status() ?? 0;
      if (httpStatus >= 400) warnings.push(`${view.name}: page returned HTTP ${httpStatus}.`);
      for (const warning of settled.warnings) warnings.push(`${view.name}: ${warning}.`);
      let screenshot = null;
      let previousHash = null;
      let stableRendering = true;
      for (let sample = 0; sample < profile.stabilitySamples; sample += 1) {
        if (sample > 0) await page.waitForTimeout(profile.stabilityIntervalMs);
        screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });
        const hash = screenshotPixelHash(screenshot);
        if (previousHash !== null && previousHash !== hash) stableRendering = false;
        previousHash = hash;
      }
      const renderStability = { stable: stableRendering, samples: profile.stabilitySamples, intervalMs: profile.stabilityIntervalMs };
      const observation = await observePage(page);
      observation.routeId = view.routeId ?? null;
      observation.routePath = view.routePath ?? null;
      observation.viewportName = view.viewportName ?? view.name;
      observation.renderStability = renderStability;
      if (!stableRendering) warnings.push(`${view.name}: rendered pixels changed between stability samples; inspect dynamic content and recapture if needed.`);
      const isDesktop = (view.viewportName ?? view.name) === "desktop";
      const html = captureHtml && isDesktop ? await sanitizedRenderedHtml(page) : null;
      if (!observation.sections.length) warnings.push(`${view.name}: no section regions were detected.`);
      if (observation.stylesheets.inaccessible) warnings.push(`${view.name}: ${observation.stylesheets.inaccessible} stylesheet(s) were unreadable (cross-origin).`);
      pages.push({ ...view, observation, screenshot, html, httpStatus, renderStability, error: null });
    } catch (error) {
      warnings.push(`${view.name}: capture failed: ${error.message}`);
      pages.push({ ...view, observation: null, screenshot: null, html: null, error: error.message });
    } finally {
      for (const [key, value] of tracked) assets.set(key, value);
      if (context) await context.close().catch(() => {});
    }
  }
  return { url, pages, assets: [...assets.values()].sort((a, b) => a.url.localeCompare(b.url)), warnings };
}

export async function captureTarget({ url, views, captureHtml = false, profile = DEFAULT_CAPTURE_PROFILE }) {
  const captureProfile = captureProfileFrom(profile);
  const browser = await loadBrowser();
  try {
    const capture = await captureViews({ browser, url, views, captureHtml, profile: captureProfile });
    capture.captureProfile = { ...captureProfile, browserVersion: browser.version() };
    return capture;
  } finally {
    await browser.close();
  }
}

/** Slice each measured region out of the stored full-page screenshot. */
export function sectionRecords(pageEntry) {
  const { observation, screenshot } = pageEntry;
  const slugs = sectionSlugs(observation.sections);
  return observation.sections.map((section, index) => {
    const view = clampRect(section.documentRect, observation.page.scrollWidth, observation.page.scrollHeight);
    const png = cropPng(screenshot, view);
    return {
      index,
      slug: slugs[index],
      selector: section.selector,
      role: section.role,
      text: section.text,
      rect: section.rect,
      documentRect: view,
      bytes: png ? png.byteLength : 0,
      captureStatus: png ? "captured" : "failed",
      png,
    };
  });
}

async function writeSections({ directory, records, viewport, viewportSize }) {
  const slugs = new Set();
  for (const record of records) {
    if (!isValidSectionSlug(record.slug) || slugs.has(record.slug)) {
      throw new Error(`Invalid or duplicate section crop identifier: ${record.slug ?? "(missing)"}`);
    }
    slugs.add(record.slug);
  }
  await mkdir(directory, { recursive: true });
  const stored = [];
  for (const record of records) {
    if (record.png) await writeFile(join(directory, `${record.slug}.png`), record.png);
    stored.push({
      index: record.index,
      slug: record.slug,
      selector: record.selector,
      role: record.role,
      text: record.text,
      rect: record.rect,
      documentRect: record.documentRect,
      bytes: record.bytes,
      captureStatus: record.captureStatus,
    });
  }
  return { viewport, viewportSize, sections: stored, captureFailures: stored.filter((section) => section.captureStatus !== "captured").map((section) => section.slug) };
}

/** Write the frozen source evidence bundle, including manifest checksums. */
export async function writeSourceBundle({ out, capture, sourceUrl, noRegionsExpected = false }) {
  await mkdir(out, { recursive: true });
  await assertSafeBundleRoot(out);
  await mkdir(join(out, "source", "screenshots"), { recursive: true });
  await mkdir(join(out, "evidence"), { recursive: true });
  const observations = {};
  const summaries = [];
  for (const page of capture.pages) {
    if (typeof page.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(page.name)) {
      throw new Error(`Unsafe capture output name: ${page.name ?? "(missing)"}`);
    }
    if (page.routeId !== undefined && page.routeId !== null && !/^route-[a-f0-9]{10}$/.test(page.routeId)) {
      throw new Error(`Unsafe route output identifier: ${page.routeId}`);
    }
    const routeFields = {
      routeId: page.routeId ?? null,
      routePath: page.routePath ?? null,
      routeUrl: page.routeUrl ?? null,
      viewportName: page.viewportName ?? page.name,
      httpStatus: page.httpStatus ?? null,
      renderStability: page.renderStability ?? null,
    };
    if (page.error) {
      await writeJson(join(out, "evidence", `capture-failure-${page.name}.json`), { ...routeFields, name: page.name, error: page.error });
      summaries.push({ name: page.name, viewport: page.viewport, ...routeFields, sections: 0, cropped: 0, regionExpectation: "required", captureStatus: "failed" });
      continue;
    }
    await writeFile(join(out, "source", "screenshots", `${page.name}.png`), page.screenshot);
    if (page.html) {
      const htmlPath = page.routeId
        ? join(out, "source", "routes", page.routeId, "rendered.html")
        : join(out, "source", "rendered.html");
      if (page.routeId) await mkdir(join(out, "source", "routes", page.routeId), { recursive: true });
      await writeFile(htmlPath, page.html);
    }
    await writeJson(join(out, "evidence", `observation-${page.name}.json`), page.observation);
    observations[page.name] = page.observation;
    const summary = await writeSections({
      directory: join(out, "source", "sections", page.name),
      records: sectionRecords(page),
      viewport: page.name,
      viewportSize: page.viewport,
    });
    const regionExpectation = noRegionsExpected ? "documented-none" : "required";
    const sectionSummary = { ...summary, regionExpectation, ...routeFields };
    await writeJson(join(out, "evidence", `sections-${page.name}.json`), sectionSummary);
    summaries.push({
      name: page.name,
      viewport: page.viewport,
      ...routeFields,
      sections: summary.sections.length,
      cropped: summary.sections.filter((section) => section.bytes > 0).length,
      regionExpectation,
      captureStatus: "captured",
    });
  }
  const tokens = extractTokens(observations);
  await writeJson(join(out, "evidence", "tokens.json"), tokens);
  await writeFile(join(out, "evidence", "tokens.md"), renderTokensMarkdown(tokens));
  await writeJson(join(out, "evidence", "assets.json"), capture.assets);
  const warnings = capture.warnings.filter((warning) => !noRegionsExpected || !warning.includes("no section regions were detected"));
  for (const summary of summaries) {
    if (summary.captureStatus !== "failed" && summary.cropped < summary.sections) warnings.push(`${summary.name}: one or more required region crops failed.`);
  }
  if (noRegionsExpected) warnings.push("No regions were expected by explicit caller acknowledgement.");
  const manifest = await buildManifest({ out, sourceUrl, viewports: summaries, warnings, captureProfile: capture.captureProfile ?? DEFAULT_CAPTURE_PROFILE });
  await writeManifest(out, manifest);
  return { manifest, tokens, summaries, observations };
}

/** Write clone screenshots, observations, and crops for comparison. */
export async function writeCloneBundle({ out, capture }) {
  await mkdir(out, { recursive: true });
  const observations = {};
  const sections = {};
  for (const page of capture.pages) {
    if (typeof page.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(page.name)) {
      throw new Error(`Unsafe clone capture output name: ${page.name ?? "(missing)"}`);
    }
    if (page.error) {
      await writeJson(join(out, `capture-failure-${page.name}.json`), { error: page.error });
      continue;
    }
    await writeFile(join(out, `${page.name}.png`), page.screenshot);
    await writeJson(join(out, `observation-${page.name}.json`), page.observation);
    observations[page.name] = page.observation;
    const summary = await writeSections({
      directory: join(out, "sections", page.name),
      records: sectionRecords(page),
      viewport: page.name,
      viewportSize: page.viewport,
    });
    await writeJson(join(out, `sections-${page.name}.json`), summary);
    sections[page.name] = summary;
  }
  await writeJson(join(out, "assets.json"), capture.assets);
  return { observations, sections };
}
