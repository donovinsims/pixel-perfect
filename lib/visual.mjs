import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { writeJson } from "./core.mjs";
import { isValidSectionSlug } from "./sections.mjs";
import { classifySectionVisual, classifyVisualResult, summarizeGate } from "./verdict.mjs";

const PNG_EXT = /\.png$/i;

async function readScreenshots(dir) {
  const stat = await lstat(dir).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
  return readdir(dir).then((names) => names.filter((name) => PNG_EXT.test(name)).sort());
}

async function readBuffer(path) {
  const stat = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  return readFile(path);
}

function boundingBox(diff, width) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < diff.data.length; index += 4) {
    if (diff.data[index + 3] === 0) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Compare two PNG buffers. A missing clone image is always a failure, never a
 * silent pass. Padded pixels are transparent black and counted as changed.
 */
export function diffPng(sourceBuffer, cloneBuffer, { threshold = 0.1 } = {}) {
  const sourceImage = PNG.sync.read(sourceBuffer);
  if (!cloneBuffer) {
    return {
      missing: true,
      source: { width: sourceImage.width, height: sourceImage.height },
      clone: null,
      changedPixels: sourceImage.width * sourceImage.height,
      totalPixels: sourceImage.width * sourceImage.height,
      changeRatio: 1,
      dimensionMismatch: true,
      largestDifferenceRegion: { x: 0, y: 0, width: sourceImage.width, height: sourceImage.height },
      diff: null,
    };
  }
  const cloneImage = PNG.sync.read(cloneBuffer);
  const width = Math.max(sourceImage.width, cloneImage.width);
  const height = Math.max(sourceImage.height, cloneImage.height);
  const sourceCanvas = new PNG({ width, height });
  const cloneCanvas = new PNG({ width, height });
  const diff = new PNG({ width, height });
  PNG.bitblt(sourceImage, sourceCanvas, 0, 0, sourceImage.width, sourceImage.height, 0, 0);
  PNG.bitblt(cloneImage, cloneCanvas, 0, 0, cloneImage.width, cloneImage.height, 0, 0);
  const changedPixels = pixelmatch(sourceCanvas.data, cloneCanvas.data, diff.data, width, height, {
    threshold,
    includeAA: false,
    diffMask: true,
  });
  return {
    missing: false,
    source: { width: sourceImage.width, height: sourceImage.height },
    clone: { width: cloneImage.width, height: cloneImage.height },
    changedPixels,
    totalPixels: width * height,
    changeRatio: changedPixels / (width * height),
    dimensionMismatch: sourceImage.width !== cloneImage.width || sourceImage.height !== cloneImage.height,
    largestDifferenceRegion: boundingBox(diff, width),
    diff: PNG.sync.write(diff),
  };
}

/** Full-page comparison of two screenshot directories. */
export async function visualDiffFiles({ sourceDir, cloneDir, outDir, thresholds }) {
  const names = await readScreenshots(sourceDir);
  const results = [];
  await mkdir(outDir, { recursive: true });
  for (const name of names) {
    const sourceBuffer = await readFile(join(sourceDir, name));
    const cloneBuffer = await readBuffer(join(cloneDir, name));
    const { diff, ...result } = diffPng(sourceBuffer, cloneBuffer);
    if (diff) await writeFile(join(outDir, name), diff);
    results.push({ viewport: name.replace(PNG_EXT, ""), ...result, result: classifyVisualResult(result, thresholds) });
  }
  const report = { generatedAt: new Date().toISOString(), source: sourceDir, clone: cloneDir, results };
  await writeJson(join(outDir, "visual-report.json"), report);
  return report;
}

/**
 * Region comparison. Crop filenames are content-derived, so a name shared by
 * the source and clone bundle means both describe the same region. Regions
 * present on only one side are reported instead of skipped.
 */
export async function sectionDiff({ sourceDir, cloneDir, outDir, thresholds, expectations = {} }) {
  const directories = await readdir(sourceDir, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const viewports = [...new Set([...directories, ...Object.keys(expectations)])].sort();
  const results = [];
  for (const viewport of viewports) {
    const sourceViewportDir = join(sourceDir, viewport);
    const cloneViewportDir = join(cloneDir, viewport);
    const names = await readScreenshots(sourceViewportDir);
    const cloneNames = await readScreenshots(cloneViewportDir);
    const expectation = expectations[viewport] ?? {};
    const expectedSections = Array.isArray(expectation.sections)
      ? expectation.sections
      : names.map((name) => ({ slug: name.replace(PNG_EXT, ""), bytes: 1, captureStatus: "captured" }));
    const regionExpectation = expectation.regionExpectation ?? "required";
    await mkdir(join(outDir, viewport), { recursive: true });
    const sections = [];
    const slugCounts = new Map();
    for (const expected of expectedSections) {
      if (isValidSectionSlug(expected?.slug)) slugCounts.set(expected.slug, (slugCounts.get(expected.slug) ?? 0) + 1);
    }
    const invalidSections = [];
    for (const expected of expectedSections) {
      const slug = expected?.slug;
      const validSlug = isValidSectionSlug(slug);
      const duplicateSlug = validSlug && slugCounts.get(slug) > 1;
      if (!validSlug || duplicateSlug) {
        invalidSections.push(validSlug ? slug : "(invalid section identifier)");
        sections.push({
          name: validSlug ? slug : "(invalid section identifier)",
          missing: true,
          sourceCaptureFailed: true,
          source: null,
          clone: null,
          changeRatio: 1,
          dimensionMismatch: true,
          result: "fail",
        });
        continue;
      }
      const name = `${slug}.png`;
      const sourceBuffer = expected.captureStatus === "failed" || expected.bytes === 0
        ? null
        : await readBuffer(join(sourceViewportDir, name));
      const cloneBuffer = await readBuffer(join(cloneViewportDir, name));
      if (!sourceBuffer) {
        sections.push({
          name: slug,
          missing: true,
          sourceCaptureFailed: expected.captureStatus === "failed" || expected.bytes === 0,
          source: null,
          clone: null,
          changeRatio: 1,
          dimensionMismatch: true,
          result: "fail",
        });
        continue;
      }
      const { diff, ...result } = diffPng(sourceBuffer, cloneBuffer);
      if (diff) await writeFile(join(outDir, viewport, name), diff);
      sections.push({ name: slug, ...result, result: classifySectionVisual(result, thresholds) });
    }
    const expectedNames = expectedSections.filter((section) => isValidSectionSlug(section?.slug) && slugCounts.get(section.slug) === 1).map((section) => `${section.slug}.png`);
    const extra = cloneNames.filter((name) => !expectedNames.includes(name)).map((name) => name.replace(PNG_EXT, ""));
    const expectedCount = expectedSections.length;
    const capturedCount = sections.filter((section) => !section.sourceCaptureFailed && !section.missing).length;
    const coverage = expectedCount === 0
      ? regionExpectation === "documented-none" ? "not_expected" : "missing"
      : capturedCount === expectedCount ? "complete" : "failed";
    const gate = coverage === "missing" || coverage === "failed" || extra.length || invalidSections.length
      ? "fail"
      : expectedCount === 0 && regionExpectation === "documented-none"
        ? "pass"
        : summarizeGate(sections.map((section) => section.result));
    results.push({ viewport, expectedCount, capturedCount, regionExpectation, coverage, sections, extra, invalidSections, gate });
  }
  const report = { generatedAt: new Date().toISOString(), source: sourceDir, clone: cloneDir, viewports: results };
  await writeJson(join(outDir, "sections-report.json"), report);
  return report;
}
