import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { readJsonIfExists, writeJson } from "./core.mjs";
import { buildDesignSystem, renderDesignTokensCss } from "./design-system.mjs";
import { readManifest, verifyArtifacts } from "./evidence.mjs";
import { buildEvidenceBinding, PROJECT_STATE_FILE, readProjectState, resolveDeliveryStatus } from "./lifecycle.mjs";
import { DASHBOARD_CSS, DASHBOARD_JS, formatPercent, renderDashboard } from "./dashboard.mjs";

/**
 * Reader-facing handoff package. Every value comes from frozen evidence or the
 * recorded verdict; nothing here guesses a measurement. Machine output is
 * copied into a separate `evidence/` directory so the documents stay readable
 * without hiding their source.
 */
export const HANDOFF_DOCUMENTS = [
  { file: "START-HERE.md", label: "Start here", purpose: "What this package is and where to look first." },
  { file: "COMPLETION-REPORT.md", label: "Completion report", purpose: "Authoritative status, gates, and finalization history." },
  { file: "REBUILD-GUIDE.md", label: "Rebuild guide", purpose: "How to run the reconstruction and re-verify it." },
  { file: "KNOWN-LIMITATIONS.md", label: "Known limitations", purpose: "Recorded warnings, unresolved gates, and scope notes." },
  { file: "SITE-MAP.md", label: "Site map", purpose: "Discovered routes and coverage." },
  { file: "PAGE-BLUEPRINTS.md", label: "Page blueprints", purpose: "Measured structure of every captured page." },
  { file: "INTERACTIONS.md", label: "Interactions", purpose: "Observed interactive states." },
  { file: "DESIGN-GUIDE.md", label: "Design guide", purpose: "Measured colour, type, spacing, and depth." },
  { file: "COMPONENTS.md", label: "Components", purpose: "Reusable component signatures and layouts." },
  { file: "RESPONSIVE-RULES.md", label: "Responsive rules", purpose: "Breakpoints and observed layout transitions." },
];

const RAW_EVIDENCE = [
  { from: "evidence/manifest.json", to: "evidence/manifest.json", label: "Frozen manifest" },
  { from: "evidence/manifest.sha256", to: "evidence/manifest.sha256", label: "Manifest checksum" },
  { from: "verification/fidelity-report.json", to: "evidence/fidelity-report.json", label: "Fidelity report (JSON)" },
  { from: "verification/fidelity-report.md", to: "evidence/fidelity-report.md", label: "Fidelity report (Markdown)" },
  { from: "verification/triage.json", to: "evidence/triage.json", label: "Triage (JSON)" },
  { from: "verification/final-verdict.json", to: "evidence/final-verdict.json", label: "Final verdict" },
  { from: PROJECT_STATE_FILE, to: "evidence/project-state.json", label: "Project state" },
  { from: "evidence/tokens.json", to: "evidence/tokens.json", label: "Measured tokens" },
  { from: "design-system/design-system.json", to: "evidence/design-system.json", label: "Design system (JSON)" },
];

const TICK = "`";

const mdCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const code = (value) => TICK + mdCell(value) + TICK;
const listOrNone = (values, render = String, none = "_None recorded._") => (values?.length ? values.map((value) => `- ${render(value)}`).join("\n") : none);

