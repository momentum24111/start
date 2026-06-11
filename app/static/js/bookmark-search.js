/** Globale Lesezeichen-Suche im Header. */

import { escapeHtml } from "./bookmark-views.js";
import { getBookmarkDisplayDomain } from "./bookmarks.js";

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 120;
const MAX_RESULTS = 80;

let deps = null;
let root = null;
let panel = null;
let input = null;
let resultsEl = null;
let toggleBtn = null;
let debounceTimer = null;
let currentResults = [];
let selectedIndex = -1;
let mobileQuery = null;

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function bookmarkSearchHaystack(bookmark) {
  return [
    bookmark?.title,
    bookmark?.description,
    bookmark?.domain,
    bookmark?.url,
    getBookmarkDisplayDomain(bookmark)
  ]
    .map((entry) => normalizeSearchText(entry))
    .filter(Boolean)
    .join(" ");
}

export function searchBookmarks(bookmarks, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < MIN_QUERY_LENGTH) return [];
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const matches = [];
  for (const bookmark of bookmarks || []) {
    if (!String(bookmark?.url || "").trim()) continue;
    const haystack = bookmarkSearchHaystack(bookmark);
    if (!haystack) continue;
    if (terms.every((term) => haystack.includes(term))) {
      matches.push(bookmark);
      if (matches.length >= MAX_RESULTS) break;
    }
  }
  return matches;
}

function bindResultThumb(image) {
  if (!(image instanceof HTMLImageElement)) return;
  const markLoaded = () => {
    image.classList.add("is-loaded");
    image.classList.remove("is-error");
  };
  const markError = () => {
    image.classList.add("is-error");
    image.classList.remove("is-loaded");
    if (!String(image.getAttribute("src") || "").trim()) {
      image.removeAttribute("src");
    }
  };
  image.addEventListener("load", markLoaded);
  image.addEventListener("error", markError);
  if (image.complete) {
    if (image.naturalWidth > 0) markLoaded();
    else markError();
  }
}

function renderResultThumb(bookmark) {
  const src = escapeHtml(deps.bookmarkStoredImageSrc(bookmark));
  return `
    <div class="bookmark-thumb bookmark-thumb--list bookmark-search-result__thumb">
      <img
        class="bookmark-thumb__img"
        src="${src}"
        alt=""
        loading="lazy"
        decoding="async"
        data-bookmark-thumb
      />
      <span class="bookmark-thumb__placeholder" aria-hidden="true">${deps.mdiIcon("bookmark-outline", "bookmark-thumb__placeholder-icon")}</span>
    </div>
  `;
}

function renderResultItem(bookmark, index) {
  const title = escapeHtml(bookmark.title || bookmark.url || "");
  const description = escapeHtml(bookmark.description || "");
  const domain = escapeHtml(getBookmarkDisplayDomain(bookmark));
  const selected = index === selectedIndex ? " is-active" : "";
  return `
    <button
      type="button"
      class="bookmark-search-result${selected}"
      role="option"
      aria-selected="${index === selectedIndex ? "true" : "false"}"
      data-search-result
      data-result-index="${index}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
    >
      ${renderResultThumb(bookmark)}
      <span class="bookmark-search-result__main">
        <span class="bookmark-search-result__title">${title}</span>
        ${description ? `<span class="bookmark-search-result__description">${description}</span>` : ""}
        ${domain ? `<span class="bookmark-search-result__domain">${domain}</span>` : ""}
      </span>
    </button>
  `;
}

function isMobileLayout() {
  return Boolean(mobileQuery?.matches);
}

function setMobileOpen(open) {
  root?.classList.toggle("is-mobile-open", open);
  toggleBtn?.setAttribute("aria-expanded", open ? "true" : "false");
}

function resetSelection() {
  selectedIndex = -1;
}

function closeSearch({ clearInput = true, keepMobileOpen = false } = {}) {
  if (clearInput && input) input.value = "";
  currentResults = [];
  resetSelection();
  resultsEl?.classList.add("hidden");
  resultsEl?.replaceChildren();
  if (!keepMobileOpen) {
    setMobileOpen(false);
  }
}

function openBookmarkAt(index, { newTab = false } = {}) {
  const bookmark = currentResults[index];
  if (!bookmark) return;
  deps.openBookmark(bookmark, { newTab });
  closeSearch({ clearInput: true });
  input?.blur();
}

