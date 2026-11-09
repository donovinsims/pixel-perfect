import { normalizeText, safeName, shortHash } from "./core.mjs";
import { classifyGeometryComparison, classifySectionVisual } from "./verdict.mjs";

/** Style keys compared between a source region and its clone counterpart. */
export const GEOMETRY_STYLE_KEYS = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "color", "backgroundColor", "backgroundImage", "padding", "gap",
  "borderRadius", "boxShadow",
];

/** Style keys whose drift usually means a shared foundation changed. */
export const FOUNDATION_STYLE_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "padding", "gap"];

export const CAUSE_PRIORITY = {
  structural: 1,
  foundation: 2,
  geometry: 3,
  assets: 4,
  visual: 5,
  identity: 6,
  none: 7,
};

function baseSlug(section) {
  const heading = normalizeText(section.heading);
  const text = normalizeText(section.text);
  const basis = heading || text;
  const words = basis.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 4).join("-").slice(0, 48);
  if (words) return safeName(words).toLowerCase();
  if (section.id) return safeName(`id-${section.id}`).toLowerCase();
  return "";
}

/**
 * Deterministic, order-independent crop names. Sections with identical text
 * are disambiguated by a content hash so a source and clone crop share a name
 * only when they describe the same content.
 */
export function sectionSlugs(sections) {
  const bases = sections.map((section) => baseSlug(section));
  const counts = new Map();
  for (const base of bases) counts.set(base, (counts.get(base) || 0) + 1);
  return sections.map((section, index) => {
    const base = bases[index];
    if (base && counts.get(base) === 1) return base;
    const basis = normalizeText(section.text) || normalizeText(section.heading) || normalizeText(section.id) || `index-${index}`;
    return `${base || "section"}-${shortHash(basis)}`;
  });
}

/**
 * Pair source regions with clone regions. Exact text wins, then id, then the
 * heading. Position is only a fallback and is always reported as a review
 * match, never a measured one.
 */
export function matchSections(sourceSections = [], cloneSections = []) {
  const used = new Set();
  const pairs = sourceSections.map((source, sourceIndex) => {
    const sourceText = normalizeText(source.text);
    const sourceHeading = normalizeText(source.heading);
    let cloneIndex = -1;
    let matchedBy = "missing";
    const find = (predicate) => cloneSections.findIndex((candidate, index) => !used.has(index) && predicate(candidate));

    if (sourceText) {
      cloneIndex = find((candidate) => normalizeText(candidate.text) === sourceText);
      if (cloneIndex >= 0) matchedBy = "text";
    }
    if (cloneIndex < 0 && source.id) {
      cloneIndex = find((candidate) => candidate.id && candidate.id === source.id);
      if (cloneIndex >= 0) matchedBy = "id";
    }
    if (cloneIndex < 0 && sourceHeading) {
      cloneIndex = find((candidate) => normalizeText(candidate.heading) === sourceHeading);
      if (cloneIndex >= 0) matchedBy = "heading";
    }
    if (cloneIndex < 0 && sourceIndex < cloneSections.length && !used.has(sourceIndex)) {
      cloneIndex = sourceIndex;
      matchedBy = "index";
    }
    if (cloneIndex >= 0) used.add(cloneIndex);
    return {
      sourceIndex,
      source,
      cloneIndex: cloneIndex >= 0 ? cloneIndex : null,
      target: cloneIndex >= 0 ? cloneSections[cloneIndex] : null,
      matchedBy: cloneIndex >= 0 ? matchedBy : "missing",
    };
  });
  const extra = cloneSections.map((section, index) => ({ index, section })).filter((entry) => !used.has(entry.index));
  return { pairs, extra };
}

/** Compare two observations region by region. Pure and browser-free. */
export function compareObservations(sourceObservation, cloneObservation) {
  const { pairs, extra } = matchSections(sourceObservation?.sections, cloneObservation?.sections);
  const comparisons = pairs.map((pair) => {
    if (!pair.target) {
      return {
        sourceIndex: pair.sourceIndex,
        cloneIndex: null,
        matchedBy: "missing",
        status: "fail",
        selector: pair.source.selector,
        text: pair.source.text,
        deltas: null,
        styleMatches: null,
        styleMismatches: [],
      };
    }
    const deltas = Object.fromEntries(Object.entries(pair.source.rect || {}).map(([key, value]) => [key, (pair.target.rect?.[key] ?? 0) - value]));
    const styleMatches = {};
    const styleMismatches = [];
    for (const key of GEOMETRY_STYLE_KEYS) {
      const matches = (pair.source.style?.[key] ?? null) === (pair.target.style?.[key] ?? null);
      styleMatches[key] = matches;
      if (!matches) styleMismatches.push(key);
    }
    return {
      sourceIndex: pair.sourceIndex,
      cloneIndex: pair.cloneIndex,
      matchedBy: pair.matchedBy,
      status: pair.matchedBy === "index" ? "review" : "measured",
      selector: pair.source.selector,
      text: pair.source.text,
      deltas,
      styleMatches,
      styleMismatches,
    };
  });
  return {
    comparisons,
    extra: extra.map((entry) => ({ index: entry.index, selector: entry.section.selector, text: entry.section.text })),
    matched: comparisons.filter((comparison) => comparison.matchedBy !== "missing").length,
  };
}

