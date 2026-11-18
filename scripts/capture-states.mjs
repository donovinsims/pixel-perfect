#!/usr/bin/env node
import { join } from "node:path";
import { absolute, loadBrowser, parseArgs, publicSourceUrl, readJsonIfExists, requireOption, resolveViewports, stablePage, settle, writeJson } from "../lib/core.mjs";
import { archiveBaseline, buildManifest, writeManifest } from "../lib/evidence.mjs";
import { INTERACTIVE_SELECTOR, snapshotInteractiveState } from "../lib/observe.mjs";

const STATE_KEYS = ["color", "background", "backgroundImage", "border", "borderRadius", "boxShadow", "opacity", "transform", "transition", "outline", "filter"];

function limit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const url = publicSourceUrl(requireOption(args, "url"));
  const out = absolute(args.out || ".clone");
  const views = args.viewports ? resolveViewports(args.viewports) : [{ name: "desktop", viewport: { width: 1440, height: 1000 } }];
  const maxElements = limit(args.max, 80, 300);
  const priorManifest = await readJsonIfExists(join(out, "evidence", "manifest.json"));
  if (priorManifest) await archiveBaseline(out, "captured interaction-state observations");
  const browser = await loadBrowser();
  try {
    const written = [];
    const warnings = [...(priorManifest?.warnings ?? [])];
    for (const view of views) {
      const { context, page } = await stablePage(browser, view.viewport);
      // Capture ordinary states without allowing navigation, submission, or
      // destructive activation.
      await context.addInitScript(() => {
        document.addEventListener("click", (event) => event.preventDefault(), true);
        document.addEventListener("submit", (event) => event.preventDefault(), true);
        document.addEventListener("auxclick", (event) => event.preventDefault(), true);
      });
      const settled = await settle(page, url);
      for (const warning of settled.warnings) warnings.push(`${view.name}: ${warning}.`);
      const handles = (await page.$$(INTERACTIVE_SELECTOR)).slice(0, maxElements);
      const states = [];
      for (const handle of handles) {
        const base = await handle.evaluate(snapshotInteractiveState, STATE_KEYS).catch(() => null);
        if (!base || !base.visible) continue;
        const read = () => handle.evaluate(snapshotInteractiveState, STATE_KEYS).catch(() => null);
        let focus = null;
        let hover = null;
        let active = null;
        if (base.focusable) {
          await handle.evaluate((element) => element.focus?.()).catch(() => {});
          focus = await read();
        }
        await handle.hover({ timeout: 2_000 }).catch(() => {});
        hover = await read();
        const box = await handle.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          active = await read();
          await page.mouse.up();
        }
        await handle.evaluate((element) => element.blur?.()).catch(() => {});
        states.push({
          tag: base.tag,
          text: base.text,
          role: base.role,
          base: base.style,
          focus: focus?.style ?? null,
          hover: hover?.style ?? null,
          active: active?.style ?? null,
        });
      }
      const target = join(out, "evidence", `states-${view.name}.json`);
      await writeJson(target, states);
      written.push({ viewport: view.name, states: states.length, target });
      await context.close();
    }
    for (const entry of written) console.log(`Captured ${entry.states} interaction-state observations at ${entry.viewport}: ${entry.target}`);
    if (priorManifest) {
      const refreshed = await buildManifest({
        out,
        sourceUrl: priorManifest.sourceUrl,
        viewports: priorManifest.viewports,
        warnings,
        captureProfile: priorManifest.captureProfile ?? null,
      });
      await writeManifest(out, refreshed);
      console.log(`Frozen baseline refreshed safely; prior version archived under ${join(out, "baseline-history")}`);
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
