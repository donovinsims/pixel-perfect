#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { captureTarget, writeSourceBundle } from "../lib/capture.mjs";
import { absolute, captureProfileFrom, parseArgs, publicSourceUrl, readJson, requireOption, resolveViewports } from "../lib/core.mjs";
import { archiveBaseline } from "../lib/evidence.mjs";
import { buildEvidenceBinding, recordProjectStatus } from "../lib/lifecycle.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const routeInventory = args.routes ? await readJson(absolute(String(args.routes))) : null;
  const url = args.url ? requireOption(args, "url") : routeInventory?.sourceUrl;
  if (!url) throw new Error("Missing --url (or use a route inventory with sourceUrl via --routes).");
  const sourceUrl = publicSourceUrl(url);
  const out = absolute(args.out || ".clone");
  const baseViews = resolveViewports(args.viewports);
  let views = baseViews;
  if (routeInventory) {
    if (!Array.isArray(routeInventory.routes) || !routeInventory.routes.length) throw new Error("The route inventory must contain a non-empty routes array.");
    const inventorySourceUrl = publicSourceUrl(routeInventory.sourceUrl);
    if (new URL(sourceUrl).origin !== new URL(inventorySourceUrl).origin) throw new Error("--url must use the route inventory's starting origin.");
    const scopeEntries = routeInventory.scope ?? [new URL(inventorySourceUrl).origin];
    if (!Array.isArray(scopeEntries)) throw new Error("The route inventory scope must be an array of authorized origins.");
    const allowedOrigins = new Set(scopeEntries.map((entry) => {
      const scoped = new URL(entry);
      if (!["http:", "https:"].includes(scoped.protocol) || scoped.username || scoped.password || scoped.origin !== entry) {
        throw new Error(`Invalid authorized scope origin in route inventory: ${entry}`);
      }
      return scoped.origin;
    }));
    if (!allowedOrigins.has(new URL(inventorySourceUrl).origin)) throw new Error("The route inventory scope does not include its starting origin.");
    const routeIds = new Set();
    views = routeInventory.routes.flatMap((route) => {
      if (!/^route-[a-f0-9]{10}$/.test(route?.id ?? "") || routeIds.has(route.id)) {
        throw new Error(`Invalid or duplicate stable route identifier: ${route?.id ?? "(missing)"}`);
      }
      routeIds.add(route.id);
      let routeUrl;
      try { routeUrl = new URL(route.canonicalUrl || route.url, inventorySourceUrl); } catch {
        throw new Error(`Invalid route URL for ${route.id}.`);
      }
      if (!allowedOrigins.has(routeUrl.origin) || !["http:", "https:"].includes(routeUrl.protocol) || routeUrl.username || routeUrl.password || routeUrl.search || routeUrl.hash) {
        throw new Error(`Route is outside the authorized, query-free inventory scope: ${routeUrl.origin}`);
      }
      const routePath = route.routePath ?? routeUrl.pathname;
      let routePathUrl;
      try { routePathUrl = new URL(routePath, routeUrl.origin); } catch {
        throw new Error(`Invalid route path for ${route.id}.`);
      }
      if (typeof routePath !== "string" || !routePath.startsWith("/") || routePath.startsWith("//") || routePathUrl.origin !== routeUrl.origin || routePathUrl.pathname !== routePath || routePathUrl.search || routePathUrl.hash || routePath !== routeUrl.pathname) {
        throw new Error(`Route path does not match the authorized route URL for ${route.id}.`);
      }
      return baseViews.map((view) => ({
        ...view,
        name: `${route.id}__${view.name}`,
        viewportName: view.name,
        routeId: route.id,
        routePath,
        routeUrl: routeUrl.href,
        url: routeUrl.href,
        blockedReason: route.discoveryStatus === "robots_disallowed" ? "route is disallowed by robots.txt" : null,
      }));
    });
  }
  if (!views.length) throw new Error("The route inventory contains no routes to capture.");
  const profile = args.profile ? captureProfileFrom(await readJson(absolute(String(args.profile)))) : undefined;

  // Validate all user-controlled inputs before archiving or replacing a baseline.
  const archivedBaseline = await archiveBaseline(out, "recaptured source baseline");
  if (archivedBaseline) {
    await rm(join(out, "source"), { recursive: true, force: true });
    await rm(join(out, "evidence"), { recursive: true, force: true });
    console.log(`Prior frozen baseline preserved at ${archivedBaseline}`);
  }
  const capture = await captureTarget({ url: sourceUrl, views, captureHtml: true, profile });
  const { manifest, summaries } = await writeSourceBundle({ out, capture, sourceUrl, noRegionsExpected: Boolean(args["no-regions-expected"]) });
  // A new baseline invalidates any earlier delivery decision.
  await recordProjectStatus({
    sourceDir: out,
    status: "IN_PROGRESS",
    reason: "source baseline captured",
    binding: buildEvidenceBinding({ manifest }),
    sourceUrl,
  });
  console.log(`Captured ${summaries.length} responsive source views in ${out}`);
  for (const summary of summaries) {
    console.log(`  ${summary.routeId ? `${summary.routeId} ` : ""}${summary.name} ${summary.viewport.width}x${summary.viewport.height}: ${summary.sections} regions, ${summary.cropped} cropped${summary.captureStatus === "failed" ? " (capture failed)" : ""}`);
  }
  console.log(`Frozen evidence: ${manifest.artifacts.length} checksummed artifacts in ${out}/evidence/manifest.json`);
  if (manifest.warnings.length) {
    for (const warning of manifest.warnings) console.log(`  warning: ${warning}`);
  }
  if (capture.pages.some((page) => page.error)) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
