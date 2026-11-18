import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBrowser, shortHash, writeJson } from "./core.mjs";

function parseScope(url, scope = []) {
  const start = new URL(url);
  if (!["http:", "https:"].includes(start.protocol) || start.username || start.password) throw new Error("Discovery requires a public HTTP(S) URL without embedded credentials.");
  const origins = new Set([start.origin]);
  for (const entry of scope) {
    const parsed = new URL(entry);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`Invalid authorized scope origin: ${entry}`);
    origins.add(parsed.origin);
  }
  return origins;
}

export function normalizeRouteUrl(value, base, allowedOrigins) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !allowedOrigins.has(url.origin)) return null;
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

function routeId(url) {
  return `route-${shortHash(url, 10)}`;
}

async function readLimitedText(response, maxBytes = 2_000_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Discovery document exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function safeFetchText(url, allowedOrigins) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!allowedOrigins.has(current.origin)) return { ok: false, blocked: true, url: current.href, text: "" };
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { accept: "text/plain, application/xml, text/xml, */*;q=0.1" } }).catch(() => null);
    if (!response) return { ok: false, url: current.href, status: 0, text: "" };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, url: current.href, status: response.status, text: "" };
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) return { ok: false, url: current.href, status: response.status, text: "" };
    const text = await readLimitedText(response).catch(() => null);
    if (text === null) return { ok: false, url: current.href, status: response.status, text: "" };
    return { ok: true, url: current.href, status: response.status, text };
  }
  return { ok: false, url: current.href, status: 0, text: "" };
}

function parseRobots(text) {
  const disallow = [];
  const allow = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const [rawKey, ...rest] = raw.split(":");
    if (!rawKey) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (key === "disallow" && applies && value) disallow.push(value);
    else if (key === "allow" && applies && value) allow.push(value);
    else if (key === "sitemap" && value) sitemaps.push(value);
  }
  return { disallow, allow, sitemaps };
}

function robotsAllows(url, rules) {
  const path = new URL(url).pathname;
  const matching = [
    ...rules.disallow.map((value) => ({ value, allowed: false })),
    ...rules.allow.map((value) => ({ value, allowed: true })),
  ].filter((rule) => path.startsWith(rule.value)).sort((a, b) => b.value.length - a.value.length || Number(b.allowed) - Number(a.allowed));
  return matching.length === 0 || matching[0].allowed;
}

async function discoverSitemaps(startUrl, allowedOrigins, maxRoutes) {
  const origin = new URL(startUrl).origin;
  const robotsResponse = await safeFetchText(`${origin}/robots.txt`, allowedOrigins);
  const robots = parseRobots(robotsResponse.ok ? robotsResponse.text : "");
  const pending = [...robots.sitemaps, `${origin}/sitemap.xml`];
  const visited = new Set();
  const routes = new Set();
  while (pending.length && visited.size < 8 && routes.size < maxRoutes * 4) {
    const sitemap = normalizeRouteUrl(pending.shift(), startUrl, allowedOrigins);
    if (!sitemap || visited.has(sitemap)) continue;
    visited.add(sitemap);
    const response = await safeFetchText(sitemap, allowedOrigins);
    if (!response.ok) continue;
    for (const match of response.text.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)) {
      const location = match[1].replace(/&amp;/g, "&").trim();
      if (/<sitemapindex\b/i.test(response.text.slice(0, 5000))) {
        if (pending.length + visited.size < 8) pending.push(location);
      } else {
        const normalized = normalizeRouteUrl(location, sitemap, allowedOrigins);
        if (normalized) routes.add(normalized);
      }
      if (routes.size >= maxRoutes * 4) break;
    }
  }
  return { routes: [...routes], robots, robotsStatus: robotsResponse.ok ? "read" : "unavailable", sitemaps: [...visited] };
}