/**
 * Foundation signature: the shared type and container facts that, when they
 * change, invalidate previously KEEP regions.
 */
export function foundationSignature(observation) {
  const body = observation?.body?.style ?? {};
  const parts = [
    observation?.page?.backgroundColor ?? "",
    body.fontFamily ?? "",
    body.fontSize ?? "",
    body.lineHeight ?? "",
    ...(observation?.sections ?? []).map((section) => [
      section.style?.fontFamily,
      section.style?.fontSize,
      section.style?.lineHeight,
      section.rect?.width,
    ].join("|")),
  ].sort();
  return shortHash(parts.join("\n"), 12);
}

function percent(ratio) {
  return `${((Number(ratio) || 0) * 100).toFixed(3)}%`;
}

function describeDrift(comparison, thresholds) {
  const deltas = comparison.deltas || {};
  const parts = [];
  for (const [key, value] of Object.entries(deltas)) {
    const tolerance = key === "width" || key === "height" ? thresholds.geometry.size : thresholds.geometry.xy;
    if (Math.abs(value) > tolerance) parts.push(`${key} ${value > 0 ? "+" : ""}${value}px`);
  }
  if ((comparison.styleMismatches || []).length) parts.push(`style: ${comparison.styleMismatches.join(", ")}`);
  return parts.length ? `Measured drift: ${parts.join("; ")}.` : "Measured drift within tolerance.";
}

export function classifySection({ viewport, slug, source, comparison, visual, thresholds, previous = null, foundationChanged = false }) {
  const reasons = [];
  let status = "KEEP";
  let cause = "none";

  if (!comparison || comparison.matchedBy === "missing") {
    status = "FIX";
    cause = "structural";
    reasons.push("Region is missing from the clone.");
  } else {
    const geometryStatus = classifyGeometryComparison(comparison, thresholds);
    const visualStatus = classifySectionVisual(visual, thresholds);
    const mismatches = comparison.styleMismatches || [];

    if (visualStatus === "fail") {
      status = "FIX";
      cause = visual?.missing ? "assets" : "visual";
      reasons.push(visual?.missing
        ? "Section screenshot is missing from the clone."
        : `Section changed-pixel ratio ${percent(visual?.changeRatio)} is outside the fail band.`);
    } else if (geometryStatus === "review") {
      if (comparison.matchedBy === "index") {
        status = "RECHECK";
        cause = "identity";
        reasons.push("No text, id, or heading match; the comparison is positional only.");
      } else {
        status = "FIX";
        cause = mismatches.some((key) => FOUNDATION_STYLE_KEYS.includes(key)) ? "foundation" : "geometry";
        reasons.push(describeDrift(comparison, thresholds));
      }
    } else if (!visual) {
      status = "RECHECK";
      cause = "visual";
      reasons.push("No section screenshot was available for comparison.");
    } else if (visualStatus === "review") {
      status = "RECHECK";
      cause = "visual";
      reasons.push(`Section changed-pixel ratio ${percent(visual.changeRatio)} needs manual review.`);
    }
  }

  if (status === "KEEP" && foundationChanged && previous?.status === "KEEP") {
    status = "RECHECK";
    cause = "foundation";
    reasons.push("Shared foundation changed since the previous round; recheck before keeping.");
  }

  return {
    viewport,
    slug,
    sourceIndex: source?.index ?? null,
    selector: source?.selector ?? null,
    text: (source?.text ?? "").slice(0, 120),
    cloneIndex: comparison?.cloneIndex ?? null,
    matchedBy: comparison?.matchedBy ?? "missing",
    status,
    cause,
    priority: CAUSE_PRIORITY[cause] ?? CAUSE_PRIORITY.none,
    previousStatus: previous?.status ?? null,
    deltas: comparison?.deltas ?? null,
    styleMismatches: comparison?.styleMismatches ?? [],
    visual: visual ? { changeRatio: visual.changeRatio, dimensionMismatch: visual.dimensionMismatch, missing: visual.missing } : null,
    reasons,
  };
}

