/**
 * Design-system extraction from frozen observations. Values come from
 * computed styles, never from framework conventions, and the report labels
 * observed versus inferred so a builder can tell them apart.
 */
import { normalizeText, shortHash } from "./core.mjs";

const COLOR_KEYS = ["color", "backgroundColor"];
const BACKGROUND_KEYS = ["backgroundImage", "background"];
const BORDER_KEYS = ["border"];
const RADIUS_KEYS = ["borderRadius"];
const SHADOW_KEYS = ["boxShadow"];
const SPACING_KEYS = ["padding", "margin", "gap", "rowGap", "columnGap"];
const FAMILY_KEYS = ["fontFamily"];

const IGNORED_VALUES = new Set(["", "none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)", "transparent"]);

function bump(map, value, viewport) {
  const key = normalizeText(value);
  if (!key || IGNORED_VALUES.has(key)) return;
  const entry = map.get(key) || { value: key, count: 0, viewports: [] };
  entry.count += 1;
  if (!entry.viewports.includes(viewport)) entry.viewports.push(viewport);
  map.set(key, entry);
}

function sorted(map) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function spacingEntries(map) {
  return [...map.values()]
    .map((entry) => ({ ...entry, px: Number.parseFloat(entry.value) }))
    .filter((entry) => Number.isFinite(entry.px) && entry.px > 0)
    .sort((a, b) => a.px - b.px || b.count - a.count);
}

/** Detect layout or type transitions between captured widths. */
export function detectTransitions(observations) {
  const names = Object.keys(observations);
  if (names.length < 2) return [];
  const keys = ["gridTemplateColumns", "flexDirection", "display", "fontSize", "padding", "width", "gap"];
  const transitions = [];
  const reference = observations[names[0]]?.sections ?? [];
  reference.forEach((section, index) => {
    for (const property of keys) {
      const values = names.map((name) => ({
        viewport: name,
        width: observations[name]?.page?.viewport?.width ?? null,
        value: observations[name]?.sections?.[index]?.style?.[property] ?? null,
      }));
      if (new Set(values.map((entry) => entry.value)).size > 1) {
        transitions.push({ section: section.selector, property, values });
      }
    }
  });
  return transitions.slice(0, 200);
}

export function extractTokens(observations) {
  const colors = new Map();
  const backgrounds = new Map();
  const borders = new Map();
  const radii = new Map();
  const shadows = new Map();
  const spacing = new Map();
  const families = new Map();
  const sizes = new Map();
  const weights = new Map();
  const lineHeights = new Map();
  const scale = new Map();
  const variables = {};
  const mediaQueries = new Map();
  const fonts = new Map();
  const fontFaces = new Map();

  for (const [viewport, observation] of Object.entries(observations)) {
    const elements = [observation?.body, ...(observation?.sections ?? []), ...(observation?.interactive ?? [])].filter(Boolean);
    for (const element of elements) {
      const style = element.style ?? {};
      for (const key of COLOR_KEYS) bump(colors, style[key], viewport);
      for (const key of BACKGROUND_KEYS) if (key === "background" ? (style.backgroundImage ?? "none") === "none" : true) bump(backgrounds, style[key], viewport);
      for (const key of BORDER_KEYS) bump(borders, style[key], viewport);
      for (const key of RADIUS_KEYS) bump(radii, style[key], viewport);
      for (const key of SHADOW_KEYS) bump(shadows, style[key], viewport);
      for (const key of SPACING_KEYS) {
        for (const part of normalizeText(style[key]).split(" ")) bump(spacing, part, viewport);
      }
      for (const key of FAMILY_KEYS) bump(families, style[key], viewport);
      bump(sizes, style.fontSize, viewport);
      bump(weights, style.fontWeight, viewport);
      bump(lineHeights, style.lineHeight, viewport);
      if (style.fontSize) bump(scale, `${style.fontSize} / ${style.lineHeight} / ${style.fontWeight}`, viewport);
    }
    for (const [name, value] of Object.entries(observation?.cssVariables ?? {})) {
      if (!(name in variables)) variables[name] = value;
    }
    for (const query of observation?.mediaQueries ?? []) {
      const key = query.condition;
      if (!mediaQueries.has(key)) mediaQueries.set(key, { ...query, viewports: [] });
      const entry = mediaQueries.get(key);
      if (!entry.viewports.includes(viewport)) entry.viewports.push(viewport);
    }
    for (const font of observation?.fonts ?? []) {
      const key = [font.family, font.weight, font.style, font.status].join("|");
      if (!fonts.has(key)) fonts.set(key, { family: font.family, weight: font.weight, style: font.style, status: font.status, src: null });
    }
    for (const face of observation?.fontFaces ?? []) {
      const key = [face.family, face.weight, face.style].join("|");
      if (!fontFaces.has(key)) fontFaces.set(key, { ...face, viewports: [] });
      const entry = fontFaces.get(key);
      if (!entry.viewports.includes(viewport)) entry.viewports.push(viewport);
    }
  }

  const typeScale = sorted(scale).map((entry) => {
    const [fontSize, lineHeight, fontWeight] = entry.value.split(" / ");
    return { fontSize, lineHeight, fontWeight, count: entry.count, viewports: entry.viewports };
  });

  return {
    generatedAt: new Date().toISOString(),
    viewports: Object.keys(observations),
    provenance: "Computed styles measured from rendered pages; confirm shared tokens before substituting values.",
    colors: sorted(colors),
    backgrounds: sorted(backgrounds),
    borders: sorted(borders),
    radii: sorted(radii),
    shadows: sorted(shadows),
    spacing: spacingEntries(spacing),
    typography: {
      families: sorted(families),
      sizes: sorted(sizes),
      weights: sorted(weights),
      lineHeights: sorted(lineHeights),
      scale: typeScale,
    },
    fonts: [...fonts.values()],
    fontFaces: [...fontFaces.values()],
    cssVariables: variables,
    breakpoints: {
      mediaQueries: [...mediaQueries.values()],
      observedTransitions: detectTransitions(observations),
    },
    fingerprint: shortHash(JSON.stringify({
      colors: sorted(colors).map((entry) => entry.value),
      families: sorted(families).map((entry) => entry.value),
      sizes: sorted(sizes).map((entry) => entry.value),
      radii: sorted(radii).map((entry) => entry.value),
    }), 12),
  };
}

