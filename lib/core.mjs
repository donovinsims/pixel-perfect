import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const VIEWPORTS = { desktop: { width: 1440, height: 1000 }, tablet: { width: 768, height: 1000 }, mobile: { width: 390, height: 844 } };
export function parseArgs(argv) { const out = { _: [] }; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith("--")) { out._.push(item); continue; } const [key, inline] = item.slice(2).split("=", 2); out[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true); } return out; }
export function requireOption(args, key) { if (!args[key] || args[key] === true) throw new Error(`Missing --${key}.`); return String(args[key]); }
export const absolute = (path) => resolve(process.cwd(), path);
export async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
export async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
export async function loadBrowser() { const { chromium } = await import("playwright"); return chromium.launch({ headless: true }); }
export async function stablePage(browser, viewport) { const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" }); const page = await context.newPage(); return { context, page }; }
export async function settle(page, url) { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }); await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}); await page.evaluate(async () => { await document.fonts?.ready; await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((done) => { i.addEventListener("load", done, { once: true }); i.addEventListener("error", done, { once: true }); }))); await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); }); }
export function safeName(value) { return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "capture"; }
export function rectOf(rect) { return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; }