function summarizeSections(sections) {
  return sections.reduce((summary, section) => {
    summary[section.status.toLowerCase()] += 1;
    summary.total += 1;
    return summary;
  }, { keep: 0, fix: 0, recheck: 0, total: 0 });
}

/**
 * Build the KEEP / FIX / RECHECK classification for one verification round,
 * plus an ordered correction plan. `previous` is the prior round's triage so
 * regression after a foundation change is visible instead of assumed.
 */
export function buildTriage({ viewports, sourceUrl, cloneUrl, thresholds, previous = null }) {
  const results = viewports.map(({ viewport, sourceObservation, cloneObservation, comparisons, sectionVisual }) => {
    const signature = foundationSignature(cloneObservation);
    const previousViewport = previous?.viewports?.find((entry) => entry.viewport === viewport) ?? null;
    const foundationChanged = Boolean(previousViewport?.foundationSignature && previousViewport.foundationSignature !== signature);
    const slugs = sectionSlugs(sourceObservation?.sections ?? []);
    const sections = (sourceObservation?.sections ?? []).map((source, index) => classifySection({
      viewport,
      slug: slugs[index],
      source,
      comparison: (comparisons ?? []).find((item) => item.sourceIndex === index) ?? null,
      visual: sectionVisual?.[slugs[index]] ?? null,
      thresholds,
      previous: previousViewport?.sections?.find((entry) => entry.slug === slugs[index]) ?? null,
      foundationChanged,
    }));
    return { viewport, foundationSignature: signature, foundationChanged, sections, summary: summarizeSections(sections) };
  });

  const plan = new Map();
  for (const result of results) {
    for (const section of result.sections) {
      if (section.status === "KEEP") continue;
      const entry = plan.get(section.slug) || {
        slug: section.slug,
        action: section.status,
        cause: section.cause,
        priority: section.priority,
        selector: section.selector,
        text: section.text,
        viewports: [],
        evidence: [],
      };
      entry.action = entry.action === "FIX" || section.status === "FIX" ? "FIX" : "RECHECK";
      entry.priority = Math.min(entry.priority, section.priority);
      if (!entry.viewports.includes(result.viewport)) entry.viewports.push(result.viewport);
      for (const reason of section.reasons) if (!entry.evidence.includes(reason)) entry.evidence.push(reason);
      plan.set(section.slug, entry);
    }
  }

  const correctionPlan = [...plan.values()].sort((a, b) => a.priority - b.priority || String(a.slug).localeCompare(String(b.slug)));
  const summary = results.reduce((total, result) => ({
    keep: total.keep + result.summary.keep,
    fix: total.fix + result.summary.fix,
    recheck: total.recheck + result.summary.recheck,
    total: total.total + result.summary.total,
  }), { keep: 0, fix: 0, recheck: 0, total: 0 });

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    cloneUrl,
    thresholds,
    summary,
    correctionPlan,
    viewports: results,
    nextAction: correctionPlan.length
      ? `${correctionPlan[0].action} ${correctionPlan[0].slug} (${correctionPlan[0].viewports.join(", ")}): ${correctionPlan[0].evidence[0] ?? correctionPlan[0].cause}.`
      : "All measured regions are KEEP; continue with the remaining manual gates.",
  };
}

export function renderTriageMarkdown(triage) {
  const rows = [];
  for (const viewport of triage.viewports) {
    for (const section of viewport.sections) {
      rows.push(`| ${viewport.viewport} | ${section.slug} | ${section.status} | ${section.cause} | ${(section.reasons[0] ?? "").replace(/\|/g, "\\|")} |`);
    }
  }
  const plan = triage.correctionPlan.length
    ? triage.correctionPlan.map((entry) => `| ${entry.priority} | ${entry.action} | ${entry.slug} | ${entry.viewports.join(", ")} | ${entry.evidence.join(" ").replace(/\|/g, "\\|")} |`).join("\n")
    : "| - | KEEP | all measured regions | - | No measured drift. |";
  return `# Correction triage\n\n- Source: ${triage.sourceUrl}\n- Clone: ${triage.cloneUrl}\n- Regions: ${triage.summary.keep} KEEP / ${triage.summary.fix} FIX / ${triage.summary.recheck} RECHECK across ${triage.viewports.length} viewports\n- Next action: ${triage.nextAction}\n\n## Region classification\n\n| Viewport | Region | Status | Cause | Evidence |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\n## Correction plan (highest causal impact first)\n\n| Priority | Action | Region | Viewports | Evidence |\n| ---: | --- | --- | --- | --- |\n${plan}\n\nFix shared foundations before local decoration. Do not touch KEEP regions without evidence that a foundation changed.\n`;
}
