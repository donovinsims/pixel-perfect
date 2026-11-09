import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBrowser, stablePage, settle, writeJson } from "./core.mjs";
import { clampRect, cropPng } from "./crops.mjs";
import { buildManifest } from "./evidence.mjs";
import { observePage, trackAssets } from "./observe.mjs";
import { sectionSlugs } from "./sections.mjs";
import { extractTokens, renderTokensMarkdown } from "./tokens.mjs";

/**
 * Capture every viewport serially. Serial capture is deliberate: parallel
 * navigation against one source makes measurements race.
 */
export async function captureViews({ browser, url, views, captureHtml = false }) {
  const pages = [];
  const assets = new Map();
  const warnings = [];
  for (const view of views) {
    const { context, page } = await stablePage(browser, view.viewport);
    const tracked = trackAssets(page);
    try {
      await settle(page, url);
      const observation = await observePage(page);
      const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });
      const html = captureHtml && view.name === "desktop" ? await page.content() : null;
      if (!observation.sections.length) warnings.push(`${view.name}: no section regions were detected.`);
      if (observation.stylesheets.inaccessible) warnings.push(`${view.name}: ${observation.stylesheets.inaccessible} stylesheet(s) were unreadable (cross-origin).`);
      pages.push({ ...view, observation, screenshot, html });
    } finally {
      for (const [key, value] of tracked) assets.set(key, value);
      await context.close();
    }
  }
  return { url, pages, assets: [...assets.values()].sort((a, b) => a.url.localeCompare(b.url)), warnings };
}

export async function captureTarget({ url, views, captureHtml = false }) {
  const browser = await loadBrowser();
  try {
    return await captureViews({ browser, url, views, captureHtml });
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
      png,
    };
  });
}

async function writeSections({ directory, records, viewport, viewportSize }) {
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
    });
  }
  return { viewport, viewportSize, sections: stored };
}

/** Write the frozen source evidence bundle, including manifest checksums. */
export async function writeSourceBundle({ out, capture, sourceUrl }) {
  await mkdir(join(out, "source", "screenshots"), { recursive: true });
  await mkdir(join(out, "evidence"), { recursive: true });
  const observations = {};
  const summaries = [];
  for (const page of capture.pages) {
    await writeFile(join(out, "source", "screenshots", `${page.name}.png`), page.screenshot);
    if (page.html) await writeFile(join(out, "source", "rendered.html"), page.html);
    await writeJson(join(out, "evidence", `observation-${page.name}.json`), page.observation);
    observations[page.name] = page.observation;
    const summary = await writeSections({
      directory: join(out, "source", "sections", page.name),
      records: sectionRecords(page),
      viewport: page.name,
      viewportSize: page.viewport,
    });
    await writeJson(join(out, "evidence", `sections-${page.name}.json`), summary);
    summaries.push({
      name: page.name,
      viewport: page.viewport,
      sections: summary.sections.length,
      cropped: summary.sections.filter((section) => section.bytes > 0).length,
    });
  }
  const tokens = extractTokens(observations);
  await writeJson(join(out, "evidence", "tokens.json"), tokens);
  await writeFile(join(out, "evidence", "tokens.md"), renderTokensMarkdown(tokens));
  await writeJson(join(out, "evidence", "assets.json"), capture.assets);
  const manifest = await buildManifest({ out, sourceUrl, viewports: summaries, warnings: capture.warnings });
  await writeJson(join(out, "evidence", "manifest.json"), manifest);
  return { manifest, tokens, summaries, observations };
}

/** Write clone screenshots, observations, and crops for comparison. */
export async function writeCloneBundle({ out, capture }) {
  await mkdir(out, { recursive: true });
  const observations = {};
  const sections = {};
  for (const page of capture.pages) {
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
