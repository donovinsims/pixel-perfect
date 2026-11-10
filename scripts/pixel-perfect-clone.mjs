#!/usr/bin/env node
import { lstatSync, readlinkSync } from "node:fs";
import { mkdir, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandExists, commandVersion, parseArgs, TOOL_VERSION } from "../lib/core.mjs";
import { triageEvidence } from "../lib/verify.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const canonical = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
if (!home) throw new Error("Unable to determine the current user's home directory.");

const usage = [
  "Usage: pixel-perfect-clone <command> [options]",
  "",
  "Commands:",
  "  doctor                      Report runtime, browser, and adapter state",
  "  install-global [--force]    Link the skill into detected agent directories",
  "  sync-global [--force]       Repair missing or stale skill links",
  "  capture-source --url URL [--out .clone] [--viewports desktop,tablet,mobile]",
  "  capture-states --url URL [--out .clone] [--viewports desktop] [--max 80]",
  "  capture-clone --url URL --out DIR [--viewports ...]",
  "  run-dembrandt --url URL [--out .clone]",
  "  screenshot-target --url URL --out DIR   (alias of capture-clone)",
  "  extract-tokens --source .clone [--out DIR]",
  "  evidence-check --source .clone",
  "  visual-diff --source DIR --clone DIR --out DIR [--source-sections DIR --clone-sections DIR]",
  "  compare-geometry --source .clone (--clone DIR | --clone-url URL) --out FILE",
  "  verify --source .clone --clone-url URL [--viewports ...] [--allow-review] [--require-frozen]",
  "  triage --source .clone",
  "",
  "Options:",
  "  --pass-ratio 0.005          Changed-pixel ratio at or below this is a pass candidate",
  "  --review-ratio 0.02         Changed-pixel ratio above this fails",
  "  --allow-review             Exit 0 when the machine gate is review instead of 2",
  "",
  "Exit codes: 0 pass, 1 fail, 2 review (attention required; not a pass)",
].join("\n");

const adapters = [
  { agent: "Claude Code", executable: "claude", path: join(home, ".claude", "skills", "pixel-perfect-clone") },
  { agent: "Codex", executable: "codex", path: join(home, ".codex", "skills", "pixel-perfect-clone") },
  { agent: "OpenCode", executable: "opencode", path: join(home, ".config", "opencode", "skills", "pixel-perfect-clone") },
  { agent: "Cursor", executable: "cursor", path: join(home, ".cursor", "skills", "pixel-perfect-clone") },
];

function linkState(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return "non-symlink";
    return resolve(dirname(path), readlinkSync(path)) === canonical ? "canonical" : "other-symlink";
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "broken";
  }
}

async function install() {
  for (const adapter of adapters) {
    if (!commandExists(adapter.executable)) {
      console.log(`${adapter.agent}: not installed; skipped`);
      continue;
    }
    const state = linkState(adapter.path);
    if (state === "canonical") {
      console.log(`${adapter.agent}: already linked`);
      continue;
    }
    if (state !== "missing" && !args.force) {
      console.log(`${adapter.agent}: ${state}; skipped (review, then use --force)`);
      continue;
    }
    if (state === "non-symlink") {
      const backup = `${adapter.path}.bak.${Date.now()}`;
      await rename(adapter.path, backup);
      console.log(`${adapter.agent}: existing directory moved to ${backup}`);
    } else if (state !== "missing") {
      await rm(adapter.path, { recursive: true, force: true });
    }
    await mkdir(dirname(adapter.path), { recursive: true });
    await symlink(canonical, adapter.path, "dir");
    console.log(`${adapter.agent}: linked ${adapter.path}`);
  }
}

async function doctor() {
  let playwright;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    playwright = {
      available: true,
      version: commandVersion(process.execPath, ["-e", `console.log(require(${JSON.stringify(join(canonical, "node_modules", "playwright", "package.json"))}).version)`]),
    };
  } catch (error) {
    playwright = { available: false, error: error.message.split("\n")[0] };
  }
  console.log(JSON.stringify({
    toolVersion: TOOL_VERSION,
    canonical,
    node: process.version,
    playwright,
    dembrandt: commandVersion("dembrandt"),
    adapters: adapters.map((adapter) => ({
      agent: adapter.agent,
      installed: commandExists(adapter.executable),
      executableVersion: commandExists(adapter.executable) ? commandVersion(adapter.executable) : null,
      path: adapter.path,
      state: linkState(adapter.path),
    })),
  }, null, 2));
}

async function main() {
  // A version request wins over the implicit help command, so `--version`
  // alone prints the version instead of the usage text.
  if (args.version || command === "version") {
    console.log(TOOL_VERSION);
    return;
  }
  if (command === "help" || args.help) {
    console.log(usage);
    return;
  }
  if (command === "doctor") await doctor();
  else if (command === "install-global" || command === "sync-global") await install();
  else if (command === "verify") await import("./verify-clone.mjs");
  else if (command === "extract-tokens") await import("./extract-tokens.mjs");
  else if (command === "evidence-check") await import("./evidence-check.mjs");
  else if (command === "triage") {
    const source = String(args.source || ".clone");
    const { triage } = await triageEvidence({ sourceDir: resolve(process.cwd(), source) });
    console.log(JSON.stringify({ summary: triage.summary, nextAction: triage.nextAction }, null, 2));
  } else if (["capture-source", "capture-states", "capture-clone", "screenshot-target", "visual-diff", "compare-geometry", "run-dembrandt"].includes(command)) {
    await import(`./${command}.mjs`);
  } else {
    throw new Error(`Unknown command: ${command}. ${usage}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
