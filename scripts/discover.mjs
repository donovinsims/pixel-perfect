#!/usr/bin/env node
import { join } from "node:path";
import { absolute, parseArgs, requireOption } from "../lib/core.mjs";
import { discoverSite } from "../lib/discover.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const url = requireOption(args, "url");
  const out = join(absolute(args.out || ".clone"), "discovery");
  const scope = args.scope ? String(args.scope).split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  const result = await discoverSite({
    url,
    out,
    scope,
    maxRoutes: args["max-routes"] === undefined ? 50 : Number(args["max-routes"]),
    maxDepth: args["max-depth"] === undefined ? 4 : Number(args["max-depth"]),
    concurrency: args.concurrency === undefined ? 2 : Number(args.concurrency),
  });
  console.log(`Discovered ${result.coverage.discovered} routes; ${result.coverage.captured} inspected, ${result.coverage.failed} failed or blocked.`);
  console.log(`Site map: ${out}`);
  if (result.coverage.routeLimitReached) console.log("warning: route cap reached; coverage is incomplete.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