async function inspectRoute(browser, entry, allowedOrigins) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      let origin;
      try { origin = new URL(request.url()).origin; } catch { origin = ""; }
      if (!allowedOrigins.has(origin)) return route.abort();
    }
    return route.continue();
  });
  try {
    const response = await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = response?.status() ?? 0;
    const landed = normalizeRouteUrl(page.url(), entry.url, allowedOrigins) ?? entry.url;
    const details = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const nodes = [...document.querySelectorAll("body > header, body > nav, main, body > footer, [role=banner], [role=navigation], [role=contentinfo]")].filter(visible);
      const layout = nodes.map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 3).join(".")}`);
      const repeated = new Map();
      for (const element of document.querySelectorAll("[class]")) {
        const classes = [...element.classList].slice(0, 3).sort().join(".");
        if (classes) repeated.set(classes, (repeated.get(classes) ?? 0) + 1);
      }
      const components = [...repeated].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([classes, count]) => ({ classes, count }));
      const links = [...document.querySelectorAll("a[href]")].map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120),
      }));
      return {
        title: document.title,
        canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
        headings: [...document.querySelectorAll("h1,h2,h3")].map((heading) => (heading.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 80),
        links,
        layout,
        components,
      };
    });
    return { ...entry, landedUrl: landed, canonicalUrl: normalizeRouteUrl(details.canonical, landed, allowedOrigins) ?? landed, status, details, error: null };
  } catch (error) {
    return { ...entry, landedUrl: null, canonicalUrl: null, status: 0, details: null, error: error.message };
  } finally {
    await context.close();
  }
}

function safeLimit(value, fallback, maximum) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw new Error(`Discovery limit must be an integer from 1 to ${maximum}.`);
  return number;
}

export async function discoverSite({ url, out, scope = [], maxRoutes = 50, maxDepth = 4, concurrency = 2 }) {
  const allowedOrigins = parseScope(url, scope);
  const limits = {
    maxRoutes: safeLimit(maxRoutes, 50, 1000),
    maxDepth: safeLimit(maxDepth, 4, 20),
    concurrency: safeLimit(concurrency, 2, 8),
  };
  const startUrl = normalizeRouteUrl(url, url, allowedOrigins);
  if (!startUrl) throw new Error("Starting URL is outside the authorized HTTP(S) scope.");
  const sitemap = await discoverSitemaps(startUrl, allowedOrigins, limits.maxRoutes);
  const robotsRules = sitemap.robots;
  const robotsByOrigin = new Map([[new URL(startUrl).origin, Promise.resolve(robotsRules)]]);
  const loadRobots = (origin) => {
    if (!robotsByOrigin.has(origin)) {
      robotsByOrigin.set(origin, safeFetchText(`${origin}/robots.txt`, allowedOrigins).then((response) => parseRobots(response.ok ? response.text : "")));
    }
    return robotsByOrigin.get(origin);
  };
  const candidates = new Map();
  let routeLimitReached = false;
  let depthLimitReached = false;
  const add = (value, depth, discoveredBy, from = null) => {
    const normalized = normalizeRouteUrl(value, startUrl, allowedOrigins);
    if (!normalized) return;
    const existing = candidates.get(normalized);
    if (existing) {
      if (from && !existing.discoveredFrom.includes(from)) existing.discoveredFrom.push(from);
      return;
    }
    if (depth > limits.maxDepth) {
      depthLimitReached = true;
      return;
    }
    if (candidates.size >= limits.maxRoutes) {
      routeLimitReached = true;
      return;
    }
    candidates.set(normalized, { url: normalized, depth, discoveredBy, discoveredFrom: from ? [from] : [] });
  };
  add(startUrl, 0, "start-url");
  for (const route of sitemap.routes) add(route, 1, "sitemap");
  const browser = await loadBrowser();
  const inspected = [];
  try {
    while (true) {
      const pending = [...candidates.values()].filter((candidate) => !candidate.inspected).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
      if (!pending.length) break;
      const batch = pending.slice(0, limits.concurrency);
      for (const candidate of batch) candidate.inspected = true;
      const results = await Promise.all(batch.map(async (candidate) => {
        const originRules = await loadRobots(new URL(candidate.url).origin);
        if (!robotsAllows(candidate.url, originRules)) return { ...candidate, status: 0, details: null, error: "Disallowed by robots.txt", discoveryStatus: "robots_disallowed", landedUrl: null, canonicalUrl: null };
        const result = await inspectRoute(browser, candidate, allowedOrigins);
        result.discoveryStatus = result.error ? "failed" : result.status >= 400 ? "http_error" : "captured";
        return result;
      }));
      for (const result of results) {
        inspected.push(result);
        if (!result.details) continue;
        const fromUrl = result.canonicalUrl ?? result.url;
        for (const link of result.details.links) {
          const target = normalizeRouteUrl(link.href, fromUrl, allowedOrigins);
          if (!target) continue;
          add(target, result.depth + 1, "internal-navigation", result.url);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const canonicalGroups = new Map();
  for (const entry of inspected) {
    const key = entry.canonicalUrl ?? entry.url;
    const group = canonicalGroups.get(key) ?? { ...entry, url: key, canonicalUrl: key, aliases: [], discoveredFrom: [...entry.discoveredFrom] };
    for (const alias of [entry.url, entry.landedUrl].filter(Boolean)) if (alias !== key && !group.aliases.includes(alias)) group.aliases.push(alias);
    for (const from of entry.discoveredFrom) if (!group.discoveredFrom.includes(from)) group.discoveredFrom.push(from);
    if (group.discoveryStatus !== "captured" && entry.discoveryStatus === "captured") {
      Object.assign(group, entry, { url: key, canonicalUrl: key });
    }
    canonicalGroups.set(key, group);
  }
  const routes = [...canonicalGroups.values()].map((entry) => ({
    id: routeId(entry.canonicalUrl ?? entry.url),
    url: entry.url,
    canonicalUrl: entry.canonicalUrl ?? entry.url,
    routePath: new URL(entry.canonicalUrl ?? entry.url).pathname,
    title: entry.details?.title ?? "",
    status: entry.status,
    depth: entry.depth,
    discoveredBy: entry.discoveredBy,
    discoveredFrom: entry.discoveredFrom,
    aliases: entry.aliases ?? [],
    discoveryStatus: entry.discoveryStatus,
    error: entry.error,
    headings: entry.details?.headings ?? [],
    layout: entry.details?.layout ?? [],
    components: entry.details?.components ?? [],
  })).sort((a, b) => a.routePath.localeCompare(b.routePath));
  const byUrl = new Map();
  for (const route of routes) for (const value of [route.url, route.canonicalUrl, ...route.aliases]) byUrl.set(value, route.id);
  const relationships = [];
  for (const entry of inspected) {
    const from = byUrl.get(entry.url);
    for (const link of entry.details?.links ?? []) {
      const target = normalizeRouteUrl(link.href, entry.canonicalUrl ?? entry.url, allowedOrigins);
      const to = byUrl.get(target);
      if (from && to && from !== to && !relationships.some((edge) => edge.from === from && edge.to === to)) relationships.push({ from, to, label: link.text });
    }
  }
  const templateGroups = new Map();
  for (const route of routes) {
    const original = inspected.find((entry) => route.id === routeId(entry.canonicalUrl ?? entry.url));
    const signature = JSON.stringify(original?.details?.layout ?? []);
    const template = templateGroups.get(signature) ?? { id: `template-${shortHash(signature, 8)}`, signature: original?.details?.layout ?? [], routes: [] };
    template.routes.push(route.id);
    templateGroups.set(signature, template);
    route.templateId = template.id;
  }
  const templates = [...templateGroups.values()];
  const recurring = new Map();
  for (const route of routes) for (const component of route.components) {
    const item = recurring.get(component.classes) ?? { signature: component.classes, routes: [], instances: 0 };
    item.instances += component.count;
    if (!item.routes.includes(route.id)) item.routes.push(route.id);
    recurring.set(component.classes, item);
  }
  const sharedComponents = [...recurring.values()].filter((component) => component.routes.length > 1).sort((a, b) => b.routes.length - a.routes.length || b.instances - a.instances);
  const missingPages = routes.filter((route) => route.status >= 400 || route.discoveryStatus === "failed" || route.discoveryStatus === "robots_disallowed").map(({ id, url: routeUrl, status, error, discoveryStatus }) => ({ id, url: routeUrl, status, error, discoveryStatus }));
  const routeMap = { generatedAt: new Date().toISOString(), sourceUrl: startUrl, scope: [...allowedOrigins], routes, relationships, templates, sharedComponents, missingPages, sitemap: { status: sitemap.robotsStatus, urls: sitemap.sitemaps } };
  const knownRoutes = new Set(routes.map((route) => route.id));
  const coverage = {
    generatedAt: routeMap.generatedAt,
    sourceUrl: startUrl,
    configured: limits,
    discovered: routes.length,
    captured: routes.filter((route) => route.discoveryStatus === "captured").length,
    failed: routes.filter((route) => route.discoveryStatus !== "captured").length,
    routeLimitReached,
    truncated: routeLimitReached || depthLimitReached,
    missingPages,
    routes: routes.map((route) => ({ id: route.id, url: route.url, status: route.discoveryStatus, httpStatus: route.status })),
    relationships: relationships.filter((edge) => knownRoutes.has(edge.from) && knownRoutes.has(edge.to)).length,
  };
  await mkdir(out, { recursive: true });
  await writeJson(join(out, "routes.json"), { generatedAt: routeMap.generatedAt, sourceUrl: startUrl, scope: routeMap.scope, routes: routeMap.routes });
  await writeJson(join(out, "site-map.json"), routeMap);
  await writeJson(join(out, "route-coverage.json"), coverage);
  await writeFile(join(out, "SITE-MAP.md"), renderSiteMapMarkdown(routeMap, coverage));
  return { routeMap, coverage, out };
}

export function renderSiteMapMarkdown(siteMap, coverage) {
  const routes = siteMap.routes.map((route) => `| ${route.id} | [${route.routePath}](${route.url}) | ${route.status || "—"} | ${route.discoveryStatus} | ${route.templateId} | ${route.depth} |`).join("\n");
  const components = siteMap.sharedComponents.length
    ? siteMap.sharedComponents.map((component) => `- .${component.signature} — ${component.routes.length} routes, ${component.instances} observed instances`).join("\n")
    : "- No recurring class signatures detected.";
  const missing = siteMap.missingPages.length
    ? siteMap.missingPages.map((entry) => `- ${entry.url} — ${entry.discoveryStatus}${entry.status ? ` (HTTP ${entry.status})` : ""}${entry.error ? `: ${entry.error}` : ""}`).join("\n")
    : "- None observed.";
  return `# Website route map\n\nStarting URL: ${siteMap.sourceUrl}\n\n## Coverage\n\n- Discovered: ${coverage.discovered}\n- Successfully inspected: ${coverage.captured}\n- Failed or blocked: ${coverage.failed}\n- Route limit reached: ${coverage.routeLimitReached ? "yes" : "no"}\n\n## Routes\n\n| Stable ID | Route | HTTP | Discovery status | Template | Depth |\n| --- | --- | ---: | --- | --- | ---: |\n${routes || "| — | — | — | none | — | — |"}\n\n## Shared components\n\n${components}\n\n## Missing or restricted pages\n\n${missing}\n\n## Layout templates\n\n${siteMap.templates.map((template) => `- ${template.id}: ${template.routes.map((id) => siteMap.routes.find((route) => route.id === id)?.routePath ?? id).join(", ")}`).join("\n") || "- No templates observed."}\n`;
}