function mdTable(headers, rows) {
  if (!rows.length) return "_None recorded._";
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  return [header, divider, ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`)].join("\n");
}

async function readFileIfExists(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function tokensCssFromTokens(tokens) {
  const lines = [];
  const usable = (value) => typeof value === "string" && value.trim() && !/[<>{};\n]/.test(value);
  const add = (prefix, values = []) => values.forEach((entry, index) => {
    if (usable(entry?.value)) lines.push(`  --pp-${prefix}-${String(index + 1).padStart(2, "0")}: ${entry.value.trim()};`);
  });
  for (const [name, value] of Object.entries(tokens?.cssVariables ?? {})) {
    if (/^--[A-Za-z0-9_-]+$/.test(name) && usable(value)) lines.push(`  ${name}: ${value.trim()};`);
  }
  add("color", tokens?.colors);
  add("space", tokens?.spacing);
  add("radius", tokens?.radii);
  add("shadow", tokens?.shadows);
  add("font-size", tokens?.typography?.sizes);
  return `/* Measured values from the frozen token export. Confirm provenance before production use. */\n:root {\n${lines.join("\n")}\n}\n`;
}

export async function loadHandoffContext(sourceDir) {
  const manifest = await readManifest(sourceDir);
  const integrity = await verifyArtifacts(sourceDir, manifest);
  const [report, triage, verdict, state, tokens, designSystemFile, routes, coverage, sectionsReport, assets] = await Promise.all([
    readJsonIfExists(join(sourceDir, "verification", "fidelity-report.json")),
    readJsonIfExists(join(sourceDir, "verification", "triage.json")),
    readJsonIfExists(join(sourceDir, "verification", "final-verdict.json")),
    readProjectState(sourceDir),
    readJsonIfExists(join(sourceDir, "evidence", "tokens.json")),
    readJsonIfExists(join(sourceDir, "design-system", "design-system.json")),
    readJsonIfExists(join(sourceDir, "discovery", "routes.json")),
    readJsonIfExists(join(sourceDir, "discovery", "route-coverage.json")),
    readJsonIfExists(join(sourceDir, "verification", "sections", "sections-report.json")),
    readJsonIfExists(join(sourceDir, "evidence", "assets.json")),
  ]);

  const views = [];
  for (const viewport of manifest.viewports ?? []) {
    const name = viewport?.name;
    if (!name) continue;
    const observation = await readJsonIfExists(join(sourceDir, "evidence", `observation-${name}.json`));
    const sectionSummary = await readJsonIfExists(join(sourceDir, "evidence", `sections-${name}.json`));
    const states = await readJsonIfExists(join(sourceDir, "evidence", `states-${name}.json`));
    const result = (report?.viewports ?? []).find((entry) => entry.viewport === name) ?? null;
    const sectionResults = new Map(((sectionsReport?.viewports ?? []).find((entry) => entry.viewport === name)?.sections ?? []).map((entry) => [entry.name, entry]));
    views.push({
      name,
      viewportName: viewport.viewportName ?? name,
      routeId: viewport.routeId ?? null,
      routePath: viewport.routePath ?? null,
      width: viewport.viewport?.width ?? null,
      height: viewport.viewport?.height ?? null,
      title: observation?.title ?? "",
      captureStatus: viewport.captureStatus ?? null,
      observation,
      sectionSummary,
      states: Array.isArray(states) ? states : [],
      result,
      sectionResults,
      sections: Array.isArray(sectionSummary?.sections) ? sectionSummary.sections : [],
    });
  }

  const observations = Object.fromEntries(views
    .filter((view) => view.observation)
    .map((view) => [view.name, { ...view.observation, routeId: view.routeId, routePath: view.routePath, viewportName: view.viewportName }]));
  const designSystem = designSystemFile ?? (Object.keys(observations).length ? buildDesignSystem(observations) : null);
  const tokensCss = designSystem ? renderDesignTokensCss(designSystem) : tokensCssFromTokens(tokens);

  return {
    sourceDir,
    manifest,
    integrity,
    report,
    triage,
    verdict,
    state,
    tokens,
    designSystem,
    tokensCss,
    routes,
    coverage,
    sectionsReport,
    assets,
    views,
  };
}

function assetPairs(context) {
  const pairs = [];
  for (const view of context.views) {
    pairs.push({ from: `source/screenshots/${view.name}.png`, to: `screenshots/original/${view.name}.png` });
    pairs.push({ from: `verification/clone/${view.name}.png`, to: `screenshots/reconstructed/${view.name}.png` });
    pairs.push({ from: `verification/diffs/${view.name}.png`, to: `screenshots/diff/${view.name}.png` });
    for (const section of view.sections) {
      const slug = section?.slug;
      if (typeof slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug)) continue;
      pairs.push({ from: `source/sections/${view.name}/${slug}.png`, to: `screenshots/regions/${view.name}/${slug}-source.png` });
      pairs.push({ from: `verification/clone/sections/${view.name}/${slug}.png`, to: `screenshots/regions/${view.name}/${slug}-clone.png` });
    }
  }
  return pairs;
}

async function copyEvidenceAssets(context, target) {
  const copied = new Set();
  for (const pair of assetPairs(context)) {
    const buffer = await readFileIfExists(join(context.sourceDir, pair.from));
    if (!buffer) continue;
    await writeFile(join(target, pair.to), buffer);
    copied.add(pair.to);
  }
  return copied;
}

async function copyRawEvidence(context, target) {
  const copied = [];
  for (const entry of RAW_EVIDENCE) {
    const buffer = await readFileIfExists(join(context.sourceDir, entry.from));
    if (!buffer) continue;
    await writeFile(join(target, entry.to), buffer);
    copied.push({ label: entry.label, file: entry.to });
  }
  return copied;
}

function derivedRoutes(context) {
  if (context.routes?.routes?.length) return context.routes.routes;
  const seen = new Map();
  for (const view of context.views) {
    if (!view.routePath || seen.has(view.routePath)) continue;
    seen.set(view.routePath, { routePath: view.routePath, title: view.title, discoveryStatus: "captured", status: null, depth: null, templateId: null });
  }
  return [...seen.values()];
}

function collectLimitations(context) {
  const items = [];
  for (const warning of context.manifest?.warnings ?? []) items.push(String(warning));
  for (const limitation of context.verdict?.limitations ?? []) items.push(String(limitation));
  for (const [gate, status] of Object.entries(context.verdict?.manualGates ?? {})) {
    if (status !== "pass" && status !== "not_applicable") items.push(`Manual gate "${gate}" is ${status}.`);
  }
  if (!context.report) items.push("No verification round has been recorded for this bundle.");
  if (context.report && !context.verdict) items.push("The verification round has not been finalized.");
  if (!context.integrity.ok) items.push(`Frozen evidence integrity failed: ${context.integrity.message}`);
  if (!context.routes) items.push("Route discovery was not run for this bundle; route coverage is unknown.");
  if (context.coverage?.truncated) items.push("Route discovery was truncated by configured limits, so coverage is incomplete.");
  if (!context.designSystem) items.push("No design-system export was available.");
  return [...new Set(items)];
}

export function buildHandoffModel({ context, copied, rawEvidence }) {
  const binding = buildEvidenceBinding({
    manifest: context.manifest,
    manifestSha256: context.integrity?.manifestIntegrity?.sha256 ?? null,
    report: context.report,
  });
  const delivery = resolveDeliveryStatus({ state: context.state, currentFingerprint: binding.fingerprint });
  const limitations = collectLimitations(context);
  const views = context.views.map((view) => ({
    name: view.name,
    viewportName: view.viewportName,
    routeId: view.routeId,
    routePath: view.routePath,
    width: view.width,
    height: view.height,
    title: view.title,
    captureStatus: view.captureStatus,
    observation: view.observation,
    states: view.states,
    result: view.result,
    sections: view.sections,
    images: {
      source: copied.has(`screenshots/original/${view.name}.png`) ? `screenshots/original/${view.name}.png` : null,
      clone: copied.has(`screenshots/reconstructed/${view.name}.png`) ? `screenshots/reconstructed/${view.name}.png` : null,
      diff: copied.has(`screenshots/diff/${view.name}.png`) ? `screenshots/diff/${view.name}.png` : null,
    },
    regions: view.sections.map((section) => {
      const slug = section?.slug;
      const result = view.sectionResults.get(slug) ?? null;
      const sourceImage = `screenshots/regions/${view.name}/${slug}-source.png`;
      const cloneImage = `screenshots/regions/${view.name}/${slug}-clone.png`;
      return {
        slug,
        text: section?.text ?? "",
        role: section?.role ?? "",
        selector: section?.selector ?? "",
        width: section?.documentRect?.width ?? null,
        height: section?.documentRect?.height ?? null,
        bytes: section?.bytes ?? null,
        captureStatus: section?.captureStatus ?? null,
        result: result?.result ?? null,
        changeRatio: result?.changeRatio ?? null,
        dimensionMismatch: Boolean(result?.dimensionMismatch),
        sourceImage: copied.has(sourceImage) ? sourceImage : null,
        cloneImage: copied.has(cloneImage) ? cloneImage : null,
      };
    }),
  }));
  const viewportNames = [...new Set(views.map((view) => view.viewportName))];
  return {
    generatedAt: new Date().toISOString(),
    sourceUrl: context.manifest?.sourceUrl ?? null,
    cloneUrl: context.report?.cloneUrl ?? context.state?.cloneUrl ?? null,
    manifestSha256: context.integrity?.manifestIntegrity?.sha256 ?? null,
    integrity: context.integrity,
    delivery,
    binding,
    state: context.state,
    manifest: context.manifest,
    report: context.report,
    verdict: context.verdict,
    triage: context.triage,
    tokens: context.tokens,
    tokensCss: context.tokensCss,
    designSystem: context.designSystem,
    coverage: context.coverage,
    routes: derivedRoutes(context),
    views,
    limitations,
    docs: HANDOFF_DOCUMENTS.map(({ file, label }) => ({ file, label })),
    evidence: rawEvidence,
    metrics: {
      captures: views.length,
      viewports: viewportNames.length,
      regions: views.reduce((total, view) => total + view.sections.length, 0),
      artifacts: context.manifest?.artifacts?.length ?? 0,
      integrityOk: Boolean(context.integrity?.ok),
      machineGate: context.report?.machineGate ?? null,
      verdictStatus: context.verdict?.status ?? null,
    },
    gates: {
      machine: [
        { label: "Full-page visual", status: context.report?.visualGate ?? "not run" },
        { label: "Section visual", status: context.report?.sectionGate ?? "not run" },
        { label: "Geometry", status: context.report?.geometryGate ?? "not run" },
        { label: "Overall machine", status: context.report?.machineGate ?? "not run" },
        { label: "Evidence integrity", status: context.integrity?.ok ? "pass" : "fail" },
      ],
      manual: Object.entries(context.verdict?.manualGates ?? {}).map(([gate, status]) => ({
        gate,
        status,
        reason: context.verdict?.gateReasons?.[gate] ?? "",
      })),
    },
  };
}

function hostOf(model) {
  try {
    return new URL(model.sourceUrl).host;
  } catch {
    return model.sourceUrl || "reconstruction";
  }
}

function renderStartHere(model) {
  const recorded = model.delivery.recordedStatus !== model.delivery.status ? ` (recorded finalization: ${model.delivery.recordedStatus})` : "";
  const lines = [
    `# Reconstruction handoff — ${hostOf(model)}`,
    "",
    `**Delivery status: ${model.delivery.status}**${recorded}`,
    "",
    model.delivery.note,
    "",
    `- Source: ${model.sourceUrl ?? "unknown"}`,
    `- Reconstruction: ${model.cloneUrl ?? "not recorded"}`,
    `- Generated: ${model.generatedAt}`,
    `- Frozen manifest checksum: ${model.manifestSha256 ? code(model.manifestSha256) : "not recorded"}`,
    "",
    "## Start with the dashboard",
    "",
    `Open ${code("index.html")} in any modern browser. It loads from your filesystem with no server, network request, or paid service. Use the Screens tab to compare original and reconstructed captures, and the Gates and evidence tab for the authoritative status.`,
    "",
    "## Documents",
    "",
    mdTable(["Document", "Purpose"], HANDOFF_DOCUMENTS.map((doc) => [code(doc.file), doc.purpose])),
    "",
    "## What is in this package",
    "",
    `- Measured design tokens: ${code("tokens.json")} and ${code("tokens.css")}.`,
    "- Full-page original, reconstructed, and difference screenshots, plus region crops.",
    "- Reader-facing documentation generated from the frozen evidence.",
    `- Raw machine output in ${code("evidence/")}, kept separate from these documents.`,
    "",
    "## What is not in this package",
    "",
    `- The reconstructed project's source code. ${code("REBUILD-GUIDE.md")} explains how to run it and re-verify it.`,
    "- Any page, viewport, interaction, or state that was never captured. Absence of a measurement is not evidence that a thing does not exist.",
    "",
  ];
  return lines.join("\n");
}

