/*
 * FindMy815 page builder. Emits the whole static site from the data below, so
 * every route exists as a real file and every link resolves. Run from the app
 * folder: node tools/build-pages.mjs
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "FindMy815";

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/* Display headings are set per character, as the reference design does. */
const chars = (text) => [...text].map((ch) => (ch === " " ? " " : `<span>${esc(ch)}</span>`)).join("");

/* ---- Icons ----------------------------------------------------------- */
const arrowUpRight = (cls = "card-arrow") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>`;
const chevronDown = () => `<svg class="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const searchIcon = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>`;
const plusIcon = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
const moonIcon = () => `<svg class="theme-icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/></svg>`;
const sunIcon = () => `<svg class="theme-icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>`;

/* ---- Data ------------------------------------------------------------ */
const CATEGORIES = [
  ["All-day Café", "all-day-cafe"],
  ["Artisan Bakery", "artisan-bakery"],
  ["Brunch Spot", "brunch-spot"],
  ["Co-working Friendly", "co-working-friendly"],
  ["Dessert & Pastry", "dessert-pastry"],
  ["Eco-conscious", "eco-conscious"],
  ["Late-night Café", "late-night-cafe"],
  ["Pet Friendly", "pet-friendly"],
  ["Specialty Coffee", "specialty-coffee"],
].map(([label, slug]) => ({ label, slug }));

