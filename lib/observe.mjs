/**
 * Findings from the rendered page. This module is the single source of truth
 * for measurement: capture and clone comparison both call `observePage`, so a
 * source observation and a clone observation are directly comparable.
 */

export const STYLE_KEYS = [
  "display", "position", "top", "right", "bottom", "left", "width", "height",
  "minWidth", "maxWidth", "minHeight", "maxHeight", "margin", "padding", "gap",
  "rowGap", "columnGap", "gridTemplateColumns", "gridTemplateRows", "flexDirection",
  "justifyContent", "alignItems", "fontFamily", "fontSize", "fontWeight", "fontStyle",
  "lineHeight", "letterSpacing", "textAlign", "textTransform", "color", "opacity",
  "background", "backgroundColor", "backgroundImage", "backgroundPosition",
  "backgroundSize", "border", "borderRadius", "boxShadow", "filter", "backdropFilter",
  "transform", "transformOrigin", "overflow", "objectFit", "objectPosition", "zIndex",
  "transition", "animation",
];

export const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,[role=button],[role=tab],summary";

/** Browser-evaluated state snapshot. Keep this function self-contained for Playwright serialization. */
export function snapshotInteractiveState(element, keys) {
  const publicCssValue = (value) => String(value ?? "").replace(/url\(\s*(?:\"([^\"]*)\"|'([^']*)'|([^)]*))\s*\)/gi, (_match, doubleQuoted, singleQuoted, bare) => {
    const rawUrl = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
    if (!rawUrl) return 'url("")';
    try {
      const url = new URL(rawUrl, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) return 'url("")';
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return `url("${url.href}")`;
    } catch {
      return 'url("")';
    }
  });
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(),
    text: (element.innerText || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120),
    role: element.getAttribute("role") || null,
    visible: rect.width > 0 && rect.height > 0,
    focusable: element.tabIndex >= 0 && !element.disabled,
    style: Object.fromEntries(keys.map((key) => [key, publicCssValue(style[key])])),
  };
}