function table(rows, columns) {
  if (!rows.length) return "_None measured._";
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  return [header, divider, ...rows.map((row) => `| ${columns.map((column) => String(column.value(row)).replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
}

export function renderTokensMarkdown(tokens) {
  const count = (entry) => `${entry.count} (${entry.viewports.join(", ")})`;
  const spacing = tokens.spacing.slice(0, 24);
  const queries = tokens.breakpoints.mediaQueries;
  const transitions = tokens.breakpoints.observedTransitions;
  return `# Extracted design tokens

Measured from ${tokens.viewports.length} captured viewport(s): ${tokens.viewports.join(", ")}. ${tokens.provenance}

## Color

${table(tokens.colors.slice(0, 40), [{ label: "Value", value: (entry) => `\`${entry.value}\`` }, { label: "Uses", value: count }])}

## Typography

${table(tokens.typography.scale.slice(0, 30), [{ label: "Size / line-height / weight", value: (entry) => `\`${entry.fontSize} / ${entry.lineHeight} / ${entry.fontWeight}\`` }, { label: "Uses", value: count }])}

Families: ${tokens.typography.families.map((entry) => `\`${entry.value}\``).join(", ") || "_none measured_"}

## Spacing

${table(spacing, [{ label: "Value", value: (entry) => `\`${entry.value}\`` }, { label: "Uses", value: count }])}

## Radius, border, shadow

${table(tokens.radii.slice(0, 20), [{ label: "Radius", value: (entry) => `\`${entry.value}\`` }, { label: "Uses", value: count }])}

${table(tokens.shadows.slice(0, 12), [{ label: "Shadow", value: (entry) => `\`${entry.value}\`` }, { label: "Uses", value: count }])}

## Background layers

${table(tokens.backgrounds.slice(0, 16), [{ label: "Background", value: (entry) => `\`${entry.value}\`` }, { label: "Uses", value: count }])}

## CSS variables

${Object.keys(tokens.cssVariables).length
    ? Object.entries(tokens.cssVariables).map(([name, value]) => `- \`${name}: ${value}\``).join("\n")
    : "_No :root custom properties were readable._"}

## Breakpoints

Observed media queries (declared, not proof of use):

${queries.length ? queries.map((query) => `- \`${query.condition}\`${query.minWidth ? ` (min ${query.minWidth}px)` : ""}${query.maxWidth ? ` (max ${query.maxWidth}px)` : ""}`).join("\n") : "_None readable._"}

Layout or type transitions between captured widths:

${transitions.length ? transitions.slice(0, 40).map((entry) => `- \`${entry.section}\` **${entry.property}**: ${entry.values.map((value) => `${value.viewport}=\`${value.value}\``).join(" → ")}`).join("\n") : "_No transition observed between the captured widths._"}

## Loaded fonts

${tokens.fonts.length ? tokens.fonts.map((font) => `- ${font.family} ${font.weight} ${font.style} — ${font.status}`).join("\n") : "_No font faces reported._"}

Use these values as measured evidence. A nearby framework token is still wrong when the source measures something else.
`;
}