const LOCATIONS = ["Brooklyn", "Chelsea", "East Village", "Greenwich Village", "Lower East Side", "Midtown East", "SoHo", "Union Square", "West Village"]
  .map((label) => ({ label, slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));

const THEMES = ["Bohemian", "Botanical", "Industrial", "Modern", "Retro", "Rustic", "Scandinavian", "Urban Chic", "Vintage"]
  .map((label) => ({ label, slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));

const CAFES = [
  ["Penny & Oak", "penny-oak", "Brunch and baked goods in a cozy setting.", "New", ["Brunch Spot", "Dessert & Pastry"], "Rustic", "West Village", "21 Bleecker St"],
  ["Atlas Grind", "atlas-grind", "Global coffee, local spirit.", "New", ["Specialty Coffee", "All-day Café"], "Industrial", "Chelsea", "118 W 22nd St"],
  ["The Nord Cafe", "the-nord-cafe", "Scandinavian simplicity and slow mornings.", "New", ["Specialty Coffee", "All-day Café"], "Scandinavian", "SoHo", "55 Prince St"],
  ["Elm & Iron", "elm-iron", "Industrial coffee with heart in SoHo.", "Featured", ["Specialty Coffee", "Co-working Friendly"], "Industrial", "SoHo", "118 Mercer St"],
  ["The Velvet Bean", "the-velvet-bean", "Decadent desserts and espresso perfection.", "Popular", ["Dessert & Pastry", "Specialty Coffee"], "Vintage", "Greenwich Village", "9 W 8th St"],
  ["Cobalt Café", "cobalt-cafe", "A moody modern retreat downtown.", "Popular", ["Specialty Coffee", "Late-night Café"], "Modern", "Lower East Side", "148 Orchard St"],
  ["Rosewood & Rye", "rosewood-rye", "Where rustic meets refined.", "Trending", ["Artisan Bakery", "Brunch Spot"], "Rustic", "Brooklyn", "77 Berry St"],
  ["Willow & Finch", "willow-finch", "Botanical café oasis in Brooklyn.", "", ["Eco-conscious", "All-day Café"], "Botanical", "Brooklyn", "40 Greenpoint Ave"],
  ["Café Solstice", "cafe-solstice", "Sustainable coffee for conscious drinkers.", "", ["Eco-conscious", "Specialty Coffee"], "Botanical", "East Village", "62 E 7th St"],
  ["Honeyline", "honeyline", "The city’s sweetest brunch escape.", "", ["Brunch Spot", "Dessert & Pastry"], "Bohemian", "West Village", "14 Christopher St"],
  ["The Nest", "the-nest", "Your cozy co-working hideaway.", "", ["Co-working Friendly", "All-day Café"], "Bohemian", "Chelsea", "200 W 26th St"],
  ["August & Co.", "august-co", "The art of mindful mornings.", "", ["Artisan Bakery", "Eco-conscious"], "Scandinavian", "Union Square", "33 E 17th St"],
  ["Luna & Ash", "luna-ash", "Where twilight meets espresso.", "", ["Late-night Café", "Specialty Coffee"], "Modern", "Lower East Side", "95 Ludlow St"],
  ["Copperbird", "copperbird", "Brunch, beats, and espresso perfection.", "", ["Brunch Spot", "Co-working Friendly"], "Industrial", "Midtown East", "501 Lexington Ave"],
  ["Paper Moon", "paper-moon", "A poetic café for dreamers and readers.", "", ["All-day Café", "Eco-conscious"], "Bohemian", "East Village", "88 St Marks Pl"],
  ["Harborline", "harborline", "Modern waterfront café with a view.", "", ["All-day Café", "Pet Friendly"], "Urban Chic", "Brooklyn", "5 Water St"],
  ["Marble Fox Café", "marble-fox-cafe", "A modern twist on classic coffee culture.", "", ["Specialty Coffee", "Dessert & Pastry"], "Urban Chic", "SoHo", "41 Grand St"],
  ["Birch & Bloom", "birch-bloom", "Seasonal plates in a light-filled room.", "", ["Brunch Spot", "Eco-conscious"], "Botanical", "Brooklyn", "12 Putnam Ave"],
  ["Driftwood Diner", "driftwood-diner", "Comfort food and bottomless drip.", "", ["All-day Café", "Brunch Spot"], "Retro", "Chelsea", "310 W 15th St"],
  ["Third Rail Café", "third-rail-cafe", "Late pours and louder playlists.", "", ["Late-night Café", "Co-working Friendly"], "Industrial", "East Village", "120 1st Ave"],
  ["Bloomfield Roasters", "bloomfield-roasters", "Small-batch roasting on site.", "", ["Specialty Coffee", "Artisan Bakery"], "Industrial", "Brooklyn", "9 Wythe Ave"],
  ["The Common Table", "the-common-table", "A long table and a longer menu.", "", ["Co-working Friendly", "All-day Café"], "Rustic", "Union Square", "60 E 14th St"],
  ["Secret Garden Café", "secret-garden-cafe", "Thyme and jasmine on the patio.", "", ["Pet Friendly", "Eco-conscious"], "Vintage", "Greenwich Village", "22 Minetta Ln"],
  ["Night Owl Espresso", "night-owl-espresso", "The city’s smallest late-night counter.", "", ["Late-night Café", "Pet Friendly"], "Retro", "Midtown East", "71 E 44th St"],
].map(([title, slug, sub, badge, categories, theme, location, address]) => ({
  title, slug, sub, badge, categories, theme, location, address,
  body: [
    `${title} is a ${theme.toLowerCase()} room on ${address}, known for ${sub.charAt(0).toLowerCase()}${sub.slice(1)} Regulars come for the ${categories[0].toLowerCase()} counter and stay for the playlist that runs from open to close.`,
    `Whether you are grabbing a quick cortado or settling in with a book, ${title} keeps things ${theme.toLowerCase()} and unhurried. Expect seasonal beans, a short food menu, and staff who remember your order.`,
  ],
  search: `${title} ${sub} ${categories.join(" ")} ${theme} ${location} ${address}`.toLowerCase(),
}));

const POSTS = [
  ["designing-the-perfect-cafe-experience", "Designing the perfect cafe experience", "August 14, 2026", "6 min read", "Seven rooms that get the details right, and what to borrow from each of them."],
  ["new-yorks-hidden-cafes-worth-finding", "New York’s hidden cafés worth finding", "July 29, 2026", "8 min read", "Past the obvious corners: twelve small counters that are worth the walk."],
  ["the-rise-of-neighborhood-coffee-culture", "The rise of neighborhood coffee culture", "July 2, 2026", "5 min read", "Why the block-level roaster is beating the chain, one queue at a time."],
  ["how-we-choose-what-to-list", "How we choose what to list", "June 18, 2026", "4 min read", "Our shortlist rules, the things we check in person, and what gets a cafe cut."],
].map(([slug, title, date, read, excerpt]) => ({
  slug, title, date, read, excerpt,
  body: [
    `Every cafe on ${APP} starts with a walk-in visit. We order two things, we sit for twenty minutes, and we write down what we remember without looking at the menu. If nothing survives that test, the room does not make the list.`,
    "That sounds precious, but it is the only filter that has held up. Lighting, noise, and the distance from the door to the counter matter more than a bean origin nobody can taste through oat milk and a paper cup.",
    "The rooms that do make it tend to share a short list of habits: a counter you can sit at, a menu that fits on one page, and staff who will tell you what they are excited about this week.",
    "If you run a room that belongs here, send it in. We read every submission, we just do not publish most of them — and we will always tell you why.",
  ],
}));

const LEGAL = {
  "terms-and-conditions": {
    title: "Terms and Conditions",
    paragraphs: [
      `${APP} is a local demonstration build. Listings, reviews, addresses and contact details on this site are sample data written to exercise the interface.`,
      "Nothing here is a commercial offer, a booking service, or a reservation system. No account is created, no email is stored, and no form on this site sends anything anywhere.",
      "The cafe names, descriptions and addresses are fictional. Any resemblance to a real business is coincidental and unintended.",
      "This build is provided as-is for evaluation. Replace this copy with your own terms before using it for anything public.",
    ],
  },
  "privacy-policy": {
    title: "Privacy Policy",
    paragraphs: [
      `${APP} is a static site. It has no server, no database, and no analytics.`,
      "The only thing stored in your browser is your theme preference, kept in local storage under findmy815-theme. Clear it by clearing site data; nothing is transmitted.",
      "Search terms, filter selections and form entries stay in the page you typed them into and are discarded when you navigate away.",
      "The reference photography of the original design is not reproduced here: every image slot is a placeholder block.",
    ],
  },
  disclaimer: {
    title: "Disclaimer",
    paragraphs: [
      `${APP} is an independent demonstration, not affiliated with any listing service, directory, or map provider.`,
      "Cafe information — hours, addresses, and categories — is sample content and must not be relied on to find a real cafe.",
      "Photography is intentionally omitted: image slots are neutral placeholders so the layout can be evaluated without borrowed assets.",
      "Maps are represented by a static panel. The “Open in Maps” control opens an external maps search in a new tab.",
    ],
  },
};

/* ---- Lookups --------------------------------------------------------- */
const byLabel = (list, label) => list.find((item) => item.label === label);
const cafesInCategory = (label) => CAFES.filter((cafe) => cafe.categories.includes(label));
const cafesInLocation = (label) => CAFES.filter((cafe) => cafe.location === label);
const cafesInTheme = (label) => CAFES.filter((cafe) => cafe.theme === label);
const relatedTo = (cafe) => CAFES.filter((other) => other.slug !== cafe.slug
  && (other.categories.some((name) => cafe.categories.includes(name)) || other.theme === cafe.theme)).slice(0, 3);

/* ---- Shared chrome --------------------------------------------------- */
const header = () => `
  <div class="header-holder">
    <nav class="site-header" aria-label="Main">
      <div class="header-inner">
        <div class="header-start">
          <div class="brand-wrap">
            <a class="brand" href="/" aria-label="${APP} home">
              <img class="brand-logo" src="/assets/icon.png" alt="" width="30" height="30">
              <span class="brand-name">${APP}</span>
            </a>
          </div>
        </div>
        <div class="header-end">
          <div class="nav-cluster">
            <div class="nav-links">
              <a href="/about/">About</a>
              <a href="/cafes/">Cafes</a>
              <a href="/category/">Categories</a>
              <a href="/location/">Locations</a>
              <a href="/theme/">Themes</a>
              <a href="/blog/">Blog</a>
            </div>
            <div class="theme-slot">
              <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle dark mode">${moonIcon()}${sunIcon()}</button>
            </div>
            <div class="header-actions">
              <a class="search-btn" href="/cafes/" aria-label="Search cafes">${searchIcon()}</a>
              <a class="submit-btn" href="/submit/">${plusIcon()}Submit</a>
            </div>
            <button class="menu-btn" type="button" data-menu aria-label="Open menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  </div>`;

const footerColumn = (heading, items) => `
        <div class="footer-col">
          <p class="footer-title">${esc(heading)}</p>
          <div class="footer-links">
${items.map((item) => `            <a href="${item.href}">${esc(item.label)}</a>`).join("\n")}
          </div>
        </div>`;

const footer = () => `
  <div class="footer-holder">
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand-col">
          <a class="brand" href="/">
            <img class="brand-logo" src="/assets/icon.png" alt="" width="26" height="26">
            <span class="brand-name">${APP}</span>
          </a>
          <div class="footer-links" style="gap:20px">
            <a href="/contact/">Contact us</a>
            <a href="/legal/terms-and-conditions/">Terms and Conditions</a>
            <a href="/legal/privacy-policy/">Privacy Policy</a>
            <a href="/legal/disclaimer/">Disclaimer</a>
          </div>
          <div class="footer-social">
            <a href="https://x.com/" aria-label="X">${arrowUpRight("footer-social-icon")}</a>
            <a href="https://instagram.com/" aria-label="Instagram">${arrowUpRight("footer-social-icon")}</a>
            <a href="https://threads.net/" aria-label="Threads">${arrowUpRight("footer-social-icon")}</a>
          </div>
        </div>
        <div class="footer-links-col">
${footerColumn("Recent Cafes", CAFES.slice(0, 9).map((cafe) => ({ label: cafe.title, href: `/cafes/${cafe.slug}/` })))}
${footerColumn("Categories", CATEGORIES.map((category) => ({ label: category.label, href: `/category/${category.slug}/` })))}
${footerColumn("Locations", LOCATIONS.map((location) => ({ label: location.label, href: `/location/${location.slug}/` })))}
${footerColumn("Themes", THEMES.map((theme) => ({ label: theme.label, href: `/theme/${theme.slug}/` })))}
        </div>
      </div>
    </footer>
  </div>`;

/* ---- Cards ----------------------------------------------------------- */
const cardAttributes = (cafe, more) => `data-card${more ? " data-more" : ""} data-search="${esc(cafe.search)}" data-categories="${esc(cafe.categories.join("|"))}" data-themes="${esc(cafe.theme)}" data-locations="${esc(cafe.location)}"`;

const card = (cafe, more = false) => `
          <a class="card" href="/cafes/${cafe.slug}/" ${cardAttributes(cafe, more)}>
            <div class="card-media">
              <div class="media" role="img" aria-label="${esc(cafe.title)} photograph — placeholder"></div>
              ${cafe.badge ? `<div class="card-badge"><span>${esc(cafe.badge)}</span></div>` : ""}
            </div>
            <div class="card-text">
              <div class="card-copy">
                <p class="card-title">${esc(cafe.title)}</p>
                <p class="card-sub">${esc(cafe.sub)}</p>
              </div>
              ${arrowUpRight()}
            </div>
          </a>`;

const featuredCard = (cafe) => `
      <div class="featured-slot">
        <a class="featured-card" href="/cafes/${cafe.slug}/">
          <div class="card-media">
            <div class="media" role="img" aria-label="${esc(cafe.title)} photograph — placeholder"></div>
            <div class="card-badge"><span>Featured</span></div>
          </div>
          <div class="card-text">
            <div class="card-copy">
              <p class="card-title">${esc(cafe.title)}</p>
              <p class="card-sub">${esc(cafe.sub)}</p>
            </div>
            ${arrowUpRight()}
          </div>
        </a>
      </div>`;

const exploreCard = (label, href, meta = "") => `
        <a class="explore-card" href="${href}"><span>${esc(label)}</span><span class="explore-arrow">${arrowUpRight("explore-arrow-icon")}</span></a>`;

const indexCard = (label, href, meta) => `
          <a class="index-card" href="${href}">
            <div>
              <h2>${esc(label)}</h2>
              <p class="index-meta">${esc(meta)}</p>
            </div>
            <span class="explore-arrow">${arrowUpRight("explore-arrow-icon")}</span>
          </a>`;

/* ---- Filters --------------------------------------------------------- */
const checkboxGroup = (heading, items, kind, current) => `
          <div class="sidebar-group">
            <p class="sidebar-title">${esc(heading)}</p>
            <div class="checkbox-list">
${items.map((item) => `              <label class="checkbox"><input type="checkbox" data-filter-checkbox data-kind="${kind}" value="${esc(item.label)}"${item.label === current ? " checked" : ""}><span>${esc(item.label)}</span></label>`).join("\n")}
            </div>
          </div>`;

const sidebar = (current = null, currentKind = null) => `
        <aside class="filter-sidebar">
          <label class="search-field sidebar-search">
            ${searchIcon()}
            <input type="search" placeholder="Search cafes" aria-label="Search cafes" data-search-input>
          </label>
${checkboxGroup("Categories", CATEGORIES, "categories", currentKind === "categories" ? current : null)}
${checkboxGroup("Themes", THEMES, "themes", currentKind === "themes" ? current : null)}
${checkboxGroup("Locations", LOCATIONS, "locations", currentKind === "locations" ? current : null)}
        </aside>`;

const select = (label, items, kind) => `
              <label class="select-wrap">
                <select data-filter data-kind="${kind}" aria-label="${esc(label)}">
                  <option value="">${esc(label)}</option>
${items.map((item) => `                  <option value="${esc(item.label)}">${esc(item.label)}</option>`).join("\n")}
                </select>
                ${chevronDown()}
              </label>`;

const newsletterWide = () => `
    <section class="newsletter">
      <div class="newsletter-card">
        <div class="newsletter-media">
          <div class="media" role="img" aria-label="Cafe interior photograph — placeholder"></div>
        </div>
        <div class="newsletter-body">
          <h2 class="section-title">Join our weekly newsletter &amp; be first to know when we add more cafes</h2>
          <div class="newsletter-form-block">
            <form class="inline-form" data-form="newsletter">
              <label class="field">
                <input type="email" name="email" placeholder="name@email.com" aria-label="Email address" autocomplete="email">
              </label>
              <button class="subscribe" type="submit">Subscribe</button>
            </form>
            <p class="small">Get cafe recommendations straight in your inbox!</p>
            <p class="note small" data-note></p>
          </div>
        </div>
      </div>
    </section>`;

const newsletterNarrow = () => `
    <section class="newsletter newsletter--narrow">
      <div class="section-head"><h2 class="section-title">Join Our Newsletter</h2></div>
      <div class="newsletter-card">
        <div class="newsletter-media">
          <div class="media" role="img" aria-label="Cafe interior photograph — placeholder"></div>
        </div>
        <div class="newsletter-body">
          <h2>Join our weekly newsletter &amp; be first to know when we add more cafes</h2>
          <div class="newsletter-form-block">
            <form class="inline-form" data-form="newsletter">
              <label class="field">
                <input type="email" name="email" placeholder="name@email.com" aria-label="Email address" autocomplete="email">
              </label>
              <button class="subscribe" type="submit">Subscribe</button>
            </form>
            <p class="small">Get cafe recommendations straight in your inbox!</p>
            <p class="note small" data-note></p>
          </div>
        </div>
      </div>
    </section>`;

const heroForm = () => `
          <div class="hero-form-block">
            <form class="inline-form" data-form="newsletter">
              <label class="field">
                <input type="email" name="email" placeholder="jane@email.com" aria-label="Email address" autocomplete="email">
              </label>
              <button class="subscribe" type="submit">Subscribe</button>
            </form>
            <p class="small">Get cafe recommendations straight in your inbox!</p>
            <p class="note small" data-note></p>
          </div>`;

/* ---- Page shell ------------------------------------------------------ */
const page = ({ title, description, mainClass, containerClass, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/assets/icon.png" type="image/png">
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/base.css">
<link rel="stylesheet" href="/styles/components.css">
<link rel="stylesheet" href="/styles/pages.css">
<script>
  try {
    var stored = localStorage.getItem("findmy815-theme");
    if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
  } catch (error) {}
</script>
</head>
<body>
<div class="app"><div class="page">
${header()}
  <main class="page-main ${mainClass}">
    <div class="container ${containerClass}">
${body}
    </div>
  </main>
${footer()}
</div></div>
<script src="/js/site.js"></script>
</body>
</html>
`;

/* ---- Routes ---------------------------------------------------------- */
const files = new Map();
const add = (routePath, html) => {
  const file = routePath.endsWith("/") ? join(routePath, "index.html") : routePath;
  files.set(file.replace(/^\//, ""), html);
};

/* Home */
add("/", page({
  title: `${APP} — find the best cafes near you`,
  description: "A curated directory of cafes: filter by category, location and style.",
  mainClass: "main-home",
  containerClass: "container--wide",
  body: `    <section class="hero">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-head">
            <h1 class="display">${chars("Discover the best cafes in New York.")}</h1>
            <p class="lede">A curated list of cafes - from hidden espresso bars to cozy brunch spots and late-night coffee havens.</p>
          </div>
${heroForm()}
        </div>
${featuredCard(CAFES[3])}
      </div>
    </section>

    <section class="listing">
      <div class="filter-row">
        <div class="filter-selects">
${select("All Categories", CATEGORIES, "categories")}
${select("All Locations", LOCATIONS, "locations")}
${select("All Themes", THEMES, "themes")}
        </div>
        <label class="search-field">
          ${searchIcon()}
          <input type="search" placeholder="Search cafes" aria-label="Search cafes" data-search-input>
        </label>
      </div>
      <div class="listing-grid">
${CAFES.slice(0, 12).map((cafe) => card(cafe)).join("\n")}
${CAFES.slice(12).map((cafe) => card(cafe, true)).join("\n")}
        <button class="load-more" type="button" data-load-more>Load More</button>
        <p class="empty-state" data-empty hidden>No cafes found. Check back later.</p>
      </div>
    </section>

    <section class="explore">
      <div class="explore-grid">
${["Explore by Category", "Explore by Location", "Explore by Style"].map((label, index) => exploreCard(label, ["/category/", "/location/", "/theme/"][index])).join("\n")}
${["Pet-friendly Cafes", "Brooklyn Cafes", "Modern Aesthetic Cafes"].map((label, index) => exploreCard(label, ["/category/pet-friendly/", "/location/brooklyn/", "/theme/modern/"][index])).join("\n")}
      </div>
    </section>

${newsletterWide()}`,
}));

/* About */
add("/about/", page({
  title: `About ${APP}`,
  description: `How ${APP} chooses and lists cafes.`,
  mainClass: "main-about",
  containerClass: "container--narrow",
  body: `    <section class="about-hero">
      <div class="about-head">
        <h1 class="display">${chars(`About ${APP}`)}</h1>
        <p class="about-sub">A directory, listing and curation template for independent cafes</p>
      </div>
      <div class="about-body">
        <p>${APP} helps you build a clean, modern directory in minutes. Whether you are showcasing landmarks such as cafes, creative portfolios, local favourites, or curated collections, the layout is designed to make everything look effortless and inviting.</p>
        <p>With built-in filtering, a fast static build, and flexible sections, your visitors can explore and discover content in a way that feels natural. Every element is designed with clarity and rhythm, keeping focus on what matters most - the content.</p>
        <p>Every listing is a real page here: twenty-four cafes, nine categories, nine neighbourhoods and nine styles, all navigable without a backend. Sample data is written to feel like a running directory rather than a demo screen.</p>
      </div>
      <div class="about-photo">
        <div class="media" role="img" aria-label="Cafe interior photograph — placeholder"></div>
      </div>
    </section>

    <section class="faq">
      <div class="section-head"><h2 class="section-title">Frequently Asked Questions:</h2></div>
      <div class="faq-list">
${[
    ["What can I use this directory for?", "Browsing cafes by category, neighbourhood or style, and rebuilding the same structure for another collection — bookshops, studios, or trails."],
    ["Do I need to know how to code?", "No. The pages are plain HTML and CSS. Change the data in tools/build-pages.mjs and re-run it to rebuild every route."],
    ["Can I add my cafe as a listing?", "Yes — use the Submit page. This build stores nothing, so submissions are shown as a confirmation only."],
    ["Is the directory responsive?", "Every route is laid out for wide, tablet and phone widths, and the dark palette is tuned separately for legibility."],
  ].map(([question, answer]) => `        <div class="faq-row">
          <button class="faq-question" type="button" aria-expanded="false">
            <p>${esc(question)}</p>
            <svg class="faq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <div class="faq-answer" hidden><p>${esc(answer)}</p></div>
        </div>`).join("\n")}
      </div>
      <p class="faq-more">Still have more questions? <a href="/contact/">Contact us</a></p>
    </section>

${newsletterNarrow()}`,
}));

/* Cafes index */
add("/cafes/", page({
  title: `All cafes — ${APP}`,
  description: "Every cafe in the directory, filterable by category, location and style.",
  mainClass: "main-category",
  containerClass: "container--wide",
  body: `    <section class="category-hero">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-head">
            <h1 class="display">${chars("Every cafe in the directory")}</h1>
            <p class="lede">${CAFES.length} rooms across ${LOCATIONS.length} neighbourhoods. Filter by category, style or neighbourhood.</p>
          </div>
${heroForm()}
        </div>
${featuredCard(CAFES[3])}
      </div>
    </section>

    <section class="category-listing">
      <div class="category-listing-inner">
      <div class="chip-row">
        <button class="chip chip--all" type="button" data-chip-reset>All <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
${CATEGORIES.map((category) => `        <a class="chip chip--pill" href="/category/${category.slug}/">${esc(category.label)}</a>`).join("\n")}
      </div>
      <div class="category-body">
${sidebar()}
        <div class="result-grid">
${CAFES.slice(0, 9).map((cafe) => card(cafe)).join("\n")}
${CAFES.slice(9).map((cafe) => card(cafe, true)).join("\n")}
          <button class="load-more" type="button" data-load-more>Load More</button>
          <p class="empty-state" data-empty hidden>No cafes found. Check back later.</p>
        </div>
      </div>
      </div>
    </section>

${newsletterWide()}`,
}));

/* Cafe detail pages */
CAFES.forEach((cafe, index) => {
  const previous = CAFES[(index - 1 + CAFES.length) % CAFES.length];
  const next = CAFES[(index + 1) % CAFES.length];
  add(`/cafes/${cafe.slug}/`, page({
    title: `${cafe.title} — ${APP}`,
    description: `${cafe.title}: ${cafe.sub} ${cafe.address}.`,
    mainClass: "main-cafe",
    containerClass: "container--narrow",
    body: `    <section class="cafe-hero">
      <div class="cafe-top">
        <div class="cafe-toolbar">
          <a class="back-pill" href="/cafes/">‹ All cafes</a>
          <div class="cafe-nav">
            <a href="/cafes/${previous.slug}/" aria-label="Previous cafe: ${esc(previous.title)}">‹</a>
            <a href="/cafes/${next.slug}/" aria-label="Next cafe: ${esc(next.title)}">›</a>
          </div>
        </div>
        <div class="cafe-title-row">
          <div class="cafe-headline">
            <h1 class="display">${chars(cafe.title)}</h1>
            <p class="cafe-sub">${esc(cafe.sub)}</p>
          </div>
          <a class="cta-yellow" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${cafe.title} ${cafe.address} New York`)}" target="_blank" rel="noopener">Get Directions ${arrowUpRight("cta-arrow")}</a>
        </div>
      </div>
      <div class="cafe-body">
        <div class="cafe-copy">
          <p>${esc(cafe.body[0])}</p>
          <p>${esc(cafe.body[1])}</p>
        </div>
        <div class="cafe-photo">
          <div class="media" role="img" aria-label="${esc(cafe.title)} photograph — placeholder"></div>
        </div>
      </div>
    </section>

    <section class="detail-card">
      <div class="detail-card-inner">
        <div class="map-panel"></div>
        <dl class="detail-list">
          <div class="detail-row">
            <dt>Category:</dt>
            <dd class="detail-values">${cafe.categories.map((label) => `<a href="/category/${byLabel(CATEGORIES, label).slug}/">${esc(label)}</a>`).join("")}</dd>
          </div>
          <div class="detail-row">
            <dt>Theme:</dt>
            <dd><a href="/theme/${byLabel(THEMES, cafe.theme).slug}/">${esc(cafe.theme)}</a></dd>
          </div>
          <div class="detail-row">
            <dt>Location:</dt>
            <dd><a href="/location/${byLabel(LOCATIONS, cafe.location).slug}/">${esc(cafe.location)}</a></dd>
          </div>
          <div class="detail-row">
            <dt>Address:</dt>
            <dd>${esc(cafe.address)}, New York, NY</dd>
          </div>
        </dl>
        <a class="map-pill" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${cafe.title} ${cafe.address} New York`)}" target="_blank" rel="noopener">Open in Maps ${arrowUpRight("map-arrow")}</a>
      </div>
    </section>

    <div class="cafe-cta">
      <a class="cta-yellow" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${cafe.title} ${cafe.address} New York`)}" target="_blank" rel="noopener">Get Directions ${arrowUpRight("cta-arrow")}</a>
    </div>

    <section class="cafe-recent">
      <div class="section-head"><h2 class="section-title">More ${esc(cafe.categories[0].toLowerCase())} cafes:</h2></div>
      <div class="listing-grid listing-grid--narrow">
${relatedTo(cafe).map((other) => card(other)).join("\n")}
      </div>
    </section>

${newsletterNarrow()}`,
  }));
});

