#!/usr/bin/env node
import { mkdir } from "node:fs/promises"; import { join } from "node:path"; import { VIEWPORTS, absolute, loadBrowser, parseArgs, requireOption, settle, stablePage } from "../lib/core.mjs";
const args = parseArgs(process.argv.slice(2)); const url = requireOption(args, "url"); const out = absolute(requireOption(args, "out")); const browser = await loadBrowser();
try { await mkdir(out, { recursive: true }); for (const [name, viewport] of Object.entries(VIEWPORTS)) { const { context, page } = await stablePage(browser, viewport); await settle(page, url); await page.screenshot({ path: join(out, `${name}.png`), fullPage: true, animations: "disabled" }); await context.close(); } console.log(`Screenshots: ${out}`); } finally { await browser.close(); }
