import { safeName, shortHash } from "./core.mjs";
import { extractTokens } from "./tokens.mjs";

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function measuredLayouts(observations) {
  const layouts = [];
  for (const [viewport, observation] of Object.entries(observations)) {
    for (const section of observation?.sections ?? []) {
      const style = section.style ?? {};
      layouts.push({
        capture: viewport,
        viewport: observation?.viewportName ?? viewport,
        routeId: observation?.routeId ?? null,
        routePath: observation?.routePath ?? null,
        selector: section.selector,
        role: section.role,
        display: style.display ?? null,
        width: style.width ?? null,
        maxWidth: style.maxWidth ?? null,
        gridTemplateColumns: style.gridTemplateColumns ?? null,
        gridTemplateRows: style.gridTemplateRows ?? null,
        flexDirection: style.flexDirection ?? null,
        gap: style.gap ?? null,
        alignItems: style.alignItems ?? null,
        justifyContent: style.justifyContent ?? null,
        bounds: section.rect ?? null,
      });
    }
  }
  return layouts;
}

function componentInventory(observations) {
  const components = new Map();
  for (const [viewport, observation] of Object.entries(observations)) {
    const elements = [...(observation?.interactive ?? []), ...(observation?.sections ?? [])];
    for (const element of elements) {
      const style = element.style ?? {};
      const tag = element.tag ?? "unknown";
      const role = element.role ?? null;
      const signature = JSON.stringify({ tag, role, classes: [...(element.classes ?? [])].sort(), display: style.display, borderRadius: style.borderRadius, padding: style.padding, gap: style.gap });
      const item = components.get(signature) ?? {
        id: `component-${safeName(`${tag}-${role ?? "ui"}-${style.borderRadius ?? "flat"}`).toLowerCase()}-${shortHash(signature, 8)}`,
        tag,
        role,
        selector: element.selector ?? null,
        classes: element.classes ?? [],
        count: 0,
        viewports: [],
        routes: [],
        captures: [],
        textExamples: [],
        measuredStyle: {
          display: style.display ?? null,
          color: style.color ?? null,
          backgroundColor: style.backgroundColor ?? null,
          border: style.border ?? null,
          borderRadius: style.borderRadius ?? null,
          boxShadow: style.boxShadow ?? null,
          padding: style.padding ?? null,
          gap: style.gap ?? null,
          fontFamily: style.fontFamily ?? null,
          fontSize: style.fontSize ?? null,
          fontWeight: style.fontWeight ?? null,
        },
      };
      item.count += 1;
      const viewportName = observation?.viewportName ?? viewport;
      if (!item.viewports.includes(viewportName)) item.viewports.push(viewportName);
      if (observation?.routeId && !item.routes.includes(observation.routeId)) item.routes.push(observation.routeId);
      if (!item.captures.includes(viewport)) item.captures.push(viewport);
      if (element.text && item.textExamples.length < 3 && !item.textExamples.includes(element.text)) item.textExamples.push(element.text);
      components.set(signature, item);
    }
  }
  return [...components.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function headingHierarchy(observations) {
  const values = new Map();
  for (const [viewport, observation] of Object.entries(observations)) {
    for (const heading of observation?.headingObservations ?? []) {
      const style = heading.style ?? {};
      const signature = JSON.stringify({ level: heading.level, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, margin: style.margin });
      const entry = values.get(signature) ?? { level: heading.level, fontFamily: style.fontFamily ?? null, fontSize: style.fontSize ?? null, fontWeight: style.fontWeight ?? null, lineHeight: style.lineHeight ?? null, letterSpacing: style.letterSpacing ?? null, margin: style.margin ?? null, examples: [], viewports: [], routes: [], captures: [] };
      if (heading.text && entry.examples.length < 3 && !entry.examples.includes(heading.text)) entry.examples.push(heading.text);
      const viewportName = observation?.viewportName ?? viewport;
      if (!entry.viewports.includes(viewportName)) entry.viewports.push(viewportName);
      if (observation?.routeId && !entry.routes.includes(observation.routeId)) entry.routes.push(observation.routeId);
      if (!entry.captures.includes(viewport)) entry.captures.push(viewport);
      values.set(signature, entry);
    }
  }
  return [...values.values()].sort((a, b) => a.level.localeCompare(b.level) || parseFloat(a.fontSize) - parseFloat(b.fontSize));
}

function functionalColors(observations, tokens) {
  const backgrounds = unique(Object.values(observations).map((observation) => observation?.page?.backgroundColor));
  const text = unique(Object.values(observations).flatMap((observation) => [observation?.body?.style?.color, ...(observation?.sections ?? []).map((section) => section.style?.color)]));
  const surfaces = unique(Object.values(observations).flatMap((observation) => (observation?.sections ?? []).map((section) => section.style?.backgroundColor)).filter((value) => value && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(value)));
  const accents = (tokens.colors ?? []).filter((entry) => entry.count > 1).slice(0, 8).map((entry) => entry.value);
  return {
    pageBackgrounds: backgrounds,
    textColors: text,
    surfaces,
    frequentlyUsedAccents: accents,
    combinations: unique(Object.values(observations).map((observation) => `${observation?.body?.style?.color ?? "unknown text"} on ${observation?.page?.backgroundColor ?? "unknown background"}`)),
    note: "Roles are measured associations inferred from element context; verify semantic intent before reuse.",
  };
}

export function buildDesignSystem(observations) {
  const tokens = extractTokens(observations);
  const layouts = measuredLayouts(observations);
  const headings = headingHierarchy(observations);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceViewports: tokens.viewports,
    sourceCaptures: tokens.captures,
    provenance: "Observed computed styles and rendered geometry. Inferred semantic roles are labeled and require human confirmation.",
    colors: functionalColors(observations, tokens),
    typography: { ...tokens.typography, headingHierarchy: headings, fontFaces: tokens.fontFaces, loadedFonts: tokens.fonts },
    spacing: tokens.spacing,
    layout: {
      maxWidths: unique(layouts.map((layout) => layout.maxWidth).filter((value) => value && value !== "none")),
      containers: layouts.filter((layout) => layout.maxWidth && layout.maxWidth !== "none"),
      gridAndFlex: layouts.filter((layout) => layout.display === "grid" || layout.display === "flex"),
      observedSectionGeometry: layouts,
      declaredBreakpoints: tokens.breakpoints.mediaQueries,
      observedResponsiveTransitions: tokens.breakpoints.observedTransitions,
    },
    components: componentInventory(observations),
    visualDetails: {
      borders: tokens.borders,
      radii: tokens.radii,
      shadows: tokens.shadows,
      backgrounds: tokens.backgrounds,
      cssVariables: tokens.cssVariables,
      pseudoElements: Object.entries(observations).flatMap(([capture, observation]) => (observation?.sections ?? []).flatMap((section) => [
        { capture, viewport: observation?.viewportName ?? capture, routeId: observation?.routeId ?? null, selector: section.selector, pseudo: "::before", style: section.before },
        { capture, viewport: observation?.viewportName ?? capture, routeId: observation?.routeId ?? null, selector: section.selector, pseudo: "::after", style: section.after },
      ]).filter((entry) => entry.style?.content && entry.style.content !== "none")),
    },
    responsiveness: tokens.breakpoints,
    tokens,
  };
}

function list(values, render = String) {
  return values?.length ? values.map((value) => `- ${render(value)}`).join("\n") : "- No values observed.";
}

export function renderDesignSystemMarkdown(system) {
  const colors = [
    ["Page backgrounds", system.colors.pageBackgrounds],
    ["Text colors", system.colors.textColors],
    ["Surface colors", system.colors.surfaces],
    ["Frequently used accent candidates (inferred)", system.colors.frequentlyUsedAccents],
  ].map(([label, values]) => `### ${label}\n\n${list(values, (value) => `\`${value}\``)}`).join("\n\n");
  const headings = system.typography.headingHierarchy.map((entry) => `- **${entry.level}** — ${entry.fontFamily ?? "unknown family"}, ${entry.fontSize ?? "unknown size"}, weight ${entry.fontWeight ?? "unknown"}, line-height ${entry.lineHeight ?? "unknown"}; examples: ${entry.examples.join("; ") || "none"}`).join("\n") || "- No styled heading hierarchy observed.";
  const components = system.components.map((component) => `- **${component.id}** (${component.tag}${component.role ? ` / ${component.role}` : ""}) — ${component.count} observations across ${component.viewports.join(", ")}${component.routes.length ? `; routes ${component.routes.join(", ")}` : ""}; radius ${component.measuredStyle.borderRadius ?? "unknown"}, padding ${component.measuredStyle.padding ?? "unknown"}; examples: ${component.textExamples.join("; ") || "none"}`).join("\n") || "- No reusable elements observed.";
  const layouts = system.layout.observedSectionGeometry.map((layout) => `- ${layout.viewport}${layout.routeId ? ` (${layout.routeId})` : ""} ${layout.selector}: ${layout.display ?? "unknown display"}, ${layout.bounds?.width ?? "?"}×${layout.bounds?.height ?? "?"}px, max-width ${layout.maxWidth ?? "unset"}, columns ${layout.gridTemplateColumns ?? "—"}, gap ${layout.gap ?? "—"}`).join("\n") || "- No section geometry observed.";
  const spacing = system.spacing.slice(0, 40).map((entry) => `- \`${entry.value}\` — ${entry.count} observations (${entry.viewports.join(", ")})`).join("\n") || "- No spacing values observed.";
  const breakpoints = system.responsiveness.mediaQueries.map((entry) => `- Declared: \`${entry.condition}\` (observed at ${entry.viewports.join(", ")})`).concat(system.responsiveness.observedTransitions.slice(0, 60).map((entry) => `- Measured transition: ${entry.section}${entry.routeId ? ` (${entry.routeId})` : ""} ${entry.property}: ${entry.values.map((value) => `${value.viewport}=${value.value}`).join(" → ")}`)).join("\n") || "- No breakpoint or transition observed.";
  const effects = [
    ...system.visualDetails.radii.slice(0, 20).map((entry) => `- Radius \`${entry.value}\` (${entry.count} observations)`),
    ...system.visualDetails.shadows.slice(0, 20).map((entry) => `- Shadow \`${entry.value}\` (${entry.count} observations)`),
    ...system.visualDetails.backgrounds.slice(0, 20).map((entry) => `- Background \`${entry.value}\` (${entry.count} observations)`),
  ].join("\n") || "- No border, shadow, radius, or background effects observed.";
  return `# Reusable design system\n\nGenerated from ${system.sourceCaptures?.length ?? system.sourceViewports.length} capture(s) across ${system.sourceViewports.length} viewport profile(s): ${system.sourceViewports.join(", ")}.\n\n${system.provenance}\n\n## Colors\n\n${colors}\n\nColor combinations: ${system.colors.combinations.map((value) => `\`${value}\``).join(", ") || "none observed"}.\n\n## Typography\n\n### Heading hierarchy\n\n${headings}\n\n### Measured type scale\n\n${list(system.typography.scale, (entry) => `\`${entry.fontSize} / ${entry.lineHeight} / ${entry.fontWeight}\` (${entry.count})`)}\n\n### Families and font fallbacks\n\n${list(system.typography.families, (entry) => `\`${entry.value}\``)}\n\n### Loaded and declared font faces\n\n${list(system.typography.loadedFonts, (font) => `${font.family} ${font.weight} ${font.style} — ${font.status}`)}\n\n## Spacing\n\n${spacing}\n\n## Layout and responsive behavior\n\n${layouts}\n\nMax-width values: ${system.layout.maxWidths.map((value) => `\`${value}\``).join(", ") || "none measured"}.\n\n${breakpoints}\n\n## Reusable components\n\n${components}\n\n## Visual details\n\n${effects}\n\n## CSS custom properties\n\n${Object.entries(system.visualDetails.cssVariables).map(([name, value]) => `- \`${name}: ${value}\``).join("\n") || "- No readable custom properties."}\n\n## Reading this document\n\nComputed values and geometry are measured evidence. Semantic color roles, reusable component grouping, and inferred patterns are candidates for review, not claims about hidden implementation or backend behavior.\n`;
}

export function renderDesignTokensCss(system) {
  const entries = [];
  const add = (prefix, values) => values.forEach((entry, index) => entries.push([`--pp-${prefix}-${String(index + 1).padStart(2, "0")}`, entry.value]));
  add("color", system.tokens.colors);
  add("space", system.tokens.spacing);
  add("radius", system.tokens.radii);
  add("shadow", system.tokens.shadows);
  add("font-size", system.tokens.typography.sizes);
  const original = Object.entries(system.tokens.cssVariables).filter(([name]) => /^--[a-zA-Z0-9_-]+$/.test(name));
  const lines = [...original.map(([name, value]) => `  ${name}: ${value};`), ...entries.map(([name, value]) => `  ${name}: ${value};`)];
  return `/* Generated measured values; confirm provenance before production use. */\n:root {\n${lines.join("\n")}\n}\n`;
}