/* Category, location and theme indexes plus their detail pages */
const facets = [
  { kind: "Category", plural: "Categories", base: "/category/", items: CATEGORIES, select: cafesInCategory, mainClass: "main-category", countLabel: "categories" },
  { kind: "Location", plural: "Locations", base: "/location/", items: LOCATIONS, select: cafesInLocation, mainClass: "main-category", countLabel: "neighbourhoods" },
  { kind: "Theme", plural: "Themes", base: "/theme/", items: THEMES, select: cafesInTheme, mainClass: "main-category", countLabel: "styles" },
];

for (const facet of facets) {
  add(facet.base, page({
    title: `Explore by ${facet.kind} — ${APP}`,
    description: `Browse the directory by ${facet.countLabel}.`,
    mainClass: facet.mainClass,
    containerClass: "container--wide",
    body: `    <section class="page-hero">
      <div class="page-head">
        <h1 class="display">${chars(`Explore by ${facet.kind}`)}</h1>
        <p class="lede">${facet.items.length} ${facet.countLabel}, each with its own listing.</p>
      </div>
    </section>

    <section class="index-section">
      <div class="index-grid">
${facet.items.map((item) => indexCard(
    facet.kind === "Category" ? item.label : facet.kind === "Location" ? `Cafes in ${item.label}` : `${item.label} cafes`,
    `${facet.base}${item.slug}/`,
    `${facet.select(item.label).length} ${facet.select(item.label).length === 1 ? "cafe" : "cafes"}`,
  )).join("\n")}
      </div>
    </section>

${newsletterWide()}`,
  }));

  facet.items.forEach((item) => {
    const matching = facet.select(item.label);
    const title = facet.kind === "Category" ? `Best ${item.label.toLowerCase()} cafes in New York`
      : facet.kind === "Location" ? `Best cafes in ${item.label}, New York`
        : `Best ${item.label.toLowerCase()} cafes in New York`;
    add(`${facet.base}${item.slug}/`, page({
      title: `${title} — ${APP}`,
      description: `${title}: ${matching.length} listings with categories, style and address.`,
      mainClass: facet.mainClass,
      containerClass: "container--wide",
      body: `    <section class="category-hero">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-head">
            <h1 class="display">${chars(title)}</h1>
            <p class="lede">${matching.length} ${matching.length === 1 ? "room" : "rooms"} in this list. Filter further below.</p>
          </div>
${heroForm()}
        </div>
${featuredCard(matching[0])}
      </div>
    </section>

    <section class="category-listing">
      <div class="category-listing-inner">
      <div class="chip-row">
        <button class="chip chip--all" type="button" data-chip-reset>All <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
${facet.items.map((entry) => `        <a class="chip chip--pill${entry.label === item.label ? " chip--active" : ""}" href="${facet.base}${entry.slug}/">${esc(entry.label)}</a>`).join("\n")}
      </div>
      <div class="category-body">
${sidebar(item.label, facet.kind === "Category" ? "categories" : facet.kind === "Location" ? "locations" : "themes")}
        <div class="result-grid">
${matching.map((cafe) => card(cafe)).join("\n")}
          <p class="empty-state" data-empty hidden>No cafes found. Check back later.</p>
        </div>
      </div>
      </div>
    </section>

${newsletterWide()}`,
    }));
  });
}