function renderCompletionReport(model) {
  const coverage = model.coverage;
  const state = model.state;
  const history = (state?.history ?? []).slice().reverse().slice(0, 12).map((entry) => [entry.at ?? "—", entry.status ?? "—", entry.reason ?? "—"]);
  const machine = model.gates.machine.map((gate) => [gate.label, gate.status]);
  const manual = model.gates.manual.map((gate) => [gate.gate, gate.status, gate.reason || "—"]);
  const coverageRows = [
    ["Captures", model.metrics.captures],
    ["Viewport profiles", model.metrics.viewports],
    ["Measured regions", model.metrics.regions],
    ["Checksummed evidence files", model.metrics.artifacts],
    ["Routes discovered", coverage?.discovered ?? "not discovered"],
    ["Routes captured", coverage?.captured ?? "—"],
    ["Coverage truncated", coverage ? (coverage.truncated ? "yes" : "no") : "unknown"],
  ];
  const verdictLine = model.verdict ? `${model.verdict.status} — ${model.verdict.conclusion}` : "not finalized";
  const lines = [
    "# Completion report",
    "",
    `- **Delivery status:** ${model.delivery.status}`,
    `- **Recorded finalization:** ${state?.status ?? "none"}${state?.updatedAt ? ` at ${state.updatedAt}` : ""}`,
    `- **Final verdict:** ${verdictLine}`,
    `- **Evidence integrity:** ${model.integrity?.ok ? "verified" : "not verified"}${model.integrity?.message ? ` (${model.integrity.message})` : ""}`,
    `- **Machine gate:** ${model.report?.machineGate ?? "not run"}`,
    `- **Binding fingerprint:** ${code(model.binding.fingerprint)}`,
    `- **Bound baseline:** ${model.binding.baselineSha256 ? code(model.binding.baselineSha256) : "not recorded"}`,
    `- **Verification round:** ${model.binding.roundGeneratedAt ?? "not recorded"}`,
    "",
    "## Coverage",
    "",
    mdTable(["Measure", "Value"], coverageRows),
    "",
    "## Machine gates",
    "",
    mdTable(["Gate", "Result"], machine),
    "",
    "## Manual gates",
    "",
    mdTable(["Gate", "Status", "Reason"], manual),
    "",
    "## Finalization history",
    "",
    mdTable(["When", "Status", "Reason"], history),
    "",
    "## Reading this report",
    "",
    "The delivery status is the recorded finalization for this exact baseline and verification round. If the evidence bundle or the round changes, the status is demoted and this report is regenerated rather than silently reused.",
    "",
  ];
  return lines.join("\n");
}

