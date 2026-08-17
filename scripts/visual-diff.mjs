#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { absolute, parseArgs, requireOption, writeJson } from "../lib/core.mjs";

const args = parseArgs(process.argv.slice(2));
const source = absolute(requireOption(args, "source"));
const clone = absolute(requireOption(args, "clone"));
const out = absolute(requireOption(args, "out"));
await mkdir(out, { recursive: true });

const names = (await readdir(source)).filter((name) => name.endsWith(".png")).sort();
const results = [];

for (const name of names) {
  const viewport = name.replace(/\.png$/, "");
  const sourceImage = PNG.sync.read(await readFile(join(source, name)));
  let cloneImage;

  try {
    cloneImage = PNG.sync.read(await readFile(join(clone, name)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    results.push({
      viewport,
      missing: true,
      changedPixels: sourceImage.width * sourceImage.height,
      totalPixels: sourceImage.width * sourceImage.height,
      changeRatio: 1,
      dimensionMismatch: true,
      largestDifferenceRegion: { x: 0, y: 0, width: sourceImage.width, height: sourceImage.height },
    });
    continue;
  }

  const width = Math.max(sourceImage.width, cloneImage.width);
  const height = Math.max(sourceImage.height, cloneImage.height);
  const sourceCanvas = new PNG({ width, height });
  const cloneCanvas = new PNG({ width, height });
  const diff = new PNG({ width, height });
  PNG.bitblt(sourceImage, sourceCanvas, 0, 0, sourceImage.width, sourceImage.height, 0, 0);
  PNG.bitblt(cloneImage, cloneCanvas, 0, 0, cloneImage.width, cloneImage.height, 0, 0);

  const changedPixels = pixelmatch(sourceCanvas.data, cloneCanvas.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
    diffMask: true,
  });
  const xs = [];
  const ys = [];
  for (let index = 0; index < diff.data.length; index += 4) {
    if (diff.data[index + 3] === 0) continue;
    xs.push((index / 4) % width);
    ys.push(Math.floor(index / 4 / width));
  }

  await writeFile(join(out, name), PNG.sync.write(diff));
  results.push({
    viewport,
    missing: false,
    changedPixels,
    totalPixels: width * height,
    changeRatio: changedPixels / (width * height),
    dimensionMismatch: sourceImage.width !== cloneImage.width || sourceImage.height !== cloneImage.height,
    largestDifferenceRegion: xs.length
      ? { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 }
      : null,
  });
}

await writeJson(join(out, "visual-report.json"), { generatedAt: new Date().toISOString(), results });
console.log(`Generated ${results.length} visual comparisons in ${out}`);