/* Blog index */
add("/blog/", page({
  title: `Blog — ${APP}`,
  description: "Notes on cafes, design and curation.",
  mainClass: "main-about",
  containerClass: "container--narrow",
  body: `    <section class="page-hero">
      <div class="page-head">
        <h1 class="display">${chars("Notes from the directory")}</h1>
        <p class="lede">Writing about rooms, curation and the small decisions that make a cafe worth the walk.</p>
      </div>
    </section>

    <section class="post-section">
      <div class="post-list">
${POSTS.map((post) => `        <a class="post-card" href="/blog/${post.slug}/">
          <div class="media" role="img" aria-label="Article photograph — placeholder"></div>
          <div>
            <h2>${esc(post.title)}</h2>
            <p>${esc(post.excerpt)}</p>
            <div class="post-meta"><span>${esc(post.date)}</span><span>${esc(post.read)}</span></div>
          </div>
        </a>`).join("\n")}
      </div>
    </section>

${newsletterNarrow()}`,
}));

/* Blog posts */
POSTS.forEach((post) => {
  add(`/blog/${post.slug}/`, page({
    title: `${post.title} — ${APP}`,
    description: post.excerpt,
    mainClass: "main-about",
    containerClass: "container--narrow",
    body: `    <article class="post-section">
      <div class="page-head">
        <a class="back-pill" href="/blog/">‹ All notes</a>
        <h1 class="display">${chars(post.title)}</h1>
        <p class="lede">${esc(post.excerpt)}</p>
        <div class="post-meta"><span>${esc(post.date)}</span><span>${esc(post.read)}</span></div>
      </div>
      <div class="post-cover">
        <div class="media" role="img" aria-label="Article photograph — placeholder"></div>
      </div>
      <div class="prose">
${post.body.map((paragraph) => `        <p>${esc(paragraph)}</p>`).join("\n")}
      </div>
    </article>

${newsletterNarrow()}`,
  }));
});