function renderRebuildGuide(model) {
  const cloneUrl = model.cloneUrl ?? "http://localhost:3000";
  const commands = [
    "npx playwright install chromium",
    "node scripts/pixel-perfect-clone.mjs evidence-check --source .clone",
    `node scripts/pixel-perfect-clone.mjs verify --source .clone --clone-url ${cloneUrl}`,
    "node scripts/pixel-perfect-clone.mjs finalize --source .clone",
    "node scripts/pixel-perfect-clone.mjs handoff --source .clone",
  ];
  const lines = [
    "# Rebuild guide",
    "",
    "## Prerequisites",
    "",
    "- Node.js 20 or newer and npm.",
    `- Chromium for Playwright: ${code("npx playwright install chromium")}.`,
    "",
    "## Run the reconstruction",
    "",
    `The reconstructed application for this package was measured at ${code(cloneUrl)}. Start it the way its own project documents, then point verification at the running URL:`,
    "",
    "```bash",
    commands[2],
    "```",
    "",
    "## Re-verify the frozen baseline",
    "",
    "```bash",
    ...commands.slice(1),
    "```",
    "",
    "Verification compares the frozen source evidence against a fresh capture of the reconstruction at every captured route and viewport. A round is scored only on its own capture: stale crops from an earlier round are discarded, not counted.",
    "",
    "## Apply the measured tokens",
    "",
    `${code("tokens.css")} in this package contains measured custom properties. Import it or copy the declarations into the reconstruction's global stylesheet, then confirm each value against the design guide before production use.`,
    "",
    "## Rebuild the layout",
    "",
    `1. Read ${code("DESIGN-GUIDE.md")} for measured colour, type, spacing, and depth.`,
    `2. Read ${code("COMPONENTS.md")} for reusable signatures and their measured styles.`,
    `3. Read ${code("RESPONSIVE-RULES.md")} for declared breakpoints and transitions observed between the captured widths.`,
    `4. Read ${code("PAGE-BLUEPRINTS.md")} for each page's measured region structure.`,
    "5. Re-run verification after each correction round; work the highest-priority triage item first.",
    "",
    "## Preview this handoff",
    "",
    `Open ${code("index.html")} directly. The dashboard is static and offline-capable; screenshots and links resolve inside this directory.`,
    "",
  ];
  return lines.join("\n");
}

