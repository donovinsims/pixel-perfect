#!/usr/bin/env node
import { join } from "node:path";
import { absolute, loadBrowser, parseArgs, requireOption, resolveViewports, stablePage, settle, writeJson } from "../lib/core.mjs";
import { INTERACTIVE_SELECTOR } from "../lib/observe.mjs";

const STATE_KEYS = ["color", "background", "backgroundImage", "border", "borderRadius", "boxShadow", "opacity", "transform", "transition", "outline", "filter"];

function limit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const snapshotScript = (element, keys) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(),
    text: (element.innerText || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120),
    role: element.getAttribute("role") || null,
    visible: rect.width > 0 && rect.height > 0,
    focusable: element.tabIndex >= 0 && !element.disabled,
    style: Object.fromEntries(keys.map((key) => [key, style[key]])),
  };
};

try {
  const args = parseArgs(process.argv.slice(2));
  const url = requireOption(args, "url");
  const out = absolute(args.out || ".clone");
  const views = args.viewports ? resolveViewports(args.viewports) : [{ name: "desktop", viewport: { width: 1440, height: 1000 } }];
  const maxElements = limit(args.max, 80, 300);
  const browser = await loadBrowser();
  try {
    const written = [];
    for (const view of views) {
      const { context, page } = await stablePage(browser, view.viewport);
      // Capture ordinary states without allowing navigation, submission, or
      // destructive activation.
      await context.addInitScript(() => {
        document.addEventListener("click", (event) => event.preventDefault(), true);
        document.addEventListener("submit", (event) => event.preventDefault(), true);
        document.addEventListener("auxclick", (event) => event.preventDefault(), true);
      });
      await settle(page, url);
      const handles = (await page.$$(INTERACTIVE_SELECTOR)).slice(0, maxElements);
      const states = [];
      for (const handle of handles) {
        const base = await handle.evaluate(snapshotScript, STATE_KEYS).catch(() => null);
        if (!base || !base.visible) continue;
        const read = () => handle.evaluate(snapshotScript, STATE_KEYS).catch(() => null);
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
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