/* Submit */
add("/submit/", page({
  title: `Submit a cafe — ${APP}`,
  description: "Send a cafe in for review.",
  mainClass: "main-about",
  containerClass: "container--narrow",
  body: `    <section class="page-hero">
      <div class="page-head">
        <h1 class="display">${chars("Submit a cafe")}</h1>
        <p class="lede">Tell us about a room we should list. Every suggestion is read; this demo stores nothing.</p>
      </div>
    </section>

    <section class="form-section">
      <form class="form-card" data-form="submit">
        <div class="form-grid">
          <div class="form-row">
            <label for="submit-name">Cafe name</label>
            <input id="submit-name" name="name" required placeholder="Marble Fox Café">
          </div>
          <div class="form-row">
            <label for="submit-city">Neighbourhood</label>
            <select id="submit-city" name="location">
${LOCATIONS.map((location) => `              <option value="${esc(location.label)}">${esc(location.label)}</option>`).join("\n")}
            </select>
          </div>
          <div class="form-row">
            <label for="submit-category">Category</label>
            <select id="submit-category" name="category">
${CATEGORIES.map((category) => `              <option value="${esc(category.label)}">${esc(category.label)}</option>`).join("\n")}
            </select>
          </div>
          <div class="form-row">
            <label for="submit-theme">Style</label>
            <select id="submit-theme" name="theme">
${THEMES.map((theme) => `              <option value="${esc(theme.label)}">${esc(theme.label)}</option>`).join("\n")}
            </select>
          </div>
          <div class="form-row">
            <label for="submit-address">Address</label>
            <input id="submit-address" name="address" placeholder="41 Grand St, New York, NY">
          </div>
          <div class="form-row">
            <label for="submit-site">Website</label>
            <input id="submit-site" name="website" type="url" placeholder="https://example.com">
          </div>
        </div>
        <div class="form-row">
          <label for="submit-notes">What should we know?</label>
          <textarea id="submit-notes" name="notes" placeholder="What is the room like, what should we order, and when is the best time to come?"></textarea>
        </div>
        <div class="form-actions">
          <button class="button-primary" type="submit">Send suggestion</button>
          <p class="note small" data-note></p>
        </div>
      </form>
    </section>

${newsletterNarrow()}`,
}));