function renderKnownLimitations(model) {
  const warnings = model.manifest?.warnings ?? [];
  const scopeNotes = [
    "Only captured routes, viewports, and interaction states are evidenced; anything not captured is unverified rather than absent.",
    "Discovery is passive and unauthenticated: it reads navigation links, robots rules, and sitemaps, and it collapses query strings.",
    "Repeated pixel samples detect visible instability; they cannot prove that timers, live data, video, or backend state are deterministic.",
    "Region identity is content-derived, so a reconstruction that renames every heading can only be compared positionally.",
    "Checksums prove the evidence bundle is unchanged; they do not prove lawful use of any asset or text.",
  ];
  const unresolved = model.gates.manual
    .filter((gate) => !["pass", "not_applicable"].includes(gate.status))
    .map((gate) => `**${gate.gate}**: ${gate.status}`);
  const lines = [
    "# Known limitations",
    "",
    "## Evidence warnings",
    "",
    listOrNone(warnings, (warning) => mdCell(warning), "_No capture warnings were recorded._"),
    "",
    "## Finalization limitations",
    "",
    listOrNone(model.verdict?.limitations, (item) => mdCell(item), "_No limitations were recorded in the final verdict._"),
    "",
    "## Unresolved or blocked gates",
    "",
    listOrNone(unresolved, String, "_Every recorded manual gate passed or was documented as not applicable._"),
    "",
    "## Delivery scope notes",
    "",
    listOrNone(scopeNotes, String),
    "",
  ];
  return lines.join("\n");
}