function observeDocument(styleKeys) {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const publicUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };
  const publicCssValue = (value) => String(value ?? "").replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_match, doubleQuoted, singleQuoted, bare) => {
    const url = publicUrl((doubleQuoted ?? singleQuoted ?? bare ?? "").trim());
    return url ? `url("${url}")` : 'url("")';
  });
  const boxOf = (element, inDocument) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(inDocument ? rect.x + window.scrollX : rect.x),
      y: Math.round(inDocument ? rect.y + window.scrollY : rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  // innerText can concatenate adjacent inline elements ("HomePricing"). Walk
  // text nodes and insert a boundary space so slugs and text matching stay
  // stable across source and clone.
  const textOf = (element) => {
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          parts.push(child.nodeValue);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.tagName === "SCRIPT" || child.tagName === "STYLE" || child.tagName === "NOSCRIPT") continue;
        if (child.getClientRects().length === 0) continue;
        walk(child);
        parts.push(" ");
      }
    };
    walk(element);
    return normalize(parts.join(" "));
  };
  const styles = (element, pseudo) => {
    const computed = getComputedStyle(element, pseudo);
    const out = {};
    for (const key of styleKeys) out[key] = publicCssValue(computed[key]);
    return out;
  };
  const selectorOf = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const classes = [...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
    return `${element.tagName.toLowerCase()}${classes}`;
  };
  const roleOf = (element) => {
    if (element.tagName === "HEADER" || element.getAttribute("role") === "banner") return "header";
    if (element.tagName === "FOOTER" || element.getAttribute("role") === "contentinfo") return "footer";
    if (element.tagName === "NAV" || element.getAttribute("role") === "navigation") return "nav";
    return "main";
  };
  const describe = (element, index) => {
    const heading = element.querySelector("h1,h2,h3,h4,h5,h6");
    return {
      index,
      selector: selectorOf(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      role: roleOf(element),
      classes: [...element.classList].slice(0, 12),
      text: textOf(element).slice(0, 220),
      heading: heading ? textOf(heading).slice(0, 120) : null,
      rect: boxOf(element, false),
      documentRect: boxOf(element, true),
      style: styles(element),
      before: styles(element, "::before"),
      after: styles(element, "::after"),
      counts: {
        elements: element.querySelectorAll("*").length,
        images: element.querySelectorAll("img,svg,video,picture").length,
        interactive: element.querySelectorAll("a,button,input,select,textarea,[role=button],[role=tab],summary").length,
      },
    };
  };

  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 4;
  };
  const unique = (nodes) => [...new Set(nodes)];
  let sectionElements = unique([...document.querySelectorAll("body > header, main > *, body > footer")]).filter(visible);
  if (sectionElements.length < 2) {
    const fallback = unique([...document.querySelectorAll("body > main > *, [role=main] > *, body > header, body > footer, body > section")]).filter(visible);
    if (fallback.length > sectionElements.length) sectionElements = fallback;
  }
  // A lone wrapper is not a usable measurement unit. Framework-generated pages
  // (Framer, Webflow, Next.js route shells) nest every block inside one page
  // container, so the selectors above find a single box that spans the whole
  // document. When that is the only candidate, descend one level into its
  // visible children; the wrapper is only kept when it has nothing to descend
  // into. Deliberately one level, not recursive, so a deep chain cannot explode
  // the region count.
  if (sectionElements.length === 1) {
    const descended = [...sectionElements[0].children].filter(visible);
    if (descended.length > 1) sectionElements = descended;
  }
  if (!sectionElements.length) {
    sectionElements = unique([...document.querySelectorAll("main, [role=main], section")]).filter(visible);
  }

  const interactiveElements = [...document.querySelectorAll("a,button,input,select,textarea,[role=button],[role=tab],summary")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 150);

  const media = [...document.querySelectorAll("img,source,video,svg,link[rel*=icon]")]
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      src: publicUrl(element.currentSrc || element.src || element.href || element.getAttribute("src") || ""),
      alt: element.alt || null,
    }))
    .filter((entry) => entry.src);

  const cssVariables = {};
  const mediaQueries = [];
  const fontFaces = [];
  let inaccessibleSheets = 0;
  let sheetCount = 0;

  const collectMedia = (rules, depth) => {
    for (const rule of rules) {
      if (rule.media && rule.conditionText) {
        const condition = normalize(rule.conditionText);
        const min = /(?:min-width:\s*|width\s*>=\s*)([0-9.]+)px/.exec(condition);
        const max = /(?:max-width:\s*|width\s*<=\s*)([0-9.]+)px/.exec(condition);
        mediaQueries.push({
          condition,
          minWidth: min ? Number(min[1]) : null,
          maxWidth: max ? Number(max[1]) : null,
        });
      }
      if (rule.cssRules && depth < 4) collectMedia(rule.cssRules, depth + 1);
    }
  };

  for (const sheet of [...document.styleSheets]) {
    sheetCount += 1;
    try {
      for (const rule of [...sheet.cssRules]) {
        if (rule.selectorText === ":root" || rule.selectorText === "html") {
          for (const name of rule.style) {
            if (name.startsWith("--") && !(name in cssVariables)) cssVariables[name] = publicCssValue(rule.style.getPropertyValue(name).trim());
          }
        }
        if (typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
          if (family) {
            fontFaces.push({
              family,
              weight: rule.style.getPropertyValue("font-weight") || "400",
              style: rule.style.getPropertyValue("font-style") || "normal",
              display: rule.style.getPropertyValue("font-display") || null,
              src: publicCssValue(normalize(rule.style.getPropertyValue("src")).slice(0, 400)) || null,
            });
          }
        }
      }
      collectMedia(sheet.cssRules, 0);
    } catch {
      inaccessibleSheets += 1;
    }
  }

  return {
    title: document.title,
    route: location.pathname,
    url: publicUrl(location.href),
    capturedAt: new Date().toISOString(),
    page: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      background: publicCssValue(getComputedStyle(document.body).background),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
    },
    body: { selector: "body", style: styles(document.body), rect: boxOf(document.body, false) },
    fonts: [...document.fonts].map((font) => ({ family: font.family, status: font.status, weight: font.weight, style: font.style })),
    fontFaces,
    cssVariables,
    mediaQueries,
    stylesheets: { total: sheetCount, inaccessible: inaccessibleSheets },
    sections: sectionElements.map(describe),
    interactive: interactiveElements.map(describe),
    media,
    headings: [...document.querySelectorAll("h1,h2,h3")].map((element) => normalize(element.textContent)).filter(Boolean),
    headingObservations: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((element) => ({
      level: element.tagName.toLowerCase(),
      text: textOf(element).slice(0, 160),
      rect: boxOf(element, false),
      style: styles(element),
    })).filter((heading) => heading.text),
  };
}

export async function observePage(page) {
  return page.evaluate(observeDocument, STYLE_KEYS);
}

const ASSET_TYPES = new Set(["image", "font", "stylesheet", "media"]);

/**
 * Record asset responses and failures. Attach before navigation so the first
 * requests are observed; read the map after the page settles.
 */
function publicAssetUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "unavailable";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "unavailable";
  }
}

function publicAssetFailure(value) {
  // Playwright normally supplies an error code, but never persist arbitrary
  // failure text because browser/network errors can embed full request URLs.
  const code = /\b(?:net::)?(ERR_[A-Z0-9_]+)\b/.exec(String(value ?? ""))?.[1];
  return code ? `net::${code}` : "request failed";
}

export function trackAssets(page) {
  const assets = new Map();
  page.on("response", (response) => {
    if (!ASSET_TYPES.has(response.request().resourceType())) return;
    const contentType = (response.headers()["content-type"] || "").split(";")[0].trim();
    const url = publicAssetUrl(response.url());
    assets.set(url, { url, status: response.status(), contentType });
  });
  page.on("requestfailed", (request) => {
    if (!ASSET_TYPES.has(request.resourceType())) return;
    const url = publicAssetUrl(request.url());
    assets.set(url, {
      url,
      status: 0,
      contentType: "",
      error: publicAssetFailure(request.failure()?.errorText),
    });
  });
  return assets;
}