/* Contact */
add("/contact/", page({
  title: `Contact — ${APP}`,
  description: "How to reach the directory.",
  mainClass: "main-about",
  containerClass: "container--narrow",
  body: `    <section class="page-hero">
      <div class="page-head">
        <h1 class="display">${chars("Contact us")}</h1>
        <p class="lede">Corrections, suggestions and partnerships all land in the same inbox.</p>
      </div>
    </section>

    <section class="split">
      <dl class="contact-list">
        <div class="contact-row"><dt>Email</dt><dd>hello@findmy815.example</dd></div>
        <div class="contact-row"><dt>Instagram</dt><dd>@findmy815</dd></div>
        <div class="contact-row"><dt>Post</dt><dd>118 Mercer St, New York, NY 10012</dd></div>
        <div class="contact-row"><dt>Response time</dt><dd>Usually within two days. This build does not send anything.</dd></div>
      </dl>
      <form class="form-card" data-form="contact">
        <div class="form-row">
          <label for="contact-name">Your name</label>
          <input id="contact-name" name="name" required placeholder="Jane Doe">
        </div>
        <div class="form-row">
          <label for="contact-email">Email</label>
          <input id="contact-email" name="email" type="email" required placeholder="jane@email.com">
        </div>
        <div class="form-row">
          <label for="contact-message">Message</label>
          <textarea id="contact-message" name="message" required placeholder="What would you like us to fix or add?"></textarea>
        </div>
        <div class="form-actions">
          <button class="button-primary" type="submit">Send message</button>
          <p class="note small" data-note></p>
        </div>
      </form>
    </section>`,
}));