function renderSiteMap(model) {
  const coverage = model.coverage;
  const routeRows = model.routes.map((route) => [
    route.routePath ?? "—",
    route.title || "—",
    route.discoveryStatus ?? "—",
    route.status ?? "—",
    route.depth ?? "—",
    route.templateId ?? "—",
  ]);
  const missing = (coverage?.missingPages ?? []).map((page) => {
    const http = page.status ? ` (HTTP ${page.status})` : "";
    return `- ${code(page.url)} — ${page.discoveryStatus ?? "unknown"}${http}`;
  });
  const lines = [
    "# Site map",
    "",
    `- Source: ${model.sourceUrl ?? "unknown"}`,
    `- Discovery scope: ${code(coverage?.sourceUrl ?? model.sourceUrl ?? "unknown")}`,
    `- Routes discovered: ${coverage?.discovered ?? "not discovered"}`,
    `- Routes captured: ${coverage?.captured ?? "—"}`,
    `- Coverage truncated: ${coverage ? (coverage.truncated ? "yes" : "no") : "unknown"}`,
  ];
  if (coverage?.relationships !== undefined) lines.push(`- Navigation relationships: ${coverage.relationships}`);
  lines.push("", "## Routes", "", mdTable(["Path", "Title", "Discovery", "HTTP", "Depth", "Template"], routeRows), "", "## Routes not captured", "", missing.length ? missing.join("\n") : "_None recorded._", "");
  if (!coverage) lines.push("Discovery was not run for this bundle, so routes are listed from the captured manifest only.", "");
  return lines.join("\n");
}

function renderPageBlueprints(model) {
  if (!model.views.length) return "# Page blueprints\n\n_No captures were recorded._\n";
  const blocks = model.views.map((view) => {
    const headings = view.observation?.headings ?? [];
    const regions = view.regions.map((region, index) => [
      index,
      region.slug ?? "—",
      region.role || "—",
      `${region.width ?? "?"}×${region.height ?? "?"}`,
      region.result ?? "not compared",
      region.changeRatio === null || region.changeRatio === undefined ? "—" : formatPercent(region.changeRatio),
      (region.text ?? "").slice(0, 70) || "—",
    ]);
    const headingText = headings.length ? headings.map((heading) => mdCell(heading)).join(" · ") : "_none captured_";
    return [
      `## ${mdCell(view.routePath ?? view.viewportName)} — ${mdCell(view.viewportName)} (${view.width ?? "?"}×${view.height ?? "?"})`,
      "",
      `Title: ${mdCell(view.title || "not captured")}`,
      "",
      `Headings: ${headingText}`,
      "",
      mdTable(["#", "Region", "Role", "Size", "Result", "Changed", "Text"], regions),
    ].join("\n");
  });
  return ["# Page blueprints", "", "Measured structure per captured route and viewport. Sizes are clamped document rectangles of the region crops stored in the evidence bundle.", "", ...blocks, ""].join("\n");
}

function renderInteractions(model) {
  const phases = ["base", "focus", "hover", "active"];
  const blocks = model.views.filter((view) => view.states.length).map((view) => {
    const items = view.states.map((state) => {
      const properties = new Set();
      for (const phase of phases) for (const key of Object.keys(state[phase] ?? {})) properties.add(key);
      const changed = [...properties].filter((key) => new Set(phases.map((phase) => state[phase]?.[key])).size > 1);
      const rows = changed.slice(0, 12).map((key) => [key, ...phases.map((phase) => state[phase]?.[key] ?? "—")]);
      const role = state.role ? ` (${mdCell(state.role)})` : "";
      return [`### ${mdCell(state.tag ?? "element")} — ${mdCell(state.text || "(no text)")}${role}`, "", mdTable(["Property", ...phases], rows)].join("\n");
    });
    return [`## ${mdCell(view.routePath ?? view.viewportName)} — ${mdCell(view.viewportName)}`, "", ...items].join("\n\n");
  });
  const body = blocks.length ? blocks.join("\n\n") : "_No interaction states were captured._";
  return ["# Interactions", "", "Observed interaction states from the frozen evidence. Capture prevents navigation, submission, and destructive activation; only visual state changes are recorded.", "", body, ""].join("\n");
}

