#!/usr/bin/env node
import { join } from "node:path";
import { absolute, loadBrowser, parseArgs, requireOption, readJson, settle, stablePage, VIEWPORTS, writeJson } from "../lib/core.mjs";

const args = parseArgs(process.argv.slice(2));
const source = absolute(requireOption(args, "source"));
const cloneUrl = requireOption(args, "clone-url");
const out = absolute(requireOption(args, "out"));
const browser = await loadBrowser();
const results = [];

try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const sourceObs = await readJson(join(source, "evidence", `observation-${name}.json`));
    const { context, page } = await stablePage(browser, viewport);
    await settle(page, cloneUrl);
    const clone = await page.evaluate(() => [...document.querySelectorAll("body > header, main > *, body > footer")]
      .filter((element) => element.getBoundingClientRect().height > 4)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          text: (element.innerText || "").trim().replace(/\s+/g, " ").slice(0, 220),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          style: {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            background: style.background,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            padding: style.padding,
            gap: style.gap,
          },
        };
      }));

    const comparisons = sourceObs.sections.map((sourceSection, sourceIndex) => {
      const exactIndex = clone.findIndex((candidate) => candidate.text && candidate.text === sourceSection.text);
      const cloneIndex = exactIndex >= 0 ? exactIndex : sourceIndex < clone.length ? sourceIndex : -1;
      if (cloneIndex < 0) return { source: sourceSection.selector, matchedBy: "missing", status: "fail" };

      const target = clone[cloneIndex];
      const matchedBy = exactIndex >= 0 ? "text" : "index";
      const deltas = Object.fromEntries(Object.entries(sourceSection.rect).map(([key, value]) => [key, target.rect[key] - value]));
      const result = { source: sourceSection.selector, cloneIndex, matchedBy, status: matchedBy === "text" ? "measured" : "review", deltas };
      if (matchedBy === "text") {
        result.styleMatches = Object.fromEntries(Object.entries(sourceSection.style)
          .filter(([key]) => key in target.style)
          .map(([key, value]) => [key, value === target.style[key]]));
      }
      return result;
    });

    results.push({ viewport: name, comparisons });
    await context.close();
  }

  await writeJson(out, { generatedAt: new Date().toISOString(), results });
  console.log(`Geometry report: ${out}`);
} finally {
  await browser.close();
}