/* Legal pages */
for (const [slug, content] of Object.entries(LEGAL)) {
  add(`/legal/${slug}/`, page({
    title: `${content.title} — ${APP}`,
    description: content.title,
    mainClass: "main-about",
    containerClass: "container--narrow",
    body: `    <article class="page-hero">
      <div class="page-head">
        <h1 class="display">${chars(content.title)}</h1>
      </div>
      <div class="prose">
${content.paragraphs.map((paragraph) => `        <p>${esc(paragraph)}</p>`).join("\n")}
      </div>
    </article>

${newsletterNarrow()}`,
  }));
}

/* ---- Write ----------------------------------------------------------- */
/* Remove previously generated HTML so a renamed or dropped route cannot leave
   a stale page behind, then write every route from the map above. */
for (const folder of ["about", "cafes", "category", "location", "theme", "blog", "submit", "contact", "legal"]) {
  await rm(join(ROOT, folder), { recursive: true, force: true });
}
await rm(join(ROOT, "index.html"), { force: true });

const routes = [...files.keys()].sort();
for (const route of routes) {
  const target = join(ROOT, route);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, files.get(route));
}
await writeFile(join(ROOT, "routes.json"), `${JSON.stringify(routes.map((route) => `/${route.replace(/index\.html$/, "")}`), null, 2)}\n`);
console.log(`wrote ${routes.length} pages`);
for (const route of routes) console.log(`  /${route.replace(/index\.html$/, "")}`);