function renderDesignGuide(model) {
  const tokens = model.tokens;
  const system = model.designSystem;
  if (!tokens) return "# Design guide\n\n_No measured tokens were captured._\n";
  const colors = (tokens.colors ?? []).slice(0, 30).map((entry) => [code(entry.value), entry.count, (entry.viewports ?? []).join(", ")]);
  const scale = (tokens.typography?.scale ?? []).slice(0, 24).map((entry) => [`${code(entry.fontSize)} / ${code(entry.lineHeight)} / ${code(entry.fontWeight)}`, entry.count, (entry.viewports ?? []).join(", ")]);
  const families = (tokens.typography?.families ?? []).map((entry) => `${code(entry.value)} ×${entry.count}`);
  const spacing = (tokens.spacing ?? []).slice(0, 24).map((entry) => `${code(entry.value)} ×${entry.count}`);
  const radii = (tokens.radii ?? []).slice(0, 12).map((entry) => `radius ${code(entry.value)} ×${entry.count}`);
  const shadows = (tokens.shadows ?? []).slice(0, 12).map((entry) => `shadow ${code(entry.value)} ×${entry.count}`);
  const variables = Object.entries(tokens.cssVariables ?? {}).slice(0, 40).map(([name, value]) => `${code(name)}: ${code(value)}`);
  const headings = (system?.typography?.headingHierarchy ?? []).map((entry) => [entry.level, entry.fontFamily ?? "—", entry.fontSize ?? "—", entry.fontWeight ?? "—", (entry.examples ?? []).join("; ") || "—"]);
  const accents = system?.colors?.frequentlyUsedAccents ?? [];
  const lines = [
    "# Design guide",
    "",
    `Measured from computed styles across ${model.metrics.captures} capture(s) at ${model.metrics.viewports} viewport profile(s). Values are evidence, not framework defaults.`,
    "",
    "## Colour",
    "",
    mdTable(["Value", "Uses", "Viewports"], colors),
    "",
    `Frequently used accents (inferred role — confirm before reuse): ${accents.length ? accents.map((value) => code(value)).join(", ") : "_none inferred_"}`,
    "",
    `Page backgrounds: ${(system?.colors?.pageBackgrounds ?? []).map((value) => code(value)).join(", ") || "_none measured_"}`,
    "",
    "## Typography",
    "",
    mdTable(["Size / line-height / weight", "Uses", "Viewports"], scale),
    "",
    `Families: ${families.join(", ") || "_none measured_"}`,
    "",
    "### Heading hierarchy",
    "",
    mdTable(["Level", "Family", "Size", "Weight", "Examples"], headings),
    "",
    "## Spacing",
    "",
    listOrNone(spacing),
    "",
    "## Radii, shadows, borders",
    "",
    listOrNone([...radii, ...shadows]),
    "",
    "## CSS custom properties",
    "",
    listOrNone(variables, String, "_No readable custom properties._"),
    "",
    "## Tokens",
    "",
    `- ${code("tokens.json")} — full measured export with provenance.`,
    `- ${code("tokens.css")} — custom properties generated from the measured tokens.`,
    "",
  ];
  return lines.join("\n");
}

function renderComponents(model) {
  const system = model.designSystem;
  if (!system) return "# Components\n\n_No design-system export exists for this bundle._\n";
  const components = (system.components ?? []).map((component) => [
    component.id,
    component.tag,
    component.role ?? "—",
    component.count,
    (component.viewports ?? []).join(", "),
    component.measuredStyle?.borderRadius ?? "—",
    component.measuredStyle?.padding ?? "—",
    (component.textExamples ?? []).join("; ") || "—",
  ]);
  const layouts = (system.layout?.observedSectionGeometry ?? []).slice(0, 60).map((layout) => [
    layout.viewport ?? "—",
    layout.routePath ?? "—",
    layout.selector ?? "—",
    layout.display ?? "—",
    layout.gridTemplateColumns ?? "—",
    `${layout.bounds?.width ?? "?"}×${layout.bounds?.height ?? "?"}`,
  ]);
  const lines = [
    "# Components",
    "",
    "Component grouping is inferred from repeated structural signatures; the measured styles beside each group are evidence.",
    "",
    "## Reusable signatures",
    "",
    mdTable(["Id", "Tag", "Role", "Seen", "Viewports", "Radius", "Padding", "Examples"], components),
    "",
    "## Layout and geometry",
    "",
    mdTable(["Viewport", "Route", "Selector", "Display", "Columns", "Size"], layouts),
    "",
    "## Max-width containers",
    "",
    listOrNone(system.layout?.maxWidths ?? [], (value) => code(value), "_No max-width measurements._"),
    "",
  ];
  return lines.join("\n");
}

