import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { writeJson } from "./core.mjs";
import { classifySectionVisual, classifyVisualResult, summarizeGate } from "./verdict.mjs";

const PNG_EXT = /\.png$/i;

function readScreenshots(dir) {
  return readdir(dir).then((names) => names.filter((name) => PNG_EXT.test(name)).sort(), (error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

function readBuffer(path) {
  return readFile(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
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
export async function sectionDiff({ sourceDir, cloneDir, outDir, thresholds }) {
  const viewports = await readdir(sourceDir, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort())
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const results = [];
  for (const viewport of viewports) {
    const sourceViewportDir = join(sourceDir, viewport);
    const cloneViewportDir = join(cloneDir, viewport);
    const names = await readScreenshots(sourceViewportDir);
    const cloneNames = await readScreenshots(cloneViewportDir);
    await mkdir(join(outDir, viewport), { recursive: true });
    const sections = [];
    for (const name of names) {
      const sourceBuffer = await readFile(join(sourceViewportDir, name));
      const cloneBuffer = await readBuffer(join(cloneViewportDir, name));
      const { diff, ...result } = diffPng(sourceBuffer, cloneBuffer);
      if (diff) await writeFile(join(outDir, viewport, name), diff);
      sections.push({ name: name.replace(PNG_EXT, ""), ...result, result: classifySectionVisual(result, thresholds) });
    }
    results.push({
      viewport,
      sections,
      extra: cloneNames.filter((name) => !names.includes(name)).map((name) => name.replace(PNG_EXT, "")),
      gate: summarizeGate(sections.map((section) => section.result)),
    });
  }
  const report = { generatedAt: new Date().toISOString(), source: sourceDir, clone: cloneDir, viewports: results };
  await writeJson(join(outDir, "sections-report.json"), report);
  return report;
}
