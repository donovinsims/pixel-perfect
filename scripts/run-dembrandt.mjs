#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, commandExists, parseArgs, requireOption } from "../lib/core.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const url = requireOption(args, "url");
  const out = absolute(args.out || ".clone");
  if (!commandExists("dembrandt")) throw new Error("dembrandt is not installed. It is an optional secondary cross-check; install it or skip this command.");
  await mkdir(join(out, "source"), { recursive: true });
  const target = join(out, "source", "dembrandt.json");
  const redact = (value) => (process.env.DEMBRANDT_KEY ? String(value).split(process.env.DEMBRANDT_KEY).join("[REDACTED]") : String(value));
  await new Promise((resolve, reject) => {
    execFile("dembrandt", [url, "--json-only"], { env: process.env, maxBuffer: 10_000_000 }, async (error, stdout, stderr) => {
      if (error) return reject(new Error(redact(stderr || error.message)));
      await writeFile(target, redact(stdout));
      resolve();
    });
  });
  console.log(`Dembrandt cross-check: ${target}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