function renderResponsiveRules(model) {
  const tokens = model.tokens;
  const system = model.designSystem;
  if (!tokens) return "# Responsive rules\n\n_No measured tokens were captured._\n";
  const viewportRows = [];
  for (const capture of tokens.captures ?? []) {
    if (viewportRows.some((row) => row[0] === capture.viewportName)) continue;
    viewportRows.push([capture.viewportName, capture.width ?? "—", capture.height ?? "—"]);
  }
  const queries = (tokens.breakpoints?.mediaQueries ?? []).map((query) => [query.condition, query.minWidth ?? "—", query.maxWidth ?? "—", (query.viewports ?? []).join(", ")]);
  const transitions = (tokens.breakpoints?.observedTransitions ?? []).slice(0, 60).map((entry) => [
    entry.routeId ?? "—",
    entry.section ?? "—",
    entry.property,
    (entry.values ?? []).map((value) => `${value.viewport}=${value.value}`).join(" → "),
  ]);
  const layouts = (system?.layout?.observedSectionGeometry ?? []).slice(0, 60).map((layout) => [
    layout.routePath ?? "—",
    layout.viewport ?? "—",
    layout.selector ?? "—",
    layout.display ?? "—",
    layout.gridTemplateColumns ?? "—",
    layout.gap ?? "—",
  ]);
  const lines = [
    "# Responsive rules",
    "",
    "Declared media queries and transitions observed between the captured widths. A width that was never captured is still unmeasured.",
    "",
    "## Captured viewports",
    "",
    mdTable(["Profile", "Width", "Height"], viewportRows),
    "",
    "## Declared media queries",
    "",
    mdTable(["Condition", "Min width", "Max width", "Observed at"], queries),
    "",
    "## Observed transitions",
    "",
    mdTable(["Route", "Region", "Property", "Values"], transitions),
    "",
    "## Layout by route and viewport",
    "",
    mdTable(["Route", "Viewport", "Selector", "Display", "Columns", "Gap"], layouts),
    "",
  ];
  return lines.join("\n");
}

const RENDERERS = {
  "START-HERE.md": renderStartHere,
  "COMPLETION-REPORT.md": renderCompletionReport,
  "REBUILD-GUIDE.md": renderRebuildGuide,
  "KNOWN-LIMITATIONS.md": renderKnownLimitations,
  "SITE-MAP.md": renderSiteMap,
  "PAGE-BLUEPRINTS.md": renderPageBlueprints,
  "INTERACTIONS.md": renderInteractions,
  "DESIGN-GUIDE.md": renderDesignGuide,
  "COMPONENTS.md": renderComponents,
  "RESPONSIVE-RULES.md": renderResponsiveRules,
};

/** Generate the reader-facing package plus the dashboard next to the evidence. */
export async function generateHandoff({ sourceDir, out = null }) {
  const root = resolve(sourceDir);
  const target = resolve(out ?? join(root, "handoff"));
  const guarded = target.endsWith(sep) ? target : `${target}${sep}`;
  if (target === root || root.startsWith(guarded)) throw new Error(`Unsafe handoff output directory: ${target}`);
  const context = await loadHandoffContext(root);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const copied = await copyEvidenceAssets(context, target);
  const rawEvidence = await copyRawEvidence(context, target);
  const model = buildHandoffModel({ context, copied, rawEvidence });
  await mkdir(join(target, "assets"), { recursive: true });
  await writeFile(join(target, "assets", "dashboard.css"), DASHBOARD_CSS);
  await writeFile(join(target, "assets", "dashboard.js"), DASHBOARD_JS);
  await writeFile(join(target, "index.html"), renderDashboard(model));
  for (const doc of HANDOFF_DOCUMENTS) {
    await writeFile(join(target, doc.file), RENDERERS[doc.file](model));
  }
  if (model.tokens) await writeJson(join(target, "tokens.json"), model.tokens);
  await writeFile(join(target, "tokens.css"), model.tokensCss);
  return {
    out: target,
    status: model.delivery.status,
    recordedStatus: model.delivery.recordedStatus,
    stale: model.delivery.stale,
    documents: HANDOFF_DOCUMENTS.map((doc) => doc.file),
    dashboard: join(target, "index.html"),
    screenshots: copied.size,
    evidence: rawEvidence.map((entry) => entry.file),
  };
}
