/*
 * FindMy815 behaviour: theme toggle, mobile menu, listing filters, load more,
 * FAQ rows and local-only forms. No framework, no build step.
 */
(() => {
  const root = document.documentElement;
  const STORAGE_KEY = "findmy815-theme";

  /* ---- Theme ---------------------------------------------------------- */
  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function effectiveTheme() {
    const stored = storedTheme();
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");
    const dark = effectiveTheme() === "dark";
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const next = effectiveTheme() === "dark" ? "light" : "dark";
      try { localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* private mode */ }
      applyTheme(next);
    });
  }
  applyTheme(storedTheme());

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!storedTheme()) applyTheme(null);
    });
  }

  /* ---- Mobile menu ---------------------------------------------------- */
  const menuButton = document.querySelector("[data-menu]");
  if (menuButton) {
    menuButton.addEventListener("click", () => {
      const open = document.body.classList.toggle("menu-open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
  }

  /* ---- Listing filters ------------------------------------------------ */
  const cards = [...document.querySelectorAll("[data-card]")];
  const searchInputs = [...document.querySelectorAll("[data-search-input]")];
  const emptyStates = [...document.querySelectorAll("[data-empty]")];
  const loadMore = document.querySelector("[data-load-more]");
  const baseCards = cards.filter((card) => !card.hasAttribute("data-more"));
  const moreCards = cards.filter((card) => card.hasAttribute("data-more"));
  const BATCH = 6;
  let extraShown = 0;

  const normalized = (value) => String(value ?? "").toLowerCase().trim();

  function activeFilters() {
    const filters = [];
    for (const node of document.querySelectorAll("[data-filter-checkbox]")) {
      if (node.checked) filters.push({ kind: node.dataset.kind, value: node.value });
    }
    for (const node of document.querySelectorAll("[data-filter]")) {
      if (node.value) filters.push({ kind: node.dataset.kind, value: node.value });
    }
    return filters;
  }

  function matchesFilters(card, filters) {
    return filters.every((filter) => {
      const raw = card.dataset[filter.kind] ?? "";
      return raw.split("|").map(normalized).includes(normalized(filter.value));
    });
  }

  function matchesSearch(card, terms) {
    if (!terms.length) return true;
    const haystack = normalized(card.dataset.search);
    return terms.every((term) => haystack.includes(term));
  }

  function applyFilters() {
    if (!cards.length) return;
    const terms = searchInputs.map((input) => normalized(input.value)).filter(Boolean);
    const filters = activeFilters();
    let shown = 0;

    for (const card of baseCards) {
      const visible = matchesFilters(card, filters) && matchesSearch(card, terms);
      card.hidden = !visible;
      if (visible) shown += 1;
    }

    let matchingMore = 0;
    let revealed = 0;
    moreCards.forEach((card, index) => {
      const visible = matchesFilters(card, filters) && matchesSearch(card, terms);
      if (!visible) {
        card.hidden = true;
        return;
      }
      matchingMore += 1;
      if (index < extraShown) {
        card.hidden = false;
        revealed += 1;
        shown += 1;
      } else {
        card.hidden = true;
      }
    });

    if (loadMore) loadMore.hidden = matchingMore === 0 || revealed >= matchingMore;
    for (const node of emptyStates) node.hidden = shown > 0;
  }

  for (const input of searchInputs) {
    input.addEventListener("input", () => {
      extraShown = 0;
      applyFilters();
    });
  }
  for (const node of document.querySelectorAll("[data-filter], [data-filter-checkbox]")) {
    node.addEventListener("change", () => {
      extraShown = 0;
      applyFilters();
    });
  }
  if (loadMore) {
    loadMore.addEventListener("click", () => {
      extraShown += BATCH;
      applyFilters();
    });
  }

  const chipReset = document.querySelector("[data-chip-reset]");
  if (chipReset) {
    chipReset.addEventListener("click", () => {
      for (const input of searchInputs) input.value = "";
      for (const node of document.querySelectorAll("[data-filter]")) node.value = "";
      for (const node of document.querySelectorAll("[data-filter-checkbox]")) node.checked = false;
      extraShown = 0;
      applyFilters();
    });
  }

  applyFilters();

  /* ---- FAQ rows ------------------------------------------------------- */
  for (const button of document.querySelectorAll(".faq-question")) {
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!open));
      const answer = button.parentElement.querySelector(".faq-answer");
      if (answer) answer.hidden = open;
    });
  }

  /* ---- Forms are local only ------------------------------------------- */
  for (const form of document.querySelectorAll("[data-form]")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const note = form.parentElement.querySelector("[data-note]");
      if (!note) return;
      note.textContent = form.dataset.form === "submit"
        ? "Thanks — your cafe was queued for review. This is a local demo, so nothing was sent."
        : "Thanks — this is a local demo, so nothing was sent.";
      note.setAttribute("data-visible", "");
    });
  }
})();