function scrollActiveResultIntoView() {
  const active = resultsEl?.querySelector(".bookmark-search-result.is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function renderResults() {
  if (!resultsEl || !input) return;
  const query = input.value;
  currentResults = searchBookmarks(deps.getBookmarks(), query);
  resetSelection();

  if (normalizeSearchText(query).length < MIN_QUERY_LENGTH) {
    resultsEl.classList.add("hidden");
    resultsEl.replaceChildren();
    return;
  }

  if (!currentResults.length) {
    resultsEl.classList.remove("hidden");
    resultsEl.innerHTML = `<p class="bookmark-search-results__empty">${escapeHtml(deps.t("ui.searchNoResults"))}</p>`;
    return;
  }

  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = currentResults
    .map((bookmark, index) => renderResultItem(bookmark, index))
    .join("");

  resultsEl.querySelectorAll("[data-bookmark-thumb]").forEach((image) => {
    bindResultThumb(image);
  });

  resultsEl.querySelectorAll("[data-search-result]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const index = Number(button.getAttribute("data-result-index"));
      openBookmarkAt(index, { newTab: false });
    });
    button.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      const index = Number(button.getAttribute("data-result-index"));
      openBookmarkAt(index, { newTab: true });
    });
    button.addEventListener("mouseenter", () => {
      selectedIndex = Number(button.getAttribute("data-result-index"));
      resultsEl.querySelectorAll("[data-search-result]").forEach((entry) => {
        const active = Number(entry.getAttribute("data-result-index")) === selectedIndex;
        entry.classList.toggle("is-active", active);
        entry.setAttribute("aria-selected", active ? "true" : "false");
      });
    });
  });
}

function scheduleSearch() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    renderResults();
  }, DEBOUNCE_MS);
}

function moveSelection(delta) {
  if (!currentResults.length) return;
  if (selectedIndex < 0) {
    selectedIndex = delta > 0 ? 0 : currentResults.length - 1;
  } else {
    selectedIndex = (selectedIndex + delta + currentResults.length) % currentResults.length;
  }
  resultsEl?.querySelectorAll("[data-search-result]").forEach((entry) => {
    const active = Number(entry.getAttribute("data-result-index")) === selectedIndex;
    entry.classList.toggle("is-active", active);
    entry.setAttribute("aria-selected", active ? "true" : "false");
  });
  scrollActiveResultIntoView();
}

function onInputKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSearch({ clearInput: true });
    input?.blur();
    return;
  }
  if (!currentResults.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
    return;
  }
  if (event.key === "Enter") {
    if (selectedIndex < 0) {
      if (currentResults.length) {
        event.preventDefault();
        openBookmarkAt(0);
      }
      return;
    }
    event.preventDefault();
    openBookmarkAt(selectedIndex, { newTab: false });
  }
}

function onDocumentPointerDown(event) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (root?.contains(target)) return;
  if (toggleBtn?.contains(target)) return;
  closeSearch({ clearInput: false, keepMobileOpen: false });
}

function onInputBlur() {
  window.setTimeout(() => {
    const active = document.activeElement;
    if (root?.contains(active) || toggleBtn === active) return;
    closeSearch({ clearInput: false, keepMobileOpen: false });
  }, 0);
}

function refreshTexts() {
  if (!deps || !input) return;
  const label = deps.t("ui.search");
  input.setAttribute("aria-label", label);
  input.setAttribute("placeholder", deps.t("ui.searchPlaceholder"));
  resultsEl?.setAttribute("aria-label", deps.t("ui.searchResults"));
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.setAttribute("title", label);
  }
}

export function refreshBookmarkSearchTexts() {
  refreshTexts();
}

export function initBookmarkSearch(options) {
  deps = options;
  root = document.getElementById("bookmark-search-root");
  panel = document.getElementById("bookmark-search-panel");
  input = document.getElementById("bookmark-search-input");
  resultsEl = document.getElementById("bookmark-search-results");
  toggleBtn = document.getElementById("bookmark-search-toggle");
  if (!(root instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(resultsEl instanceof HTMLElement)) {
    return;
  }

  mobileQuery = window.matchMedia("(max-width: 768px)");
  mobileQuery.addEventListener("change", () => {
    if (!isMobileLayout()) setMobileOpen(false);
  });

  refreshTexts();

  input.addEventListener("input", () => {
    const query = normalizeSearchText(input.value);
    if (!query) {
      closeSearch({ clearInput: false, keepMobileOpen: isMobileLayout() });
      return;
    }
    scheduleSearch();
  });

  input.addEventListener("keydown", onInputKeydown);
  input.addEventListener("blur", onInputBlur);

  toggleBtn?.addEventListener("click", () => {
    const open = !root.classList.contains("is-mobile-open");
    setMobileOpen(open);
    if (open) {
      input.focus();
      input.select();
    } else {
      closeSearch({ clearInput: true });
    }
  });

  document.addEventListener("pointerdown", onDocumentPointerDown);
}
