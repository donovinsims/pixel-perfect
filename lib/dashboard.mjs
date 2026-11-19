/**
 * Static, dependency-free dashboard. Everything is relative and embedded, so
 * the page works from file:// with no server, network, or paid service.
 * Captured content is untrusted: every interpolated string is escaped, links
 * are restricted to relative files or http(s), and colours are only applied to
 * style attributes when they match a conservative CSS colour pattern.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

/** Allow relative deliverable links and http(s); reject script-capable URLs. */
export function safeLinkHref(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^(https?:)\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  if (text.startsWith("//")) return null;
  return text.replace(/[\u0000-\u001f\u007f"<>]/g, "");
}

const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%/]+\)|hsla?\([0-9.,\s%/deg]+\)|[a-z]{3,24})$/i;

export function safeCssColor(value) {
  const text = String(value ?? "").trim();
  return CSS_COLOR.test(text) && !/url\(|expression|javascript:/i.test(text) ? text : null;
}

export function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(3)}%` : "—";
}

export function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function statusSlug(status) {
  return String(status ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function badge(status) {
  return `<span class="badge badge-${escapeHtml(statusSlug(status))}">${escapeHtml(status)}</span>`;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="empty">Nothing measured for this section.</p>`;
  const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function figure(src, caption, alt) {
  if (!src) return `<figure class="figure figure-empty"><div class="placeholder">Not captured</div><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  const href = safeLinkHref(src);
  if (!href) return `<figure class="figure figure-empty"><div class="placeholder">Unsafe image reference removed</div><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  return `<figure class="figure"><img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" width="100%"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function colorSwatch(value, count, viewports) {
  const color = safeCssColor(value);
  const swatch = color
    ? `<span class="swatch" style="background:${escapeHtml(color)}" aria-hidden="true"></span>`
    : `<span class="swatch swatch-unknown" aria-hidden="true">?</span>`;
  return `${swatch}<code>${escapeHtml(value)}</code>${count !== undefined ? ` <span class="muted">×${escapeHtml(count)}${viewports?.length ? ` · ${escapeHtml(viewports.join(", "))}` : ""}</span>` : ""}`;
}

function stat(label, value, hint = "") {
  return `<div class="stat"><span class="stat-label">${escapeHtml(label)}</span><strong class="stat-value">${escapeHtml(value)}</strong>${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ""}</div>`;
}

function viewLabel(view) {
  const parts = [];
  if (view.routePath) parts.push(view.routePath);
  if (view.viewportName) parts.push(view.viewportName);
  if (view.width && view.height) parts.push(`${view.width}×${view.height}`);
  return parts.join(" · ") || view.name;
}

function renderRoutes(model) {
  if (!model.routes.length) {
    return `<p class="empty">Discovery was not run for this bundle. Captured routes are listed under screens.</p>`;
  }
  return table(["Route", "Title", "Discovery", "HTTP", "Template", "Depth"], model.routes.map((route) => [
    `<code>${escapeHtml(route.routePath)}</code>`,
    escapeHtml(route.title || "—"),
    badge(route.discoveryStatus || "unknown"),
    escapeHtml(route.status || "—"),
    escapeHtml(route.templateId || "—"),
    escapeHtml(route.depth ?? "—"),
  ]));
}

function renderCoverage(model) {
  const coverage = model.coverage;
  if (!coverage) return `<p class="empty">No route-coverage report was captured.</p>`;
  const cards = [
    stat("Discovered", String(coverage.discovered ?? "—")),
    stat("Captured", String(coverage.captured ?? "—")),
    stat("Not captured", String(coverage.failed ?? "—")),
    stat("Truncated", coverage.truncated ? "yes" : "no", coverage.truncated ? "route or depth limits reached" : "complete within configured limits"),
  ].join("");
  const missing = (coverage.missingPages ?? []).map((page) => `<li><code>${escapeHtml(page.url)}</code> — ${escapeHtml(page.discoveryStatus ?? "unknown")}${page.status ? ` (HTTP ${escapeHtml(page.status)})` : ""}</li>`).join("");
  return `<div class="stats">${cards}</div>${missing ? `<h3>Routes not captured</h3><ul class="list">${missing}</ul>` : ""}`;
}

function renderScreens(model) {
  if (!model.views.length) return `<p class="empty">No captures are recorded in the manifest.</p>`;
  const tabs = model.views.map((view, index) => `<button type="button" class="chip view-tab" data-view-target="${escapeHtml(view.name)}" aria-selected="${index === 0 ? "true" : "false"}">${escapeHtml(viewLabel(view))}</button>`).join("");
  const panels = model.views.map((view, index) => {
    const result = view.result;
    const meta = result
      ? `${formatPercent(result.changeRatio)} changed · ${escapeHtml(result.result ?? "unknown")}${result.dimensionMismatch ? " · dimension mismatch" : ""}${result.missing ? " · missing image" : ""}`
      : "No full-page comparison recorded for this capture.";
    const regions = view.regions.map((region) => `<div class="region">
      <h4><code>${escapeHtml(region.slug)}</code> ${region.result ? badge(region.result) : ""}</h4>
      <p class="muted">${escapeHtml(region.changeRatio === null || region.changeRatio === undefined ? "no diff" : `${formatPercent(region.changeRatio)} changed`)}${region.width && region.height ? ` · ${escapeHtml(region.width)}×${escapeHtml(region.height)}` : ""}</p>
      <div class="pair">
        ${figure(region.sourceImage, "Original region", `Original ${region.slug}`)}
        ${figure(region.cloneImage, "Reconstructed region", `Reconstructed ${region.slug}`)}
      </div>
    </div>`).join("");
    return `<div class="view" data-view-panel="${escapeHtml(view.name)}" ${index === 0 ? "" : "hidden"}>
      <h3>${escapeHtml(viewLabel(view))}</h3>
      <p class="muted">${escapeHtml(meta)}</p>
      <div class="triple">
        ${figure(view.images.source, "Original (full page)", `Original ${view.name}`)}
        ${figure(view.images.clone, "Reconstructed", `Reconstructed ${view.name}`)}
        ${figure(view.images.diff, "Difference", `Difference ${view.name}`)}
      </div>
      ${regions ? `<h4>Regions</h4><div class="regions">${regions}</div>` : `<p class="empty">No region crops recorded for this capture.</p>`}
    </div>`;
  }).join("");
  return `<div class="view-tabs" role="tablist" aria-label="Captures">${tabs}</div>${panels}`;
}

function renderDesign(model) {
  const tokens = model.tokens;
  const system = model.designSystem;
  if (!tokens) return `<p class="empty">No measured tokens were captured.</p>`;
  const colors = (tokens.colors ?? []).slice(0, 24).map((entry) => `<li>${colorSwatch(entry.value, entry.count, entry.viewports)}</li>`).join("");
  const scale = (tokens.typography?.scale ?? []).slice(0, 20).map((entry) => [
    `<code>${escapeHtml(entry.fontSize)}</code>`,
    `<code>${escapeHtml(entry.lineHeight)}</code>`,
    `<code>${escapeHtml(entry.fontWeight)}</code>`,
    escapeHtml(entry.count ?? ""),
    escapeHtml((entry.viewports ?? []).join(", ")),
  ]);
  const spacing = (tokens.spacing ?? []).slice(0, 24).map((entry) => `<li><code>${escapeHtml(entry.value)}</code> <span class="muted">×${escapeHtml(entry.count ?? 0)}</span></li>`).join("");
  const families = (tokens.typography?.families ?? []).map((entry) => `<li><code>${escapeHtml(entry.value)}</code> <span class="muted">×${escapeHtml(entry.count ?? 0)}</span></li>`).join("");
  const variables = Object.entries(tokens.cssVariables ?? {}).slice(0, 40).map(([name, value]) => `<li><code>${escapeHtml(name)}: ${escapeHtml(value)}</code></li>`).join("");
  const effects = [
    ...(tokens.radii ?? []).slice(0, 12).map((entry) => `<li>radius <code>${escapeHtml(entry.value)}</code> <span class="muted">×${escapeHtml(entry.count ?? 0)}</span></li>`),
    ...(tokens.shadows ?? []).slice(0, 12).map((entry) => `<li>shadow <code>${escapeHtml(entry.value)}</code> <span class="muted">×${escapeHtml(entry.count ?? 0)}</span></li>`),
    ...(tokens.backgrounds ?? []).slice(0, 8).map((entry) => `<li>background <code>${escapeHtml(entry.value)}</code> <span class="muted">×${escapeHtml(entry.count ?? 0)}</span></li>`),
  ].join("");
  const headings = (system?.typography?.headingHierarchy ?? []).map((entry) => [
    `<code>${escapeHtml(entry.level)}</code>`,
    escapeHtml(entry.fontFamily ?? "—"),
    `<code>${escapeHtml(entry.fontSize ?? "—")}</code>`,
    escapeHtml(entry.fontWeight ?? "—"),
    escapeHtml((entry.examples ?? []).join("; ") || "—"),
  ]);
  return `<div class="grid-two">
    <section><h3>Colour</h3><ul class="list swatches">${colors || "<li>No colours measured.</li>"}</ul></section>
    <section><h3>Spacing</h3><ul class="list">${spacing || "<li>No spacing measured.</li>"}</ul></section>
  </div>
  <h3>Typography</h3>
  ${table(["Size", "Line height", "Weight", "Uses", "Viewports"], scale)}
  <h3>Heading hierarchy</h3>
  ${table(["Level", "Family", "Size", "Weight", "Examples"], headings)}
  <h3>Families</h3><ul class="list">${families || "<li>No families measured.</li>"}</ul>
  <h3>Radii, shadows, backgrounds</h3><ul class="list">${effects || "<li>No effects measured.</li>"}</ul>
  <h3>CSS custom properties</h3><ul class="list">${variables || "<li>No readable custom properties.</li>"}</ul>
  <p class="muted">Measured associations are evidence; semantic roles such as “brand accent” are inferred and need human confirmation.</p>`;
}

function renderComponents(model) {
  const system = model.designSystem;
  if (!system) return `<p class="empty">No design-system export exists for this bundle. Run <code>export-design</code> to generate it.</p>`;
  const components = (system.components ?? []).slice(0, 40).map((component) => [
    `<code>${escapeHtml(component.id)}</code>`,
    escapeHtml(component.tag ?? "—"),
    escapeHtml(component.role ?? "—"),
    escapeHtml(component.count ?? 0),
    escapeHtml((component.viewports ?? []).join(", ")),
    `<code>${escapeHtml(component.measuredStyle?.borderRadius ?? "—")}</code>`,
    escapeHtml((component.textExamples ?? []).join("; ") || "—"),
  ]);
  const layouts = (system.layout?.observedSectionGeometry ?? []).slice(0, 40).map((layout) => [
    escapeHtml(layout.viewport ?? "—"),
    escapeHtml(layout.routePath ?? "—"),
    `<code>${escapeHtml(layout.selector ?? "—")}</code>`,
    escapeHtml(layout.display ?? "—"),
    `<code>${escapeHtml(layout.gridTemplateColumns ?? "—")}</code>`,
    escapeHtml(`${layout.bounds?.width ?? "?"}×${layout.bounds?.height ?? "?"}`),
  ]);
  return `<h3>Reusable components</h3>${table(["Id", "Tag", "Role", "Seen", "Viewports", "Radius", "Examples"], components)}
  <h3>Layout and geometry</h3>${table(["Viewport", "Route", "Selector", "Display", "Columns", "Size"], layouts)}`;
}

function renderGates(model) {
  const machine = model.gates.machine.map((gate) => [escapeHtml(gate.label), badge(gate.status)]);
  const manual = model.gates.manual.map((gate) => [
    escapeHtml(gate.gate),
    badge(gate.status),
    escapeHtml(gate.reason || "—"),
  ]);
  const binding = model.state?.binding ?? null;
  const history = (model.state?.history ?? []).slice(-8).reverse().map((entry) => [
    escapeHtml(entry.at ?? "—"),
    badge(entry.status ?? "—"),
    escapeHtml(entry.reason ?? "—"),
  ]);
  return `<div class="verdict">${badge(model.delivery.status)} <span class="muted">${escapeHtml(model.delivery.note)}</span></div>
  <h3>Machine gates</h3>${table(["Gate", "Result"], machine)}
  <h3>Manual gates</h3>${table(["Gate", "Status", "Reason"], manual)}
  <h3>Evidence binding</h3>
  ${binding ? `<ul class="list">
    <li>Fingerprint <code>${escapeHtml(binding.fingerprint)}</code></li>
    <li>Baseline <code>${escapeHtml(binding.baselineSha256 ?? "not recorded")}</code></li>
    <li>Captured <code>${escapeHtml(binding.capturedAt ?? "—")}</code></li>
    <li>Verification round <code>${escapeHtml(binding.roundGeneratedAt ?? "—")}</code></li>
    <li>Regions bound ${escapeHtml(binding.regions ?? 0)}</li>
  </ul>` : `<p class="empty">No binding recorded.</p>`}
  <h3>Finalization history</h3>${table(["When", "Status", "Reason"], history)}
  <h3>Known limitations</h3><ul class="list">${model.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>None recorded.</li>"}</ul>`;
}

export const DASHBOARD_CSS = `:root{color-scheme:light;--ink:#0f172a;--muted:#5b6478;--line:#dbe1ea;--bg:#f6f7fb;--card:#fff;--accent:#4f46e5;--ok:#0f766e;--warn:#a16207;--bad:#b91c1c;--radius:14px}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f1f3f9;padding:1px 5px;border-radius:5px;word-break:break-word}
h1,h2,h3,h4{line-height:1.25;margin:0 0 .5rem}
h1{font-size:1.6rem}
h2{font-size:1.25rem;margin-top:1.5rem}
h3{font-size:1.05rem;margin-top:1.25rem}
h4{font-size:.95rem;margin:1rem 0 .25rem}
p{margin:.4rem 0}
.topbar{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;justify-content:space-between;padding:1.5rem;background:#fff;border-bottom:1px solid var(--line)}
.eyebrow{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:.7rem;color:var(--muted)}
.meta{margin:.25rem 0 0;color:var(--muted);font-size:.85rem;word-break:break-all}
.tabs{display:flex;flex-wrap:wrap;gap:.4rem;padding:.75rem 1.5rem;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.tab,.view-tab,.chip{font:inherit;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:.35rem .8rem}
.tab[aria-selected="true"],.view-tab[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
main{padding:1.5rem;max-width:1180px;margin:0 auto}
.panel{padding:1rem 0 2rem}
.badge{display:inline-block;padding:.15rem .55rem;border-radius:999px;font-size:.75rem;font-weight:600;letter-spacing:.02em;background:#eef1f7;color:var(--muted)}
.badge-verified,.badge-pass,.badge-captured{background:#dcfce7;color:#166534}
.badge-ready-with-limitations,.badge-review,.badge-awaiting-review,.badge-http-error{background:#fef3c7;color:#92400e}
.badge-failed,.badge-blocked,.badge-fail,.badge-robots-disallowed{background:#fee2e2;color:#991b1b}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin:1rem 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:.8rem}
.stat-label{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.stat-value{display:block;font-size:1.5rem;margin-top:.2rem}
.stat-hint{display:block;font-size:.78rem;color:var(--muted)}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);margin:.5rem 0 1rem}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f8fafc;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
tr:last-child td{border-bottom:none}
.list{margin:.3rem 0 1rem;padding-left:1.1rem}
.list li{margin:.2rem 0}
.muted{color:var(--muted);font-size:.86rem}
.empty{color:var(--muted);font-style:italic}
.grid-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.25rem}
.triple{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.figure img{display:block;width:100%;height:auto;background:#fff}
.figure figcaption{font-size:.78rem;color:var(--muted);padding:.4rem .6rem;border-top:1px solid var(--line)}
.placeholder{display:flex;align-items:center;justify-content:center;min-height:110px;color:var(--muted);font-size:.82rem;background:repeating-linear-gradient(45deg,#f8fafc,#f8fafc 10px,#eef2f7 10px,#eef2f7 20px)}
.view-tabs{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0 1rem}
.regions{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}
.region{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:.8rem}
.swatches{list-style:none;padding-left:0}
.swatches li{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:.35rem 0}
.swatch{width:18px;height:18px;border-radius:5px;border:1px solid var(--line);display:inline-block;flex:0 0 auto}
.swatch-unknown{display:inline-flex;align-items:center;justify-content:center;color:var(--muted);background:#f1f3f9}
.verdict{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:.8rem}
.docs{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.6rem;margin:.5rem 0 1rem}
.doc{display:block;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:.7rem .8rem;text-decoration:none;color:var(--ink)}
.doc span{display:block;font-size:.8rem;color:var(--muted)}
footer{padding:1.5rem;text-align:center;color:var(--muted);font-size:.8rem}
[hidden]{display:none !important}
@media (max-width:640px){.pair{grid-template-columns:1fr}main{padding:1rem}.topbar,.tabs{padding:1rem}}`;

export const DASHBOARD_JS = `(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-panel]"));
  function showTab(name) {
    tabs.forEach(function (tab) { tab.setAttribute("aria-selected", String(tab.getAttribute("data-tab") === name)); });
    panels.forEach(function (panel) { panel.hidden = panel.getAttribute("data-panel") !== name; });
  }
  tabs.forEach(function (tab) { tab.addEventListener("click", function () { showTab(tab.getAttribute("data-tab")); }); });
  if (tabs.length) showTab(tabs[0].getAttribute("data-tab"));

  var views = Array.prototype.slice.call(document.querySelectorAll("[data-view-target]"));
  var viewPanels = Array.prototype.slice.call(document.querySelectorAll("[data-view-panel]"));
  function showView(name) {
    views.forEach(function (view) { view.setAttribute("aria-selected", String(view.getAttribute("data-view-target") === name)); });
    viewPanels.forEach(function (panel) { panel.hidden = panel.getAttribute("data-view-panel") !== name; });
  }
  views.forEach(function (view) { view.addEventListener("click", function () { showView(view.getAttribute("data-view-target")); }); });
  if (views.length) showView(views[0].getAttribute("data-view-target"));
  else viewPanels.forEach(function (panel) { panel.hidden = false; });
}());`;

export function renderDashboard(model) {
  const host = (() => {
    try {
      return new URL(model.sourceUrl).host;
    } catch {
      return model.sourceUrl || "reconstruction";
    }
  })();
  const docs = model.docs.map((doc) => `<a class="doc" href="${escapeHtml(safeLinkHref(doc.file) ?? "#")}">${escapeHtml(doc.label)}<span>${escapeHtml(doc.file)}</span></a>`).join("");
  const evidence = model.evidence.map((item) => `<a class="doc" href="${escapeHtml(safeLinkHref(item.file) ?? "#")}">${escapeHtml(item.label)}<span>${escapeHtml(item.file)}</span></a>`).join("");
  const data = JSON.stringify({
    status: model.delivery.status,
    recordedStatus: model.delivery.recordedStatus,
    stale: model.delivery.stale,
    generatedAt: model.generatedAt,
    sourceUrl: model.sourceUrl,
    cloneUrl: model.cloneUrl,
    captures: model.views.map((view) => ({ name: view.name, viewportName: view.viewportName, routePath: view.routePath })),
    counts: model.metrics,
  }).replace(/</g, "\\u003c");
  const statCards = [
    stat("Delivery status", model.delivery.status, model.delivery.stale ? "evidence changed since finalization" : model.delivery.note),
    stat("Captures", String(model.metrics.captures), `${model.metrics.viewports} viewport profile(s)`),
    stat("Regions", String(model.metrics.regions), "measured section crops"),
    stat("Evidence files", String(model.metrics.artifacts), model.metrics.integrityOk ? "checksums verified" : "integrity not verified"),
    stat("Machine gate", model.metrics.machineGate ?? "—", model.metrics.verdictStatus ? `verdict: ${model.metrics.verdictStatus}` : "not finalized"),
    stat("Routes", model.coverage ? `${model.coverage.captured ?? "?"}/${model.coverage.discovered ?? "?"}` : "not discovered", model.coverage?.truncated ? "coverage truncated" : "captured / discovered"),
  ].join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Reconstruction dashboard — ${escapeHtml(host)}</title>
<link rel="stylesheet" href="assets/dashboard.css">
</head>
<body>
<header class="topbar">
  <div>
    <p class="eyebrow">Reconstruction dashboard</p>
    <h1>${escapeHtml(host)}</h1>
    <p class="meta">Source: ${escapeHtml(model.sourceUrl || "unknown")} · Reconstructed: ${escapeHtml(model.cloneUrl || "not recorded")}</p>
    <p class="meta">Generated ${escapeHtml(model.generatedAt)}</p>
  </div>
  <div>${badge(model.delivery.status)}</div>
</header>
<nav class="tabs" role="tablist" aria-label="Dashboard sections">
  <button type="button" class="tab" data-tab="overview" aria-selected="true">Overview</button>
  <button type="button" class="tab" data-tab="screens" aria-selected="false">Screens</button>
  <button type="button" class="tab" data-tab="design" aria-selected="false">Design system</button>
  <button type="button" class="tab" data-tab="components" aria-selected="false">Components</button>
  <button type="button" class="tab" data-tab="gates" aria-selected="false">Gates and evidence</button>
</nav>
<main>
  <section class="panel" data-panel="overview">
    <h2>Status</h2>
    <div class="stats">${statCards}</div>
    <h2>Route coverage</h2>
    ${renderCoverage(model)}
    ${renderRoutes(model)}
    <h2>Deliverables</h2>
    <div class="docs">${docs}</div>
    <h2>Known limitations</h2>
    <ul class="list">${model.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>None recorded.</li>"}</ul>
  </section>
  <section class="panel" data-panel="screens" hidden>
    <h2>Original versus reconstructed</h2>
    <p class="muted">Choose a capture. Full-page, difference, and region crops come from the frozen verification round.</p>
    ${renderScreens(model)}
  </section>
  <section class="panel" data-panel="design" hidden>
    <h2>Design tokens and typography</h2>
    ${renderDesign(model)}
  </section>
  <section class="panel" data-panel="components" hidden>
    <h2>Components and layouts</h2>
    ${renderComponents(model)}
  </section>
  <section class="panel" data-panel="gates" hidden>
    <h2>Verification gates</h2>
    ${renderGates(model)}
    <h2>Raw evidence</h2>
    <p class="muted">Machine output is kept separate from the reader-facing documents.</p>
    <div class="docs">${evidence}</div>
  </section>
</main>
<footer>Generated by pixel-perfect-clone. Measured values come from frozen browser evidence; inferred roles are labelled.</footer>
<script type="application/json" id="dashboard-data">${data}</script>
<script src="assets/dashboard.js"></script>
</body>
</html>
`;
}
