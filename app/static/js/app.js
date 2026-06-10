import { api } from "./api.js";
import { showModal, showStatusModal } from "./modal.js";
import { initI18n, t } from "./i18n.js";
import { applyTheme } from "./themes.js";
import {
  normalizeConfig,
  normalizeCategoryType,
  normalizeCategorySlots,
  normalizeIframeUrl,
  normalizeBookmarkSource,
  DEFAULT_BOOKMARK_SOURCE,
  FAVORITES_CATEGORY_ID,
  getBookmarksForCategory,
  getBookmarksForSidebarCategory,
  getBookmarkHomepageCategoryId,
  getBookmarkSidebarPlacementIds,
  findBookmarkById,
  findSidebarCategoryById,
  ensureBookmarkInCategoryOrder,
  ensureBookmarkInSidebarCategoryOrder,
  removeBookmarkFromCategoryOrder,
  removeBookmarkFromSidebarCategoryOrder,
  removeCategoryFromConfig,
  removeBookmarkFromConfig,
  listBookmarkListCategories,
  listSidebarCategories,
  allocateSidebarCategorySlug,
  getHomepageCategories
} from "./bookmarks.js";
import {
  NAV_ALL,
  VIEW_LIST,
  VIEW_CARDS,
  SYSTEM_NAV_ITEMS,
  normalizeNavViewModes,
  normalizeActiveNavId,
  getNavViewMode,
  setNavViewMode,
  getSidebarCategories,
  getBookmarksForNav,
  getBookmarkCountForNav,
  findCategoryById,
  resolveActiveNavId,
  resolveNavIdFromHash,
  navIdToHash,
  parseNavIdFromHash,
  normalizeNavHash,
  shouldShowCategoryGrid,
  isValidNavId,
  isCategoryNavId
} from "./navigation.js";
import {
  normalizeBookmarkView,
  bookmarksContainerClass,
  createBookmarkElement,
  ensureBookmarkMenuDismiss,
  escapeHtml
} from "./bookmark-views.js";

const EDIT_MODE_URL_KEY = "edit";
let editModeHistoryPushed = false;

const state = {
  config: {
    schemaVersion: 2,
    categories: [],
    sidebarCategories: [],
    bookmarks: [],
    categoryBookmarkOrder: {},
    sidebarCategoryBookmarkOrder: {}
  },
  settings: {
    appTitle: "Start",
    theme: "dark",
    language: "en",
    categoryAccentStrength: 15,
    elementSize: "medium",
    globalShortcuts: {},
    activeNavId: NAV_ALL,
    navViewModes: {}
  },
  editMode: false,
  sidebarOpen: false,
  sidebarCategoryDraft: false,
  editModeCollapsedSnapshot: null,
  /** Ephemeral UI overrides for normal mode only; never persisted. Absent key means use `category.collapsed`. */
  sessionCategoryCollapsed: {},
  undoStack: [],
  themes: [],
  languages: [],
  faviconLoading: false
};

function categoryEffectiveCollapsed(category) {
  if (state.editMode) return false;
  if (Object.hasOwn(state.sessionCategoryCollapsed, category.id)) {
    return Boolean(state.sessionCategoryCollapsed[category.id]);
  }
  return Boolean(category.collapsed);
}

const elements = {
  title: document.getElementById("app-title"),
  categories: document.getElementById("categories"),
  navView: document.getElementById("nav-view"),
  addCategory: document.getElementById("add-category-btn"),
  undo: document.getElementById("undo-btn"),
  edit: document.getElementById("edit-btn"),
  settings: document.getElementById("settings-btn"),
  navToggle: document.getElementById("nav-toggle-btn"),
  sidebar: document.getElementById("sidebar"),
  sidebarSystem: document.getElementById("sidebar-system"),
  sidebarCategories: document.getElementById("sidebar-categories")
};

const ICONS = {
  undo: "M12 5v4L7 4l5-5v4c5.5 0 10 4.5 10 10a10 10 0 0 1-10 10H7v-2h5a8 8 0 1 0 0-16z",
  edit: "M4 16.25V20h3.75L18.81 8.94l-3.75-3.75L4 16.25zm15.71-9.04a1 1 0 0 0 0-1.41l-1.51-1.51a1 1 0 0 0-1.41 0l-1.12 1.12 3.75 3.75 1.29-1.95z",
  done: "M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z",
  settings: "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a6.9 6.9 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z",
  trash: "M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z",
  plus: "M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z",
  chevron: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  arrowLeft: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  arrowRight: "m8.59 16.59 1.41 1.41L16 12 10 6 8.59 7.41 13.17 12z",
  arrowUp: "M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z",
  arrowDown: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  restart: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  menu: "M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z",
  viewList: "M3 5h18v2H3V5m0 6h18v2H3v-2m0 6h18v2H3v-2z",
  viewCards: "M3 5h8v8H3V5m10 0h8v4H13V5m0 6h8v8H13v-8M3 13h8v6H3v-6z",
  open: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  dotsVertical: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
};

const FALLBACK_MDI_ICON = "folder";
const MDI_INDEX_PATH = "/static/assets/icons/mdi-index.json";
const mdiRegistry = {
  loaded: false,
  list: [],
  byName: new Set(),
  searchPool: []
};
const COLOR_OPTIONS = ["primary", "teal", "blue", "violet", "amber", "pink", "indigo", "emerald", "orange", "slate"];

const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  const randomPart = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}${randomPart}`.slice(0, 8);
};
const deepClone = (v) => JSON.parse(JSON.stringify(v));

/** Same-origin icon paths must not be document-relative (e.g. under /photos/), or the browser resolves them against the page path. */
function resolveServiceIconDisplaySrc(raw) {
  const t = String(raw ?? "").trim();
  if (!t) {
    return new URL("/static/assets/icons/default.svg", window.location.origin).href;
  }
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  if (t.startsWith("//")) {
    return `${window.location.protocol}${t}`;
  }
  const path = t.startsWith("/") ? t : `/${t}`;
  return new URL(path, window.location.origin).href;
}

/** Normalize app-internal cache path from API or config (always root-absolute, never document-relative). */
function normalizeAppIconPath(raw) {
  const t = String(raw ?? "").trim();
  if (!t || /^https?:\/\//i.test(t) || t.startsWith("//")) {
    return t;
  }
  return t.startsWith("/") ? t : `/${t}`;
}

function isProbablyExternalIconHref(raw) {
  const t = String(raw ?? "").trim();
  return /^https?:\/\//i.test(t) || t.startsWith("//");
}

/** Never use cross-origin http(s) as <img src> (CORP / NotSameOrigin). Same-origin paths or default only. */
function resolveIconSrcForImgTag(raw) {
  return resolveServiceIconDisplaySrc(raw);
}

function resolveBookmarkPreviewSrc(raw) {
  const image = String(raw ?? "").trim();
  if (!image) return resolveIconSrcForImgTag("");
  if (isProbablyExternalIconHref(image)) {
    if (image.startsWith("//")) return `${window.location.protocol}${image}`;
    return image;
  }
  return resolveIconSrcForImgTag(normalizeAppIconPath(image));
}

function bookmarkStoredImageSrc(bookmark) {
  if (!bookmark) return resolveIconSrcForImgTag("");
  return resolveBookmarkPreviewSrc(bookmark.image);
}

function normalizeBookmarkImageValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (isProbablyExternalIconHref(value)) return value;
  return normalizeAppIconPath(value);
}

const RESTART_POLL_MS = 2000;
const RESTART_WAIT_MS = 120_000;
const RESTART_OK_WITHOUT_DOWN_MS = 12_000;
const DEFAULT_CATEGORY_ACCENT_STRENGTH = 15;
const ELEMENT_SIZE_OPTIONS = ["small", "medium", "large"];
const DEFAULT_ELEMENT_SIZE = "medium";
const CATEGORY_SLOT_OPTIONS = [1, 2, 3];
const DEFAULT_CATEGORY_SLOTS = 1;
const CATEGORY_TYPE_OPTIONS = ["service-list", "iframe"];
const DEFAULT_CATEGORY_TYPE = "service-list";
const BOOKMARK_SOURCE_LABEL_KEYS = {
  manual: "ui.sourceManual",
  "browser-import": "ui.sourceBrowserImport"
};
const SHORTCUT_VALID_KEY_REGEX = /^(?:[A-Z0-9]|F[1-9]|F1[0-2])$/;
const RESERVED_SHORTCUTS = new Set([
  "Ctrl+T",
  "Ctrl+W",
  "Ctrl+L",
  "Ctrl+R",
  "Ctrl+F",
  "F5"
]);
const GLOBAL_SHORTCUT_ACTIONS = [
  { id: "undo", labelKey: "ui.undo" },
  { id: "toggleEditMode", labelKey: "ui.editMode" },
  { id: "openSettings", labelKey: "ui.openSettings" }
];

function normalizeServiceShortcut(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  const parts = text
    .split("+")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const key = parts[parts.length - 1].toUpperCase();
  if (!SHORTCUT_VALID_KEY_REGEX.test(key)) return "";
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const ordered = [];
  if (modifiers.has("ctrl")) ordered.push("Ctrl");
  if (modifiers.has("alt")) ordered.push("Alt");
  if (modifiers.has("shift")) ordered.push("Shift");
  return [...ordered, key].join("+");
}

function interpolateLabel(template, values = {}) {
  let text = String(template || "");
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return text;
}

function normalizeGlobalShortcuts(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const action of GLOBAL_SHORTCUT_ACTIONS) {
    normalized[action.id] = normalizeServiceShortcut(source[action.id]);
  }
  return normalized;
}

function normalizeBrowserSyncSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const parsedInterval = Number(source.syncIntervalHours);
  return {
    enabled: Boolean(source.enabled),
    githubFileUrl: String(source.githubFileUrl || "").trim(),
    githubPat: String(source.githubPat || "").trim(),
    syncIntervalHours: Number.isFinite(parsedInterval)
      ? Math.min(168, Math.max(1, parsedInterval))
      : 6
  };
}

function getGlobalShortcutLabel(actionId) {
  const action = GLOBAL_SHORTCUT_ACTIONS.find((entry) => entry.id === actionId);
  if (!action) return actionId;
  return t(action.labelKey);
}

function shortcutFromKeyboardEvent(event) {
  if (event.metaKey) return "";
  let key = String(event.key || "").toUpperCase();
  if (!SHORTCUT_VALID_KEY_REGEX.test(key)) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function shortcutTokens(shortcut) {
  const normalized = normalizeServiceShortcut(shortcut);
  if (!normalized) return [];
  const lang = state.settings.language === "de" ? "de" : "en";
  return normalized.split("+").map((token) => {
    if (token === "Ctrl") return lang === "de" ? "Strg" : "Ctrl";
    if (token === "Shift") return "Shift";
    if (token === "Alt") return "Alt";
    return token;
  });
}

function renderShortcutChips(shortcut, className = "shortcut-chip") {
  const tokens = shortcutTokens(shortcut);
  if (!tokens.length) return "";
  return tokens.map((token) => `<span class="${className}">${token}</span>`).join("");
}

function findBookmarkByShortcut(shortcut, skipBookmarkId = "") {
  const normalized = normalizeServiceShortcut(shortcut);
  if (!normalized) return null;
  for (const bookmark of state.config.bookmarks || []) {
    if (skipBookmarkId && bookmark.id === skipBookmarkId) continue;
    if (normalizeServiceShortcut(bookmark.shortcut) === normalized) {
      return { bookmark };
    }
  }
  return null;
}

function findShortcutUsage(shortcut, { skipBookmarkId = "", skipGlobalAction = "" } = {}) {
  const normalized = normalizeServiceShortcut(shortcut);
  if (!normalized) return null;
  for (const bookmark of state.config.bookmarks || []) {
    if (skipBookmarkId && bookmark.id === skipBookmarkId) continue;
    if (normalizeServiceShortcut(bookmark.shortcut) === normalized) {
      return { type: "bookmark", bookmarkTitle: bookmark.title || t("ui.bookmark"), bookmarkId: bookmark.id };
    }
  }
  const globalShortcuts = normalizeGlobalShortcuts(state.settings.globalShortcuts);
  for (const action of GLOBAL_SHORTCUT_ACTIONS) {
    if (skipGlobalAction && action.id === skipGlobalAction) continue;
    if (normalizeServiceShortcut(globalShortcuts[action.id]) === normalized) {
      return { type: "global", actionId: action.id, actionLabel: getGlobalShortcutLabel(action.id) };
    }
  }
  return null;
}

function getShortcutConflictMessage(usage) {
  if (!usage) return "";
  if (usage.type === "bookmark") {
    return interpolateLabel(t("ui.shortcutConflictBookmark"), { name: usage.bookmarkTitle });
  }
  return interpolateLabel(t("ui.shortcutConflictAction"), { name: usage.actionLabel });
}

function isReservedShortcut(shortcut) {
  return RESERVED_SHORTCUTS.has(normalizeServiceShortcut(shortcut));
}

function isBlockingFocusTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest(".modal-overlay")) return true;
  if (target.closest("[data-shortcut-capture]")) return true;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  return false;
}

function triggerBookmarkLaunch(bookmarkId) {
  const tile = document.querySelector(`.bookmark-item[data-bookmark-id="${bookmarkId}"] [data-bookmark-open]`);
  if (!(tile instanceof HTMLAnchorElement)) return;
  tile.click();
}

function createBookmarkUiDeps() {
  return {
    button,
    iconSvg,
    mdiIcon,
    bookmarkStoredImageSrc,
    renderShortcutChips,
    icons: ICONS
  };
}

function resolveBookmarkModalCategoryId(bookmark, category) {
  if (category?.id) return category.id;
  const fromBookmark = (bookmark.categoryIds || []).find((id) => findCategoryById(state.config, id));
  if (fromBookmark) return fromBookmark;
  return listBookmarkListCategories(state.config)[0]?.id || "";
}

function getBookmarkReorderState(category, bookmark) {
  if (!category?.id) {
    return { canMoveLeft: false, canMoveRight: false };
  }
  let bookmarks;
  if (isCategoryNavId(state.config, category.id)) {
    bookmarks = getBookmarksForSidebarCategory(state.config, category.id);
  } else if (findCategoryById(state.config, category.id)) {
    bookmarks = getBookmarksForCategory(state.config, category.id);
  } else {
    return { canMoveLeft: false, canMoveRight: false };
  }
  const bookmarkIndex = bookmarks.findIndex((entry) => entry.id === bookmark.id);
  return {
    canMoveLeft: bookmarkIndex > 0,
    canMoveRight: bookmarkIndex >= 0 && bookmarkIndex < bookmarks.length - 1
  };
}

async function confirmDeleteBookmark(bookmark) {
  let confirmed = false;
  const body = document.createElement("p");
  body.textContent = interpolateLabel(t("ui.deleteBookmarkConfirm"), {
    title: bookmark.title || t("ui.bookmark")
  });
  await showModal({
    title: t("ui.delete"),
    content: body,
    saveLabel: t("ui.delete"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed;
}

async function handleDeleteBookmark(bookmark) {
  const confirmed = await confirmDeleteBookmark(bookmark);
  if (!confirmed) return;
  pushUndo();
  removeBookmarkFromConfig(state.config, bookmark.id);
  await persistConfig();
  render();
}

function setBookmarkMetadataLoading(item, loading) {
  if (!(item instanceof HTMLElement)) return;
  item.classList.toggle("is-reloading-metadata", loading);
  const overlay = item.querySelector("[data-bookmark-loading]");
  overlay?.classList.toggle("hidden", !loading);
  item.querySelector("[data-bookmark-menu-trigger]")?.toggleAttribute("disabled", loading);
}

async function applyBookmarkMetadata(bookmarkId, { item = null, pushUndoOnChange = true } = {}) {
  const bookmark = findBookmarkById(state.config, bookmarkId);
  if (!bookmark?.url) return false;
  if (item instanceof HTMLElement && item.classList.contains("is-reloading-metadata")) return false;
  if (item instanceof HTMLElement) setBookmarkMetadataLoading(item, true);
  try {
    const metadata = await api.fetchBookmarkMetadata(bookmark.url);
    if (pushUndoOnChange) pushUndo();
    if (metadata.title) bookmark.title = String(metadata.title).trim();
    bookmark.description = String(metadata.description || "").trim();
    if (metadata.image) bookmark.image = String(metadata.image).trim();
    await persistConfig();
    render();
    return true;
  } catch {
    if (item instanceof HTMLElement) {
      const feedback = document.createElement("div");
      feedback.className = "bookmark-item__feedback";
      feedback.textContent = t("ui.reloadBookmarkMetadataFailed");
      item.append(feedback);
      window.setTimeout(() => feedback.remove(), 3200);
    }
    return false;
  } finally {
    if (item instanceof HTMLElement) setBookmarkMetadataLoading(item, false);
  }
}

function createBookmarkElementForBookmark(bookmark, category, view, { homepage = false } = {}) {
  const categoryContext = category || { id: resolveBookmarkModalCategoryId(bookmark, category) };
  const reorder = getBookmarkReorderState(category, bookmark);
  const normalizedView = normalizeBookmarkView(view);
  return createBookmarkElement(
    {
      category: categoryContext,
      bookmark,
      view: normalizedView,
      homepage,
      navList: !homepage,
      editMode: state.editMode,
      config: state.config,
      hasShortcut: Boolean(normalizeServiceShortcut(bookmark.shortcut)),
      canMoveLeft: reorder.canMoveLeft,
      canMoveRight: reorder.canMoveRight
    },
    {
      ...createBookmarkUiDeps(),
      onEdit: () => openBookmarkModal({ bookmark }),
      onDelete: () => {
        void handleDeleteBookmark(bookmark);
      },
      onMoveLeft: reorder.canMoveLeft
        ? () => {
            void swapBookmarkByStep(categoryContext.id, bookmark.id, -1);
          }
        : undefined,
      onMoveRight: reorder.canMoveRight
        ? () => {
            void swapBookmarkByStep(categoryContext.id, bookmark.id, 1);
          }
        : undefined,
      onReloadMetadata: (item) => {
        void applyBookmarkMetadata(bookmark.id, { item });
      }
    }
  );
}

function getGlobalShortcut(actionId) {
  const shortcuts = normalizeGlobalShortcuts(state.settings.globalShortcuts);
  return normalizeServiceShortcut(shortcuts[actionId]);
}

function formatShortcutForTooltip(shortcut) {
  const tokens = shortcutTokens(shortcut);
  if (!tokens.length) return "";
  return tokens.join(" + ");
}

function runGlobalShortcutAction(actionId) {
  if (actionId === "undo") {
    void undo();
    return;
  }
  if (actionId === "toggleEditMode") {
    elements.edit.click();
    return;
  }
  if (actionId === "openSettings") {
    openSettingsModal();
  }
}

function normalizeCategoryAccentStrength(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CATEGORY_ACCENT_STRENGTH;
  const clamped = Math.min(100, Math.max(0, parsed));
  return Math.round(clamped / 5) * 5;
}

function applyCategoryAccentStrength(strength) {
  const normalized = normalizeCategoryAccentStrength(strength);
  document.body.style.setProperty("--category-accent-strength", `${normalized}%`);
}

function normalizeElementSize(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ELEMENT_SIZE_OPTIONS.includes(normalized) ? normalized : DEFAULT_ELEMENT_SIZE;
}

function isValidIframeUrl(value) {
  const v = normalizeIframeUrl(value);
  if (!v) return false;
  if (v.startsWith("//")) return true;
  if (v.startsWith("/")) return true;
  return /^https?:\/\//i.test(v);
}

function resolveIframeSrc(raw) {
  const v = normalizeIframeUrl(raw);
  if (!v) return "";
  if (v.startsWith("//")) return `${window.location.protocol}${v}`;
  if (v.startsWith("/")) return new URL(v, window.location.origin).href;
  return v;
}

function applyElementSize(size) {
  const normalized = normalizeElementSize(size);
  document.body.dataset.elementSize = normalized;
}

async function waitForAppReadyAfterRestart() {
  const started = Date.now();
  let sawDown = false;
  while (Date.now() - started < RESTART_WAIT_MS) {
    await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
    let ok = false;
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      ok = res.ok;
    } catch {
      sawDown = true;
      continue;
    }
    if (!ok) {
      sawDown = true;
      continue;
    }
    if (sawDown || Date.now() - started >= RESTART_OK_WITHOUT_DOWN_MS) {
      location.reload();
      return;
    }
  }
  throw new Error("restart wait timeout");
}

function restartStatusContent() {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="restart-status">
      <span class="spinner" aria-hidden="true"></span>
      <p>${t("ui.restartingAppMessage")}</p>
    </div>
  `;
  return body;
}

function restartErrorContent(message) {
  const body = document.createElement("div");
  body.innerHTML = `<p>${message}</p><button type="button" class="btn">${t("ui.reloadPage")}</button>`;
  body.querySelector("button").addEventListener("click", () => location.reload());
  return body;
}

async function runAppRestartFromSettings() {
  showStatusModal({ content: restartStatusContent() });
  try {
    await api.restartApp();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    showStatusModal({
      content: restartErrorContent(`${t("ui.restartAppFailed")} ${detail}`)
    });
    return;
  }
  try {
    await waitForAppReadyAfterRestart();
  } catch {
    showStatusModal({
      content: restartErrorContent(t("ui.restartAppTimeout"))
    });
  }
}
const mdiPath = (name) => `/static/assets/icons/mdi/${name}.svg`;

function normalizeMdiIconName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (mdiRegistry.byName.has(normalized)) return normalized;
  return FALLBACK_MDI_ICON;
}

function mdiIcon(name, extraClass = "") {
  const normalizedName = normalizeMdiIconName(name);
  const classes = ["mdi-icon", extraClass].filter(Boolean).join(" ");
  return `<span class="${classes}" style="--mdi-icon-url:url('${mdiPath(normalizedName)}');" aria-hidden="true"></span>`;
}

function getMdiSearchResults(query, limit = 24) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return mdiRegistry.list.slice(0, limit).map((entry) => ({ icon: entry.name, label: entry.name }));
  }
  const matches = [];
  for (const entry of mdiRegistry.searchPool) {
    if (entry.search.includes(normalizedQuery)) {
      matches.push({ icon: entry.name, label: entry.name });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

async function loadMdiRegistry() {
  if (mdiRegistry.loaded) return;
  const response = await fetch(MDI_INDEX_PATH, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load local MDI index (${response.status})`);
  }
  const payload = await response.json();
  const rawIcons = Array.isArray(payload?.icons) ? payload.icons : [];
  const mapped = rawIcons
    .map((entry) => {
      const name = String(entry?.name || "").trim().toLowerCase();
      if (!name) return null;
      const keywords = Array.isArray(entry?.keywords)
        ? entry.keywords.map((keyword) => String(keyword || "").trim().toLowerCase()).filter(Boolean)
        : [];
      return { name, search: [name, ...keywords].join(" ") };
    })
    .filter(Boolean);
  mdiRegistry.list = mapped;
  mdiRegistry.byName = new Set(mapped.map((entry) => entry.name));
  mdiRegistry.searchPool = mapped;
  mdiRegistry.loaded = true;
}

function iconSvg(path, extraClass = "") {
  return `<svg class="${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"></path></svg>`;
}

function button({ label = "", icon, dataAttr = "", variant = "", className = "", iconOnly = false }) {
  return `<button type="button" class="btn ${variant} ${className} ${iconOnly ? "btn--icon" : ""}" ${dataAttr}>${icon ? `<span class="btn__icon">${icon}</span>` : ""}${iconOnly ? "" : `<span class="btn__label">${label}</span>`}</button>`;
}

function isEditModeInUrl() {
  return new URLSearchParams(window.location.search).get(EDIT_MODE_URL_KEY) === "1";
}

function buildAppUrl({ navId = getActiveNavId(), editMode = state.editMode } = {}) {
  const url = new URL(window.location.href);
  url.hash = navIdToHash(state.config, navId);
  if (editMode) url.searchParams.set(EDIT_MODE_URL_KEY, "1");
  else url.searchParams.delete(EDIT_MODE_URL_KEY);
  return url;
}

function syncAppUrl({ navId = getActiveNavId(), editMode = state.editMode, historyMode = "replace" } = {}) {
  const url = buildAppUrl({ navId, editMode });
  const historyState = { navId, editMode };
  if (historyMode === "push") {
    history.pushState(historyState, "", url.href);
    return;
  }
  history.replaceState(historyState, "", url.href);
}

function applyStateFromUrl({ normalizeInvalidHash = false } = {}) {
  const urlEditMode = isEditModeInUrl();
  const parsedNavId = parseNavIdFromHash(window.location.hash, state.config);
  const nextNavId = resolveNavIdFromHash(state.config, window.location.hash, state.settings);
  let changed = false;

  if (state.settings.activeNavId !== nextNavId) {
    state.settings.activeNavId = nextNavId;
    changed = true;
  }

  if (urlEditMode !== state.editMode) {
    if (urlEditMode) captureEditModeCollapsedSnapshot();
    else {
      restoreEditModeCollapsedSnapshot();
      state.sidebarCategoryDraft = false;
    }
    state.editMode = urlEditMode;
    if (!urlEditMode) editModeHistoryPushed = false;
    changed = true;
  }

  if (normalizeInvalidHash && parsedNavId === null && normalizeNavHash(window.location.hash)) {
    syncAppUrl({ navId: NAV_ALL, editMode: state.editMode, historyMode: "replace" });
  }

  if (changed) render();
}

function captureEditModeCollapsedSnapshot() {
  if (!state.editModeCollapsedSnapshot) {
    state.editModeCollapsedSnapshot = Object.fromEntries(
      (state.config.categories || []).map((category) => [category.id, Boolean(category.collapsed)])
    );
  }
}

function restoreEditModeCollapsedSnapshot() {
  if (!state.editModeCollapsedSnapshot) return;
  for (const category of state.config.categories || []) {
    if (Object.hasOwn(state.editModeCollapsedSnapshot, category.id)) {
      category.collapsed = Boolean(state.editModeCollapsedSnapshot[category.id]);
    }
  }
  state.editModeCollapsedSnapshot = null;
  state.sessionCategoryCollapsed = {};
}

function setEditMode(nextEditMode, { syncHistory = true } = {}) {
  if (nextEditMode === state.editMode) return;
  if (syncHistory && !nextEditMode && editModeHistoryPushed) {
    editModeHistoryPushed = false;
    history.back();
    return;
  }
  if (nextEditMode) captureEditModeCollapsedSnapshot();
  else {
    restoreEditModeCollapsedSnapshot();
    state.sidebarCategoryDraft = false;
  }
  state.editMode = nextEditMode;
  if (syncHistory) {
    if (nextEditMode && !isEditModeInUrl()) {
      syncAppUrl({ editMode: nextEditMode, historyMode: "push" });
      editModeHistoryPushed = true;
    } else {
      syncAppUrl({ editMode: nextEditMode, historyMode: "replace" });
    }
  }
  render();
}

async function bootstrap() {
  ensureSidebarShell();
  bindSidebarEvents();
  await loadMdiRegistry();
  const [config, settings, themes, languages] = await Promise.all([
    api.getConfig(),
    api.getSettings(),
    api.getThemes(),
    api.getLanguages()
  ]);
  state.config = normalizeConfig(config);
  state.settings = {
    ...state.settings,
    ...settings,
    categoryAccentStrength: normalizeCategoryAccentStrength(settings?.categoryAccentStrength),
    elementSize: normalizeElementSize(settings?.elementSize),
    globalShortcuts: normalizeGlobalShortcuts(settings?.globalShortcuts),
    browserSync: normalizeBrowserSyncSettings(settings?.browserSync),
    navViewModes: normalizeNavViewModes(settings?.navViewModes)
  };
  state.settings.activeNavId = resolveNavIdFromHash(state.config, window.location.hash, state.settings);
  state.themes = themes.themes;
  state.languages = languages.languages;
  await initI18n(state.settings.language);
  applyTheme(state.settings.theme);
  applyCategoryAccentStrength(state.settings.categoryAccentStrength);
  applyElementSize(state.settings.elementSize);
  if (isEditModeInUrl()) {
    state.editMode = true;
    captureEditModeCollapsedSnapshot();
  }
  syncAppUrl({
    navId: state.settings.activeNavId,
    editMode: state.editMode,
    historyMode: "replace"
  });
  ensureBookmarkMenuDismiss();
  wireEvents();
  render();
}

function wireEvents() {
  window.addEventListener("popstate", () => {
    applyStateFromUrl({ normalizeInvalidHash: true });
  });
  elements.edit.addEventListener("click", () => {
    setEditMode(!state.editMode);
  });
  elements.undo.addEventListener("click", undo);
  elements.settings.addEventListener("click", openSettingsModal);
  elements.addCategory?.addEventListener("click", () => openCategoryModal());
  bindSidebarEvents();
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (isBlockingFocusTarget(document.activeElement) || isBlockingFocusTarget(event.target)) return;
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    const globalMatch = GLOBAL_SHORTCUT_ACTIONS.find((action) => getGlobalShortcut(action.id) === shortcut);
    if (globalMatch) {
      event.preventDefault();
      runGlobalShortcutAction(globalMatch.id);
      return;
    }
    if (state.editMode) return;
    const match = findBookmarkByShortcut(shortcut);
    if (!match) return;
    event.preventDefault();
    triggerBookmarkLaunch(match.bookmark.id);
  });
}

function pushUndo() {
  state.undoStack.push({
    config: deepClone(state.config),
    settings: deepClone(state.settings)
  });
  if (state.undoStack.length > 50) state.undoStack.shift();
}

async function persistConfig() {
  await api.saveConfig(state.config);
  state.config = normalizeConfig(await api.getConfig());
  state.settings.activeNavId = resolveActiveNavId(state.config, state.settings);
}

async function persistSettings() {
  state.settings.activeNavId = resolveActiveNavId(state.config, state.settings);
  state.settings.navViewModes = normalizeNavViewModes(state.settings.navViewModes);
  await api.saveSettings(state.settings);
  const saved = await api.getSettings();
  state.settings = {
    ...state.settings,
    ...saved,
    categoryAccentStrength: normalizeCategoryAccentStrength(saved?.categoryAccentStrength),
    elementSize: normalizeElementSize(saved?.elementSize),
    globalShortcuts: normalizeGlobalShortcuts(saved?.globalShortcuts),
    browserSync: normalizeBrowserSyncSettings(saved?.browserSync),
    activeNavId: resolveActiveNavId(state.config, saved),
    navViewModes: normalizeNavViewModes(saved?.navViewModes)
  };
}

async function undo() {
  const last = state.undoStack.pop();
  if (!last) return;
  state.config = last.config;
  state.settings = last.settings;
  state.sessionCategoryCollapsed = {};
  await Promise.all([persistConfig(), persistSettings()]);
  await initI18n(state.settings.language);
  applyTheme(state.settings.theme);
  render();
}

function queryNavigationElements() {
  elements.navToggle = document.getElementById("nav-toggle-btn");
  elements.sidebar = document.getElementById("sidebar");
  elements.sidebarSystem = document.getElementById("sidebar-system");
  elements.sidebarCategories = document.getElementById("sidebar-categories");
}

function ensureAppShell() {
  document.getElementById("sidebar-backdrop")?.remove();

  let shell = document.querySelector(".app-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.className = "app-shell";
    document.body.prepend(shell);
  }

  let appMain = shell.querySelector(".app-main");
  if (!appMain) {
    appMain = document.createElement("div");
    appMain.className = "app-main";
    shell.append(appMain);
  }

  const topbar = document.querySelector(".topbar");
  const main = document.querySelector("main");
  if (topbar && topbar.parentElement !== appMain) appMain.prepend(topbar);
  if (main && main.parentElement !== appMain) appMain.append(main);

  queryNavigationElements();
  if (elements.sidebar && elements.sidebar.parentElement !== shell) {
    shell.prepend(elements.sidebar);
  }
}

function ensureSidebarShell() {
  ensureAppShell();
  queryNavigationElements();

  if (!elements.sidebar) {
    const sidebar = document.createElement("aside");
    sidebar.id = "sidebar";
    sidebar.className = "sidebar";
    sidebar.setAttribute("aria-hidden", "true");
    sidebar.innerHTML = `
      <nav class="sidebar-nav" aria-label="Navigation">
        <ul id="sidebar-system" class="sidebar-list"></ul>
        <ul id="sidebar-categories" class="sidebar-list sidebar-list--categories"></ul>
      </nav>
    `;
    document.querySelector(".app-shell")?.prepend(sidebar);
    elements.sidebar = sidebar;
    elements.sidebarSystem = document.getElementById("sidebar-system");
    elements.sidebarCategories = document.getElementById("sidebar-categories");
  } else if (!elements.sidebarSystem || !elements.sidebarCategories) {
    let nav = elements.sidebar.querySelector(".sidebar-nav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "sidebar-nav";
      nav.setAttribute("aria-label", "Navigation");
      elements.sidebar.append(nav);
    }
    if (!elements.sidebarSystem) {
      const list = document.createElement("ul");
      list.id = "sidebar-system";
      list.className = "sidebar-list";
      nav.append(list);
      elements.sidebarSystem = list;
    }
    if (!elements.sidebarCategories) {
      const list = document.createElement("ul");
      list.id = "sidebar-categories";
      list.className = "sidebar-list sidebar-list--categories";
      nav.append(list);
      elements.sidebarCategories = list;
    }
  }

  if (elements.navToggle) {
    elements.navToggle.setAttribute("aria-controls", "sidebar");
  }
}

function updateNavToggleIcon() {
  queryNavigationElements();
  if (!elements.navToggle) return;
  elements.navToggle.innerHTML = `<span class="btn__icon" aria-hidden="true">${iconSvg(ICONS.menu, "inline-icon")}</span>`;
}

function bindSidebarEvents() {
  queryNavigationElements();
  ensureSidebarShell();
  if (document.documentElement.dataset.sidebarEventsBound === "true") return;
  document.documentElement.dataset.sidebarEventsBound = "true";
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#nav-toggle-btn")) return;
    event.preventDefault();
    queryNavigationElements();
    setSidebarOpen(!state.sidebarOpen);
  });
}

function getActiveNavId() {
  return resolveActiveNavId(state.config, state.settings);
}

function getActiveNavViewMode() {
  return getNavViewMode(state.settings, getActiveNavId());
}

function setSidebarOpen(open) {
  ensureSidebarShell();
  queryNavigationElements();
  state.sidebarOpen = Boolean(open);
  if (elements.sidebar) {
    elements.sidebar.classList.toggle("is-open", state.sidebarOpen);
    elements.sidebar.setAttribute("aria-hidden", state.sidebarOpen ? "false" : "true");
  }
  elements.navToggle?.setAttribute("aria-expanded", state.sidebarOpen ? "true" : "false");
  elements.navToggle?.classList.toggle("is-active", state.sidebarOpen);
  document.body.classList.toggle("sidebar-open", state.sidebarOpen);
}

async function selectNav(navId, { syncHistory = true, historyMode = "push" } = {}) {
  const nextNavId = normalizeActiveNavId(navId);
  if (!isValidNavId(state.config, nextNavId)) return;
  const hashNavId = parseNavIdFromHash(window.location.hash, state.config);
  if (getActiveNavId() === nextNavId) {
    if (syncHistory && hashNavId !== nextNavId) {
      syncAppUrl({ navId: nextNavId, historyMode: "replace" });
    }
    return;
  }
  state.settings.activeNavId = nextNavId;
  if (syncHistory) {
    syncAppUrl({ navId: nextNavId, historyMode });
  }
  await persistSettings();
  render();
}

async function setNavViewModeForActive(mode) {
  const navId = getActiveNavId();
  if (getNavViewMode(state.settings, navId) === mode) return;
  setNavViewMode(state.settings, navId, mode);
  await persistSettings();
  render();
}

function getHomepageName() {
  const raw = state.settings.appTitle;
  const trimmed = typeof raw === "string" ? raw.trim() : String(raw || "").trim();
  return trimmed || t("ui.navStart");
}

function getNavTitle(navId) {
  if (navId === NAV_ALL) return getHomepageName();
  const systemItem = SYSTEM_NAV_ITEMS.find((entry) => entry.id === navId);
  if (systemItem) return t(systemItem.labelKey);
  return findSidebarCategoryById(state.config, navId)?.name || "";
}

function renderSidebarLink(navId, label, count, iconName) {
  const li = document.createElement("li");
  li.className = "sidebar-item";
  const isActive = getActiveNavId() === navId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `sidebar-link ${isActive ? "is-active" : ""}`;
  button.dataset.navId = navId;
  button.innerHTML = `
    <span class="sidebar-link__icon">${mdiIcon(iconName, "inline-icon")}</span>
    <span class="sidebar-link__label">${label}</span>
    <span class="sidebar-link__count">${count}</span>
  `;
  button.addEventListener("click", () => {
    void selectNav(navId);
  });
  li.append(button);
  return li;
}

function renderSidebar() {
  ensureSidebarShell();
  updateNavToggleIcon();
  if (elements.navToggle) {
    elements.navToggle.title = t("ui.navToggle");
    elements.navToggle.setAttribute("aria-label", t("ui.navToggle"));
  }
  if (!elements.sidebarSystem || !elements.sidebarCategories) return;
  setSidebarOpen(state.sidebarOpen);

  elements.sidebarSystem.replaceChildren();
  for (const item of SYSTEM_NAV_ITEMS) {
    const label = item.id === NAV_ALL ? getHomepageName() : t(item.labelKey);
    elements.sidebarSystem.append(
      renderSidebarLink(item.id, label, getBookmarkCountForNav(state.config, item.id), item.icon)
    );
  }

  elements.sidebarCategories.replaceChildren();
  for (const category of getSidebarCategories(state.config)) {
    elements.sidebarCategories.append(
      renderSidebarLink(
        category.id,
        category.name,
        getBookmarkCountForNav(state.config, category.id),
        category.icon || FALLBACK_MDI_ICON
      )
    );
  }
  if (state.editMode) {
    if (state.sidebarCategoryDraft) {
      elements.sidebarCategories.append(renderSidebarCategoryDraftRow());
    } else {
      elements.sidebarCategories.append(renderSidebarAddCategoryTrigger());
    }
  }
}

function renderSidebarAddCategoryTrigger() {
  const li = document.createElement("li");
  li.className = "sidebar-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-link sidebar-link--add";
  button.innerHTML = `
    <span class="sidebar-link__icon">${mdiIcon("plus", "inline-icon")}</span>
    <span class="sidebar-link__label">${t("ui.addSidebarCategory")}</span>
  `;
  button.addEventListener("click", () => {
    state.sidebarCategoryDraft = true;
    render();
  });
  li.append(button);
  return li;
}

function renderSidebarCategoryDraftRow() {
  const li = document.createElement("li");
  li.className = "sidebar-item";
  const wrapper = document.createElement("div");
  wrapper.className = "sidebar-link sidebar-link--draft";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sidebar-link__input";
  input.setAttribute("aria-label", t("ui.addSidebarCategory"));
  const commit = async () => {
    const name = input.value.trim();
    state.sidebarCategoryDraft = false;
    if (!name) {
      render();
      return;
    }
    await saveSidebarCategory(name);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      state.sidebarCategoryDraft = false;
      render();
    }
  });
  input.addEventListener("blur", () => {
    void commit();
  });
  wrapper.append(input);
  li.append(wrapper);
  requestAnimationFrame(() => input.focus());
  return li;
}

async function saveSidebarCategory(name) {
  pushUndo();
  const id = uid();
  if (!state.config.sidebarCategories) state.config.sidebarCategories = [];
  state.config.sidebarCategories.push({
    id,
    name,
    icon: FALLBACK_MDI_ICON,
    slug: allocateSidebarCategorySlug(state.config, name)
  });
  if (!state.config.sidebarCategoryBookmarkOrder) state.config.sidebarCategoryBookmarkOrder = {};
  state.config.sidebarCategoryBookmarkOrder[id] = [];
  await persistConfig();
  render();
}

function resolveBookmarkCategoryForNav(bookmark, navId) {
  if (isCategoryNavId(state.config, navId)) {
    return findSidebarCategoryById(state.config, navId);
  }
  const firstSidebarCategoryId = (bookmark.sidebarCategoryIds || []).find((id) =>
    findSidebarCategoryById(state.config, id)
  );
  if (firstSidebarCategoryId) {
    return findSidebarCategoryById(state.config, firstSidebarCategoryId);
  }
  const firstCategoryId = (bookmark.categoryIds || []).find((id) => findCategoryById(state.config, id));
  return findCategoryById(state.config, firstCategoryId) || null;
}

function renderBookmarkCollection(bookmarks, navId, viewMode) {
  const normalizedView = normalizeBookmarkView(viewMode);
  const root = document.createElement("div");
  root.className = `${bookmarksContainerClass(normalizedView)} bookmark-collection view-mode--${normalizedView}`;
  for (const bookmark of bookmarks) {
    root.append(createBookmarkElementForBookmark(
      bookmark,
      resolveBookmarkCategoryForNav(bookmark, navId),
      normalizedView,
      { homepage: navId === NAV_ALL }
    ));
  }
  return root;
}

function renderViewModeToggle(viewMode) {
  const wrap = document.createElement("div");
  wrap.className = "view-mode-toggle";
  wrap.innerHTML = `
    ${button({
      label: t("ui.viewList"),
      icon: iconSvg(ICONS.viewList, "inline-icon"),
      dataAttr: `data-view-mode="${VIEW_LIST}"`,
      variant: "btn--ghost",
      className: `btn--compact ${viewMode === VIEW_LIST ? "is-active" : ""}`,
      iconOnly: true
    })}
    ${button({
      label: t("ui.viewCards"),
      icon: iconSvg(ICONS.viewCards, "inline-icon"),
      dataAttr: `data-view-mode="${VIEW_CARDS}"`,
      variant: "btn--ghost",
      className: `btn--compact ${viewMode === VIEW_CARDS ? "is-active" : ""}`,
      iconOnly: true
    })}
  `;
  const listButton = wrap.querySelector(`[data-view-mode="${VIEW_LIST}"]`);
  const cardsButton = wrap.querySelector(`[data-view-mode="${VIEW_CARDS}"]`);
  listButton?.setAttribute("aria-label", t("ui.viewList"));
  listButton?.setAttribute("title", t("ui.viewList"));
  cardsButton?.setAttribute("aria-label", t("ui.viewCards"));
  cardsButton?.setAttribute("title", t("ui.viewCards"));
  listButton?.addEventListener("click", () => {
    void setNavViewModeForActive(VIEW_LIST);
  });
  cardsButton?.addEventListener("click", () => {
    void setNavViewModeForActive(VIEW_CARDS);
  });
  return wrap;
}

function renderNavView() {
  const navId = getActiveNavId();
  const viewMode = getActiveNavViewMode();
  const panel = document.createElement("section");
  panel.className = "nav-view-panel";

  const header = document.createElement("div");
  header.className = "nav-view-header nav-view-header--toggle-only";
  header.append(renderViewModeToggle(viewMode));
  panel.append(header);

  const bookmarks = getBookmarksForNav(state.config, navId);
  panel.append(renderBookmarkCollection(bookmarks, navId, viewMode));
  return panel;
}

function render() {
  applyCategoryAccentStrength(state.settings.categoryAccentStrength);
  applyElementSize(state.settings.elementSize);
  updateDocumentLanguage();
  updateAppTitleUI();
  elements.undo.innerHTML = iconSvg(ICONS.undo, "inline-icon");
  elements.edit.innerHTML = iconSvg(ICONS.edit, "inline-icon");
  elements.settings.innerHTML = iconSvg(ICONS.settings, "inline-icon");
  updateTopbarActionTexts();
  elements.edit.classList.toggle("is-active", state.editMode);
  elements.undo.classList.toggle("hidden", !state.editMode || state.undoStack.length === 0);
  elements.addCategory.classList.add("hidden");
  renderSidebar();

  const activeNavId = getActiveNavId();
  const viewMode = getActiveNavViewMode();
  const showCategoryGrid = shouldShowCategoryGrid(activeNavId);

  if (elements.navView) elements.navView.innerHTML = "";
  elements.categories.innerHTML = "";

  if (showCategoryGrid) {
    const isHomepage = activeNavId === NAV_ALL;
    elements.navView?.classList.toggle("hidden", !isHomepage);
    elements.navView?.classList.toggle("nav-view--homepage", isHomepage);
    elements.categories.classList.remove("hidden");
    if (isHomepage) {
      const header = document.createElement("div");
      header.className = "nav-view-header nav-view-header--toggle-only";
      header.append(renderViewModeToggle(viewMode));
      elements.navView?.append(header);
    }
    for (const category of getHomepageCategories(state.config)) {
      elements.categories.append(renderCategory(category));
    }
    if (state.editMode) {
      elements.categories.append(renderAddCategoryCard());
    }
    return;
  }

  elements.navView?.classList.remove("nav-view--homepage");
  elements.navView?.classList.remove("hidden");
  elements.categories.classList.add("hidden");
  elements.navView?.append(renderNavView());
}

function updateDocumentLanguage() {
  document.documentElement.lang = state.settings.language || "en";
}

function updateAppTitleUI() {
  const title = getNavTitle(getActiveNavId());
  if (document.title !== title) document.title = title;
  if (elements.title.textContent !== title) elements.title.textContent = title;
}

function updateTopbarActionTexts() {
  const undoShortcut = formatShortcutForTooltip(getGlobalShortcut("undo"));
  const editShortcut = formatShortcutForTooltip(getGlobalShortcut("toggleEditMode"));
  const settingsShortcut = formatShortcutForTooltip(getGlobalShortcut("openSettings"));
  elements.undo.title = undoShortcut ? `${t("ui.undo")} (${undoShortcut})` : t("ui.undo");
  elements.edit.title = editShortcut ? `${t("ui.edit")} (${editShortcut})` : t("ui.edit");
  elements.settings.title = settingsShortcut ? `${t("ui.settings")} (${settingsShortcut})` : t("ui.settings");
  elements.undo.setAttribute("aria-label", t("ui.undo"));
  elements.edit.setAttribute("aria-label", t("ui.edit"));
  elements.settings.setAttribute("aria-label", t("ui.settings"));
}

function refreshStaticLocalizedTexts() {
  updateDocumentLanguage();
  updateTopbarActionTexts();
  updateAppTitleUI();
  renderSidebar();
  elements.navView?.querySelectorAll("[data-view-mode]").forEach((button) => {
    const mode = button.dataset.viewMode;
    button.title = mode === VIEW_LIST ? t("ui.viewList") : t("ui.viewCards");
    button.setAttribute("aria-label", button.title);
  });
  document.querySelectorAll("[data-add-bookmark] .service-name").forEach((entry) => {
    entry.textContent = t("ui.addBookmark");
  });
  document.querySelectorAll("[data-add-category] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.addCategory");
  });
}

function refreshSettingsModalTexts(form) {
  if (!form) return;
  const modalTitle = form.closest(".modal")?.querySelector("h2");
  if (modalTitle) modalTitle.textContent = t("ui.settings");
  form.querySelector("[data-settings-name-label]")?.replaceChildren(t("ui.homepageName"));
  form.querySelector("[data-settings-theme-label]")?.replaceChildren(t("ui.theme"));
  form.querySelector("[data-settings-language-label]")?.replaceChildren(t("ui.language"));
  form.querySelector("[data-settings-accent-label]")?.replaceChildren(t("ui.categoryAccentStrength"));
  form.querySelector("[data-settings-element-size-label]")?.replaceChildren(t("ui.elementSize"));
  form.querySelector("[data-settings-shortcuts-label]")?.replaceChildren(t("ui.shortcuts"));
  form.querySelectorAll("[data-global-shortcut-label]").forEach((entry) => {
    entry.textContent = getGlobalShortcutLabel(entry.dataset.globalShortcutLabel);
  });
  form.querySelectorAll("[data-shortcut-placeholder]").forEach((entry) => {
    entry.textContent = t("ui.shortcutPlaceholder");
  });
  form.querySelectorAll("[data-element-size]").forEach((entry) => {
    const size = normalizeElementSize(entry.dataset.elementSize);
    entry.textContent = t(`ui.size${size.charAt(0).toUpperCase()}${size.slice(1)}`);
  });
  form.querySelector("[data-settings-actions-label]")?.replaceChildren(t("ui.actions"));
  form.querySelector("[data-settings-restart-label]")?.replaceChildren(t("ui.restartApp"));
  form.querySelector("[data-settings-browser-sync-title]")?.replaceChildren(t("ui.browserSync"));
  const browserSyncToggle = form.querySelector("#browser-sync-enabled");
  const browserSyncToggleLabel = browserSyncToggle?.closest(".toggle-switch");
  const browserSyncEnabledLabel = t("ui.browserSyncEnabled");
  if (browserSyncToggle) browserSyncToggle.setAttribute("aria-label", browserSyncEnabledLabel);
  if (browserSyncToggleLabel) browserSyncToggleLabel.title = browserSyncEnabledLabel;
  form.querySelector("[data-settings-browser-sync-url-label]")?.replaceChildren(t("ui.browserSyncGithubUrl"));
  form.querySelector("[data-settings-browser-sync-pat-label]")?.replaceChildren(t("ui.browserSyncGithubPat"));
  form.querySelector("[data-settings-browser-sync-interval-label]")?.replaceChildren(t("ui.browserSyncInterval"));
  form.querySelector("[data-browser-sync-run] .btn__label")?.replaceChildren(t("ui.browserSyncRunNow"));
  form.closest(".modal")?.querySelector("[data-cancel] .btn__label")?.replaceChildren(t("ui.close"));
}

function formatBrowserSyncStatusLine(status) {
  if (!status?.lastSync) return t("ui.browserSyncNever");
  const last = status.lastSync;
  if (!last.ok) {
    return interpolateLabel(t("ui.browserSyncLastFailed"), { error: last.error || "?" });
  }
  return interpolateLabel(t("ui.browserSyncLastOk"), {
    at: last.at || "",
    imported: last.imported || 0,
    reimported: last.reimported || 0,
    disappeared: last.disappeared || 0
  });
}

function updateBrowserSyncFieldsVisibility(form, enabled) {
  form.querySelectorAll("[data-browser-sync-field]").forEach((row) => {
    row.classList.toggle("hidden", !enabled);
    row.querySelectorAll("input, button").forEach((control) => {
      control.disabled = !enabled;
    });
  });
}

function renderCategory(category) {
  const categoryIndex = state.config.categories.findIndex((entry) => entry.id === category.id);
  const canMoveLeft = categoryIndex > 0;
  const canMoveRight = categoryIndex >= 0 && categoryIndex < state.config.categories.length - 1;
  const isCollapsed = categoryEffectiveCollapsed(category);
  const slotSpan = normalizeCategorySlots(category.slots);
  category.slots = slotSpan;
  const categoryType = normalizeCategoryType(category.type);
  const iframeUrl = normalizeIframeUrl(category.iframeUrl);
  const viewMode = getActiveNavViewMode();
  const bookmarkContainerClass = viewMode === VIEW_CARDS
    ? "category-bookmarks category-bookmarks--cards"
    : `${bookmarksContainerClass(VIEW_LIST)} services`;
  const card = document.createElement("article");
  card.className = `category ${state.editMode ? "is-edit-mode" : ""}`;
  card.dataset.color = category.color || "primary";
  card.dataset.slots = String(slotSpan);
  card.style.setProperty("--category-slots", String(slotSpan));
  card.classList.toggle("is-collapsed", isCollapsed);
  card.dataset.categoryType = categoryType;
  card.innerHTML = `
    <div class="category-header">
      <button type="button" class="category-header-main" data-toggle-collapse>
        ${iconSvg(ICONS.chevron, `inline-icon collapse-arrow ${isCollapsed ? "is-collapsed" : ""}`)}
        ${mdiIcon(category.icon || FALLBACK_MDI_ICON, "category-icon")}
        <span class="category-name">${category.name}</span>
      </button>
      <div class="category-actions ${state.editMode ? "" : "hidden"}">
        ${button({ label: t("ui.edit"), icon: iconSvg(ICONS.edit, "inline-icon"), dataAttr: "data-edit-category", variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
        ${button({ label: t("ui.moveLeft"), icon: iconSvg(ICONS.arrowLeft, "inline-icon"), dataAttr: `data-move-category-left ${canMoveLeft ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
        ${button({ label: t("ui.moveRight"), icon: iconSvg(ICONS.arrowRight, "inline-icon"), dataAttr: `data-move-category-right ${canMoveRight ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
      </div>
    </div>
    <div class="category-content ${isCollapsed ? "is-collapsed" : ""}">
      ${categoryType === "iframe" ? `
        <div class="category-iframe">
          <iframe
            class="category-iframe__frame"
            title="${category.name}"
            src="${resolveIframeSrc(iframeUrl)}"
            loading="lazy"
            referrerpolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
          ></iframe>
        </div>
      ` : `
        <div data-bookmarks-container data-category-id="${category.id}" class="${bookmarkContainerClass}"></div>
      `}
    </div>
    ${state.editMode && categoryType !== "iframe" ? renderAddBookmarkTile() : ""}
  `;
  card.dataset.categoryId = category.id;

  const content = card.querySelector(".category-content");
  const arrow = card.querySelector(".collapse-arrow");
  const bookmarksRoot = card.querySelector("[data-bookmarks-container]");
  if (bookmarksRoot && categoryType !== "iframe") {
    for (const bookmark of getBookmarksForCategory(state.config, category.id)) {
      bookmarksRoot.append(renderBookmark(category, bookmark));
    }
  }
  syncCategoryContentHeight(content, isCollapsed);

  const toggleCollapse = () => {
    if (state.editMode) return;
    const persisted = Boolean(category.collapsed);
    const nextCollapsed = !categoryEffectiveCollapsed(category);
    animateCategoryCollapse(content, arrow, nextCollapsed);
    if (nextCollapsed === persisted) {
      delete state.sessionCategoryCollapsed[category.id];
    } else {
      state.sessionCategoryCollapsed[category.id] = nextCollapsed;
    }
    card.classList.toggle("is-collapsed", nextCollapsed);
  };
  card.querySelector("[data-toggle-collapse]").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCollapse();
  });
  card.addEventListener("click", (event) => {
    if (!categoryEffectiveCollapsed(category) || state.editMode) return;
    const interactive = event.target.closest("button, a, input, select, textarea, .service, .bookmark-item, .category-actions");
    if (interactive) return;
    toggleCollapse();
  });
  card.querySelector("[data-add-bookmark]")?.addEventListener("click", () => openBookmarkModal({ homepageCategoryId: category.id }));
  card.querySelector("[data-edit-category]")?.addEventListener("click", () => openCategoryModal(category));
  card.querySelector("[data-move-category-left]")?.addEventListener("click", () => {
    void swapCategoryByStep(category.id, -1);
  });
  card.querySelector("[data-move-category-right]")?.addEventListener("click", () => {
    void swapCategoryByStep(category.id, 1);
  });
  return card;
}

function syncCategoryContentHeight(content, collapsed) {
  if (!content) return;
  content.dataset.collapsed = collapsed ? "true" : "false";
  content.classList.toggle("is-collapsed", collapsed);
  if (collapsed) {
    content.style.maxHeight = "0px";
  } else {
    content.style.maxHeight = "none";
  }
}

function animateCategoryCollapse(content, arrow, collapsed) {
  if (!content || !arrow) return;
  content.classList.add("is-animating");
  content.dataset.collapsed = collapsed ? "true" : "false";
  content.classList.toggle("is-collapsed", collapsed);
  arrow.classList.toggle("is-collapsed", collapsed);

  if (collapsed) {
    const fullHeight = content.scrollHeight;
    content.style.maxHeight = `${fullHeight}px`;
    // Force layout so the browser picks up the start height before animating.
    content.getBoundingClientRect();
    content.style.maxHeight = "0px";
  } else {
    content.style.maxHeight = "0px";
    // Force layout so opening always starts from collapsed state.
    content.getBoundingClientRect();
    const fullHeight = content.scrollHeight;
    content.style.maxHeight = `${fullHeight}px`;
  }

  const onTransitionEnd = (event) => {
    if (event.propertyName !== "max-height") return;
    content.classList.remove("is-animating");
    if (!collapsed) {
      // Keep expanded cards flexible for later content changes/responsive wrap.
      content.style.maxHeight = "none";
    }
    content.removeEventListener("transitionend", onTransitionEnd);
  };

  content.addEventListener("transitionend", onTransitionEnd);
}

function renderBookmark(category, bookmark) {
  return createBookmarkElementForBookmark(bookmark, category, getActiveNavViewMode(), { homepage: true });
}

function renderAddCategoryCard() {
  const card = document.createElement("article");
  card.className = "category category--add";
  card.innerHTML = `
    <button type="button" class="btn btn--ghost category-add-card" data-add-category>
      <span class="btn__icon">${iconSvg(ICONS.plus, "inline-icon")}</span>
      <span class="btn__label">${t("ui.addCategory")}</span>
    </button>
  `;
  card.querySelector("[data-add-category]").addEventListener("click", () => openCategoryModal());
  return card;
}

function renderAddBookmarkTile() {
  return `
    <button type="button" class="service service--add" data-add-bookmark>
      <span class="service-left">
        <span class="btn__icon">${iconSvg(ICONS.plus, "inline-icon")}</span>
        <span class="service-name">${t("ui.addBookmark")}</span>
      </span>
    </button>
  `;
}

function syncEditModeCollapsedSnapshot(categoryId, collapsed) {
  if (!state.editModeCollapsedSnapshot || !categoryId) return;
  state.editModeCollapsedSnapshot[categoryId] = Boolean(collapsed);
}

function openCategoryModal(category = null) {
  const isEdit = Boolean(category);
  const form = document.createElement("form");
  const selectedSlots = normalizeCategorySlots(category?.slots);
  const existingType = normalizeCategoryType(category?.type);
  const isIframeCategory = isEdit && existingType === "iframe";
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.name")}</label>
      <input name="name" value="${category?.name || ""}" required />
    </div>
    <div class="form-row icon-search">
      <label>${t("ui.icon")}</label>
      <div>
        <div class="icon-input-wrap">
          <span class="icon-input-preview" data-selected-icon-preview>${mdiIcon(category?.icon || FALLBACK_MDI_ICON, "icon-preview icon-preview--theme")}</span>
          <input name="icon" value="${normalizeMdiIconName(category?.icon || FALLBACK_MDI_ICON)}" autocomplete="off" />
        </div>
        <div class="icon-search-results" data-icon-results></div>
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.categoryColor")}</label>
      <div>
        <div class="color-options">
          ${COLOR_OPTIONS.map((color) => `<button type="button" class="color-dot ${(category?.color || "primary") === color ? "is-active" : ""}" data-color="${color}" data-color-pick="${color}"></button>`).join("")}
        </div>
        <input type="hidden" name="color" value="${category?.color || "primary"}" />
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.collapsed")}</label>
      <label class="toggle-switch">
        <input name="collapsed" type="checkbox" ${category?.collapsed ? "checked" : ""} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    <div class="form-row">
      <label>${t("ui.slots")}</label>
      <div>
        <div class="slot-options">
          ${CATEGORY_SLOT_OPTIONS.map((slot) => `<button type="button" class="theme-option ${selectedSlots === slot ? "active" : ""}" data-slot-pick="${slot}">${slot}</button>`).join("")}
        </div>
        <input type="hidden" name="slots" value="${selectedSlots}" />
      </div>
    </div>
    ${!isEdit ? `
      <div class="form-row">
        <label>${t("ui.categoryType")}</label>
        <div class="select-wrap">
          <select name="type" data-category-type>
            <option value="service-list" selected>${t("ui.categoryTypeServiceList")}</option>
            <option value="iframe">${t("ui.categoryTypeIframe")}</option>
          </select>
          <span class="select-chevron">${iconSvg(ICONS.chevron, "inline-icon")}</span>
        </div>
      </div>
      <div class="form-row hidden" data-iframe-url-row>
        <label>${t("ui.iframeUrl")}</label>
        <input name="iframeUrl" inputmode="url" autocomplete="off" placeholder="https://…" />
      </div>
    ` : ""}
    ${isIframeCategory ? `
      <div class="form-row">
        <label>${t("ui.iframeUrl")}</label>
        <input name="iframeUrl" inputmode="url" autocomplete="off" value="${normalizeIframeUrl(category?.iframeUrl)}" required />
      </div>
    ` : ""}
  `;

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.category")}` : t("ui.addCategory"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    leadingActions: isEdit ? [{
      label: t("ui.delete"),
      icon: ICONS.trash,
      onClick: async () => {
        pushUndo();
        removeCategoryFromConfig(state.config, category.id);
        delete state.sessionCategoryCollapsed[category.id];
        await persistConfig();
        render();
      }
    }] : [],
    modalClass: "modal--category",
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      pushUndo();
      const selectedIcon = normalizeMdiIconName(fd.get("icon"));
      const iframeUrlValue = normalizeIframeUrl(fd.get("iframeUrl"));
      if (!isEdit) {
        const typeForNew = normalizeCategoryType(fd.get("type") || DEFAULT_CATEGORY_TYPE);
        if (typeForNew === "iframe" && !isValidIframeUrl(iframeUrlValue)) {
          const input = form.querySelector("input[name='iframeUrl']");
          input?.setCustomValidity(t("ui.iframeUrlInvalid"));
          input?.reportValidity();
          input?.setCustomValidity("");
          return false;
        }
      }
      if (isIframeCategory && !isValidIframeUrl(iframeUrlValue)) {
        const input = form.querySelector("input[name='iframeUrl']");
        input?.setCustomValidity(t("ui.iframeUrlInvalid"));
        input?.reportValidity();
        input?.setCustomValidity("");
        return false;
      }
      if (isEdit) {
        const nextCollapsed = form.querySelector("input[name='collapsed']").checked;
        category.name = fd.get("name");
        category.icon = selectedIcon;
        category.color = fd.get("color");
        category.collapsed = nextCollapsed;
        delete state.sessionCategoryCollapsed[category.id];
        syncEditModeCollapsedSnapshot(category.id, nextCollapsed);
        category.slots = normalizeCategorySlots(fd.get("slots"));
        if (isIframeCategory) {
          category.type = "iframe";
          category.iframeUrl = iframeUrlValue;
        }
      } else {
        const typeForNew = normalizeCategoryType(fd.get("type") || DEFAULT_CATEGORY_TYPE);
        const createdCategory = {
          id: uid(),
          name: fd.get("name"),
          icon: selectedIcon,
          color: fd.get("color"),
          collapsed: form.querySelector("input[name='collapsed']").checked,
          slots: normalizeCategorySlots(fd.get("slots"))
        };
        if (typeForNew === "iframe") {
          state.config.categories.push({
            ...createdCategory,
            type: "iframe",
            iframeUrl: iframeUrlValue
          });
        } else {
          state.config.categories.push({
            ...createdCategory,
            type: "service-list",
            iframeUrl: ""
          });
          state.config.categoryBookmarkOrder = state.config.categoryBookmarkOrder || {};
          state.config.categoryBookmarkOrder[createdCategory.id] = [];
        }
      }
      await persistConfig();
      render();
    }
  });

  const typeSelect = form.querySelector("select[name='type'][data-category-type]");
  const iframeUrlRow = form.querySelector("[data-iframe-url-row]");
  const iframeUrlInput = iframeUrlRow?.querySelector("input[name='iframeUrl']");
  const syncTypeFields = () => {
    if (!typeSelect || !iframeUrlRow) return;
    const nextType = normalizeCategoryType(typeSelect.value);
    const showIframe = nextType === "iframe";
    iframeUrlRow.classList.toggle("hidden", !showIframe);
    if (iframeUrlInput) {
      iframeUrlInput.required = showIframe;
      if (!showIframe) {
        iframeUrlInput.value = "";
        iframeUrlInput.setCustomValidity("");
      }
    }
  };
  typeSelect?.addEventListener("change", syncTypeFields);
  iframeUrlInput?.addEventListener("input", () => iframeUrlInput.setCustomValidity(""));
  syncTypeFields();

  const input = form.querySelector("input[name='icon']");
  const results = form.querySelector("[data-icon-results]");
  const selectedPreview = form.querySelector("[data-selected-icon-preview]");
  const applySelectedIcon = (iconName) => {
    const normalizedName = normalizeMdiIconName(iconName);
    input.value = normalizedName;
    selectedPreview.innerHTML = mdiIcon(normalizedName, "icon-preview icon-preview--theme");
  };
  const renderIconResults = () => {
    const query = String(input.value || "");
    const filtered = getMdiSearchResults(query, 32);
    results.classList.toggle("is-open", filtered.length > 0);
    results.innerHTML = filtered
      .map((entry) => `<button type="button" class="icon-search-item" data-icon-pick="${entry.icon}">${mdiIcon(entry.icon, "icon-preview icon-preview--theme")}<span>${entry.label}</span></button>`)
      .join("");
    results.querySelectorAll("[data-icon-pick]").forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        applySelectedIcon(buttonEl.dataset.iconPick);
        results.classList.remove("is-open");
        results.innerHTML = "";
      });
    });
  };
  input.addEventListener("focus", renderIconResults);
  input.addEventListener("input", renderIconResults);
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      results.classList.remove("is-open");
      results.innerHTML = "";
      if (!mdiRegistry.byName.has(String(input.value || "").toLowerCase())) {
        applySelectedIcon(category?.icon || FALLBACK_MDI_ICON);
      } else {
        applySelectedIcon(input.value);
      }
    }, 120);
  });
  form.querySelectorAll("[data-color-pick]").forEach((colorButton) => {
    colorButton.addEventListener("click", () => {
      form.querySelector("input[name='color']").value = colorButton.dataset.color;
      form.querySelectorAll("[data-color-pick]").forEach((entry) => entry.classList.remove("is-active"));
      colorButton.classList.add("is-active");
    });
  });
  form.querySelectorAll("[data-slot-pick]").forEach((slotButton) => {
    slotButton.addEventListener("click", () => {
      const nextSlots = normalizeCategorySlots(slotButton.dataset.slotPick);
      form.querySelector("input[name='slots']").value = String(nextSlots);
      form.querySelectorAll("[data-slot-pick]").forEach((entry) => entry.classList.remove("active"));
      slotButton.classList.add("active");
    });
  });
  applySelectedIcon(category?.icon || FALLBACK_MDI_ICON);
  results.classList.remove("is-open");
  results.innerHTML = "";
}

function renderBookmarkPlacementFields({
  homepageEnabled,
  homepageCategoryId,
  selectedSidebarIds
} = {}) {
  const sidebarSelected = new Set(selectedSidebarIds || []);
  const homepageCategories = listBookmarkListCategories(state.config);
  const homepageOptions = homepageCategories
    .map((category) => {
      const selected = category.id === homepageCategoryId ? "selected" : "";
      return `<option value="${escapeHtml(category.id)}" ${selected}>${escapeHtml(category.name)}</option>`;
    })
    .join("");
  const sidebarOptions = listSidebarCategories(state.config)
    .map((category) => {
      const checked = sidebarSelected.has(category.id) ? "checked" : "";
      return `
        <label class="checkbox-option">
          <input type="checkbox" name="sidebarCategoryIds" value="${escapeHtml(category.id)}" ${checked} />
          <span>${escapeHtml(category.name)}</span>
        </label>
      `;
    })
    .join("");

  return `
    <div class="bookmark-placement-row">
      <label class="checkbox-option bookmark-placement-row__toggle">
        <input
          type="checkbox"
          name="homepageEnabled"
          data-homepage-toggle
          ${homepageEnabled ? "checked" : ""}
        />
        <span>${escapeHtml(getHomepageName())}</span>
      </label>
      <select
        name="homepageCategoryId"
        data-homepage-category
        class="bookmark-placement-row__select"
        ${homepageEnabled ? "" : "disabled"}
      >
        <option value="">${escapeHtml(t("ui.homepageCategoryPlaceholder"))}</option>
        ${homepageOptions}
      </select>
    </div>
    <label class="checkbox-option">
      <input
        type="checkbox"
        name="sidebarCategoryIds"
        value="${FAVORITES_CATEGORY_ID}"
        ${sidebarSelected.has(FAVORITES_CATEGORY_ID) ? "checked" : ""}
      />
      <span>${escapeHtml(t("ui.navFavorites"))}</span>
    </label>
    ${sidebarOptions}
    <small class="bookmark-unsorted-hint hidden" data-unsorted-hint>${escapeHtml(t("ui.bookmarkUnsortedHint"))}</small>
  `;
}

function bookmarkSourceLabel(source) {
  const key = BOOKMARK_SOURCE_LABEL_KEYS[normalizeBookmarkSource(source)];
  return key ? t(key) : normalizeBookmarkSource(source);
}

function openBookmarkModal(arg = {}) {
  const options = typeof arg === "string" ? { homepageCategoryId: arg } : arg;
  const bookmark = options.bookmark ?? null;
  const defaultHomepageCategoryId = options.homepageCategoryId || "";
  const isEdit = Boolean(bookmark);
  const existing = isEdit ? findBookmarkById(state.config, bookmark.id) : null;
  const homepageCategoryId = existing
    ? getBookmarkHomepageCategoryId(state.config, existing)
    : defaultHomepageCategoryId;
  const homepageEnabled = Boolean(homepageCategoryId);
  const selectedSidebarIds = existing
    ? getBookmarkSidebarPlacementIds(existing)
    : [];
  const form = document.createElement("form");
  const previewImgSrc = existing ? bookmarkStoredImageSrc(existing) : resolveIconSrcForImgTag("");
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.title")}</label>
      <input name="title" value="${existing?.title || ""}" required />
    </div>
    <div class="form-row">
      <label>${t("ui.url")}</label>
      <input name="url" type="url" value="${existing?.url || ""}" required />
    </div>
    <div class="form-row">
      <label>${t("ui.description")}</label>
      <textarea name="description" rows="2">${existing?.description || ""}</textarea>
    </div>
    <div class="form-row">
      <label>${t("ui.image")}</label>
      <div>
        <div class="icon-url-controls">
          <input name="image" value="${existing?.image || ""}" />
          <div class="icon-preview-box">
            <span id="favicon-spinner" class="spinner hidden" aria-hidden="true"></span>
            <img id="favicon-preview" class="icon-preview" src="${previewImgSrc}" alt="" />
          </div>
          <button type="button" class="btn btn--ghost btn--compact" data-fetch-favicon>${t("ui.fetchFavicon")}</button>
        </div>
        <small id="favicon-status"></small>
      </div>
    </div>
    <div class="form-row form-row--bookmark-placements">
      <label>${t("ui.bookmarkCategories")}</label>
      <div class="checkbox-group" data-bookmark-placements>
        ${renderBookmarkPlacementFields({ homepageEnabled, homepageCategoryId, selectedSidebarIds })}
      </div>
    </div>
    ${isEdit ? `
      <div class="form-row">
        <label>${t("ui.source")}</label>
        <input value="${bookmarkSourceLabel(existing?.source)}" readonly disabled />
      </div>
    ` : ""}
    <div class="form-row">
      <label>${t("ui.openMode")}</label>
      <select name="openMode">
        <option value="current-tab" ${existing?.openMode !== "new-tab" ? "selected" : ""}>${t("ui.currentTab")}</option>
        <option value="new-tab" ${existing?.openMode === "new-tab" ? "selected" : ""}>${t("ui.newTab")}</option>
      </select>
    </div>
    <div class="form-row form-row--shortcut">
      <label>${t("ui.shortcut")}</label>
      <div class="shortcut-input-wrap">
        <button type="button" class="shortcut-input" data-shortcut-capture data-enter-submit="false">
          <span class="shortcut-input-placeholder">${t("ui.shortcutPlaceholder")}</span>
          <span class="shortcut-input-chips"></span>
        </button>
        <small class="shortcut-feedback" data-shortcut-feedback></small>
      </div>
    </div>
  `;

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.bookmark")}` : t("ui.addBookmark"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    leadingActions: isEdit ? [{
      label: t("ui.delete"),
      icon: ICONS.trash,
      onClick: async () => {
        const confirmed = await confirmDeleteBookmark(existing);
        if (!confirmed) return false;
        pushUndo();
        removeBookmarkFromConfig(state.config, existing.id);
        await persistConfig();
        render();
      }
    }] : [],
    onSave: async () => {
      if (!form.reportValidity()) return false;
      if (!validateShortcut()) return false;
      const fd = new FormData(form);
      const homepageEnabled = Boolean(form.querySelector("[data-homepage-toggle]")?.checked);
      const homepageCategorySelect = form.querySelector("[data-homepage-category]");
      const homepageCategoryIdValue = String(homepageCategorySelect?.value || "").trim();
      const listCategoryIds = new Set(listBookmarkListCategories(state.config).map((category) => category.id));
      const sidebarCategoryIds = [
        ...new Set(fd.getAll("sidebarCategoryIds").map((id) => String(id || "").trim()).filter(Boolean))
      ];

      form.querySelector("[data-bookmark-placements]")?.removeAttribute("data-invalid");
      homepageCategorySelect?.removeAttribute("data-invalid");

      let categoryIds = [];
      if (homepageEnabled) {
        if (!homepageCategoryIdValue || !listCategoryIds.has(homepageCategoryIdValue)) {
          form.querySelector("[data-bookmark-placements]")?.setAttribute("data-invalid", "true");
          homepageCategorySelect?.setAttribute("data-invalid", "true");
          return false;
        }
        categoryIds = [homepageCategoryIdValue];
      }

      const image = normalizeBookmarkImageValue(fd.get("image"));

      const applyPlacementUpdates = (entry, bookmarkId, previousCategoryIds, previousSidebarIds) => {
        entry.title = String(fd.get("title") || "").trim();
        entry.url = String(fd.get("url") || "").trim();
        entry.description = String(fd.get("description") || "").trim();
        entry.image = image;
        entry.openMode = fd.get("openMode");
        entry.shortcut = selectedShortcut;
        entry.favorite = false;
        entry.sidebarCategoryIds = sidebarCategoryIds;
        const preservedNonListCategoryIds = (entry.categoryIds || []).filter((id) => !listCategoryIds.has(id));
        entry.categoryIds = homepageEnabled
          ? [...preservedNonListCategoryIds, ...categoryIds]
          : preservedNonListCategoryIds;

        for (const cid of categoryIds) {
          ensureBookmarkInCategoryOrder(state.config, cid, bookmarkId);
        }
        for (const cid of previousCategoryIds) {
          if (!categoryIds.includes(cid)) {
            removeBookmarkFromCategoryOrder(state.config, cid, bookmarkId);
          }
        }
        for (const cid of sidebarCategoryIds) {
          if (cid === FAVORITES_CATEGORY_ID) continue;
          if (findSidebarCategoryById(state.config, cid)) {
            ensureBookmarkInSidebarCategoryOrder(state.config, cid, bookmarkId);
          }
        }
        for (const cid of previousSidebarIds) {
          if (sidebarCategoryIds.includes(cid) || cid === FAVORITES_CATEGORY_ID) continue;
          removeBookmarkFromSidebarCategoryOrder(state.config, cid, bookmarkId);
        }
      };

      pushUndo();
      let createdBookmarkId = "";
      if (isEdit) {
        const previousCategoryIds = (existing.categoryIds || []).filter((id) => listCategoryIds.has(id));
        const previousSidebarIds = getBookmarkSidebarPlacementIds(existing);
        applyPlacementUpdates(existing, existing.id, previousCategoryIds, previousSidebarIds);
      } else {
        const created = {
          id: uid(),
          title: String(fd.get("title") || "").trim(),
          url: String(fd.get("url") || "").trim(),
          description: String(fd.get("description") || "").trim(),
          image,
          categoryIds: [],
          sidebarCategoryIds,
          favorite: false,
          source: DEFAULT_BOOKMARK_SOURCE,
          openMode: fd.get("openMode"),
          shortcut: selectedShortcut
        };
        state.config.bookmarks.push(created);
        createdBookmarkId = created.id;
        applyPlacementUpdates(created, created.id, [], []);
      }
      await persistConfig();
      render();
      if (createdBookmarkId) {
        void applyBookmarkMetadata(createdBookmarkId, { pushUndoOnChange: false });
      }
    }
  });

  const imageInput = form.querySelector("input[name='image']");
  const urlInput = form.querySelector("input[name='url']");
  const shortcutCapture = form.querySelector("[data-shortcut-capture]");
  const shortcutChips = shortcutCapture?.querySelector(".shortcut-input-chips");
  const shortcutPlaceholder = shortcutCapture?.querySelector(".shortcut-input-placeholder");
  const shortcutFeedback = form.querySelector("[data-shortcut-feedback]");
  const fetchFaviconButton = form.querySelector("[data-fetch-favicon]");
  const status = form.querySelector("#favicon-status");
  const spinner = form.querySelector("#favicon-spinner");
  const preview = form.querySelector("#favicon-preview");

  let selectedShortcut = normalizeServiceShortcut(existing?.shortcut || "");
  const updateShortcutFeedback = (message = "", isError = false) => {
    if (!shortcutFeedback) return;
    shortcutFeedback.textContent = message;
    shortcutFeedback.classList.toggle("is-error", isError);
  };
  const updateShortcutUI = () => {
    if (!shortcutChips || !shortcutPlaceholder) return;
    shortcutChips.innerHTML = renderShortcutChips(selectedShortcut, "shortcut-chip");
    shortcutPlaceholder.classList.toggle("hidden", Boolean(selectedShortcut));
  };
  const validateShortcut = () => {
    if (!selectedShortcut) {
      updateShortcutFeedback("");
      return true;
    }
    if (isReservedShortcut(selectedShortcut)) {
      updateShortcutFeedback(t("ui.shortcutReserved"), true);
      return false;
    }
    const conflict = findShortcutUsage(selectedShortcut, { skipBookmarkId: existing?.id || "" });
    if (conflict) {
      updateShortcutFeedback(getShortcutConflictMessage(conflict), true);
      return false;
    }
    updateShortcutFeedback("");
    return true;
  };
  shortcutCapture?.addEventListener("keydown", (event) => {
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      selectedShortcut = "";
      updateShortcutUI();
      validateShortcut();
      return;
    }
    if (event.key === "Escape") {
      shortcutCapture.blur();
      return;
    }
    const nextShortcut = shortcutFromKeyboardEvent(event);
    if (!nextShortcut) return;
    selectedShortcut = normalizeServiceShortcut(nextShortcut);
    updateShortcutUI();
    validateShortcut();
  });
  shortcutCapture?.addEventListener("click", () => {
    shortcutCapture.focus();
  });

  const syncIconPreviewFromField = () => {
    const v = String(imageInput.value || "").trim();
    preview.src = resolveBookmarkPreviewSrc(v);
  };

  imageInput.addEventListener("input", () => {
    status.textContent = "";
    syncIconPreviewFromField();
  });

  preview.addEventListener("error", () => {
    const manualValue = String(imageInput.value || "").trim();
    if (manualValue) {
      status.textContent = t("ui.faviconFailed");
      return;
    }
    preview.src = resolveServiceIconDisplaySrc("");
  });
  preview.addEventListener("load", () => {
    status.textContent = "";
  });

  const triggerFaviconLoad = async () => {
    const value = String(urlInput.value || "").trim();
    if (!value) return;
    fetchFaviconButton.disabled = true;
    state.faviconLoading = true;
    spinner.classList.remove("hidden");
    status.textContent = "";
    try {
      const result = await api.cacheFavicon(value);
      const path = normalizeAppIconPath(String(result.path || "").trim());
      if (!path.startsWith("/static/assets/favicon-cache/")) {
        throw new Error("Missing cache path");
      }
      imageInput.value = path;
      syncIconPreviewFromField();
      status.textContent = "";
    } catch (err) {
      const detail = err && typeof err.message === "string" ? err.message.trim() : "";
      status.textContent = detail || t("ui.faviconFailed");
      syncIconPreviewFromField();
    } finally {
      fetchFaviconButton.disabled = false;
      state.faviconLoading = false;
      spinner.classList.add("hidden");
    }
  };

  fetchFaviconButton.addEventListener("click", triggerFaviconLoad);

  const homepageToggle = form.querySelector("[data-homepage-toggle]");
  const homepageCategorySelect = form.querySelector("[data-homepage-category]");
  const unsortedHint = form.querySelector("[data-unsorted-hint]");
  const placementGroup = form.querySelector("[data-bookmark-placements]");

  const syncHomepageCategorySelect = () => {
    const enabled = Boolean(homepageToggle?.checked);
    if (!homepageCategorySelect) return;
    homepageCategorySelect.disabled = !enabled;
    if (!enabled) homepageCategorySelect.removeAttribute("data-invalid");
  };

  const syncUnsortedHint = () => {
    if (!unsortedHint) return;
    const homepageActive = Boolean(homepageToggle?.checked);
    const sidebarActive = form.querySelectorAll('input[name="sidebarCategoryIds"]:checked').length > 0;
    unsortedHint.classList.toggle("hidden", homepageActive || sidebarActive);
  };

  const syncPlacementState = () => {
    placementGroup?.removeAttribute("data-invalid");
    homepageCategorySelect?.removeAttribute("data-invalid");
    syncHomepageCategorySelect();
    syncUnsortedHint();
  };

  homepageToggle?.addEventListener("change", syncPlacementState);
  homepageCategorySelect?.addEventListener("change", syncPlacementState);
  form.querySelectorAll('input[name="sidebarCategoryIds"]').forEach((input) => {
    input.addEventListener("change", syncPlacementState);
  });
  syncPlacementState();
  syncIconPreviewFromField();
  updateShortcutUI();
  validateShortcut();
}

function openSettingsModal() {
  const form = document.createElement("form");
  form.className = "settings-form";
  const currentStrength = normalizeCategoryAccentStrength(state.settings.categoryAccentStrength);
  const currentStrengthPercent = `${currentStrength}%`;
  const currentElementSize = normalizeElementSize(state.settings.elementSize);
  const themeButtons = state.themes
    .map((theme) => `<button type="button" class="theme-option ${state.settings.theme === theme ? "active" : ""}" data-theme="${theme}">${theme}</button>`)
    .join("");
  const languageOptions = state.languages
    .map((lang) => `<option value="${lang.code}" ${state.settings.language === lang.code ? "selected" : ""}>${lang.name}</option>`)
    .join("");
  const globalShortcuts = normalizeGlobalShortcuts(state.settings.globalShortcuts);
  const browserSync = normalizeBrowserSyncSettings(state.settings.browserSync);
  if (!state.settings.browserSync) state.settings.browserSync = browserSync;
  const shortcutRows = GLOBAL_SHORTCUT_ACTIONS.map((action) => `
    <div class="form-row form-row--shortcut-option">
      <label class="settings-shortcut-name" data-global-shortcut-label="${action.id}">${getGlobalShortcutLabel(action.id)}</label>
      <div class="shortcut-input-wrap">
        <button type="button" class="shortcut-input" data-shortcut-capture data-global-shortcut="${action.id}" data-enter-submit="false">
          <span class="shortcut-input-placeholder" data-shortcut-placeholder>${t("ui.shortcutPlaceholder")}</span>
          <span class="shortcut-input-chips"></span>
        </button>
        <small class="shortcut-feedback" data-shortcut-feedback="${action.id}"></small>
      </div>
    </div>
  `).join("");
  form.innerHTML = `
    <div class="form-row">
      <label data-settings-name-label>${t("ui.homepageName")}</label>
      <input name="appTitle" value="${state.settings.appTitle ?? ""}" />
    </div>
    <div class="form-row">
      <label data-settings-theme-label>${t("ui.theme")}</label>
      <div>
        <div class="theme-options theme-picker">${themeButtons}</div>
        <input name="theme" value="${state.settings.theme}" hidden />
      </div>
    </div>
    <div class="form-row">
      <label data-settings-language-label>${t("ui.language")}</label>
      <div class="select-wrap">
        <select name="language">${languageOptions}</select>
        <span class="select-chevron">${iconSvg(ICONS.chevron, "inline-icon")}</span>
      </div>
    </div>
    <div class="form-row form-row--range">
      <label data-settings-accent-label>${t("ui.categoryAccentStrength")}</label>
      <div class="range-control" style="--range-percent:${currentStrengthPercent}">
        <input name="categoryAccentStrength" type="range" min="0" max="100" step="5" value="${currentStrength}" />
        <small class="range-value" data-category-accent-strength-value style="left:${currentStrengthPercent}">${currentStrengthPercent}</small>
      </div>
    </div>
    <div class="form-row">
      <label data-settings-element-size-label>${t("ui.elementSize")}</label>
      <div class="element-size-options">
        ${ELEMENT_SIZE_OPTIONS.map((size) => `<button type="button" class="theme-option ${currentElementSize === size ? "active" : ""}" data-element-size="${size}">${t(`ui.size${size.charAt(0).toUpperCase()}${size.slice(1)}`)}</button>`).join("")}
      </div>
    </div>
    <div class="settings-section-header">
      <div class="settings-section-title" data-settings-browser-sync-title>${t("ui.browserSync")}</div>
      <label class="toggle-switch" title="${t("ui.browserSyncEnabled")}">
        <input id="browser-sync-enabled" name="browserSyncEnabled" type="checkbox" aria-label="${t("ui.browserSyncEnabled")}" ${browserSync.enabled ? "checked" : ""} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label data-settings-browser-sync-url-label for="browser-sync-url">${t("ui.browserSyncGithubUrl")}</label>
      <input id="browser-sync-url" name="githubFileUrl" type="url" value="${browserSync.githubFileUrl}" placeholder="https://github.com/user/repo/blob/main/bookmarks.xbel" />
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label data-settings-browser-sync-pat-label for="browser-sync-pat">${t("ui.browserSyncGithubPat")}</label>
      <input id="browser-sync-pat" name="githubPat" type="password" value="${browserSync.githubPat}" autocomplete="off" />
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label data-settings-browser-sync-interval-label for="browser-sync-interval">${t("ui.browserSyncInterval")}</label>
      <input id="browser-sync-interval" name="syncIntervalHours" type="number" min="1" max="168" step="1" value="${browserSync.syncIntervalHours}" />
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label>${t("ui.browserSyncStatus")}</label>
      <div>
        <small class="browser-sync-status" data-browser-sync-status>${t("ui.browserSyncLoading")}</small>
        <button type="button" class="btn btn--ghost" data-browser-sync-run><span class="btn__label">${t("ui.browserSyncRunNow")}</span></button>
      </div>
    </div>
    <div class="settings-section-title" data-settings-shortcuts-label>${t("ui.shortcuts")}</div>
    <div class="settings-shortcuts-list">
      ${shortcutRows}
    </div>
    <div class="form-row settings-actions-block" role="group" aria-labelledby="settings-actions-heading">
      <label id="settings-actions-heading" data-settings-actions-label for="restart-app-btn">${t("ui.actions")}</label>
      <div>
        <button type="button" class="btn btn--ghost" id="restart-app-btn" data-restart-app><span class="btn__icon">${iconSvg(ICONS.restart, "inline-icon")}</span><span class="btn__label" data-settings-restart-label>${t("ui.restartApp")}</span></button>
      </div>
    </div>
  `;
  form.querySelector("[data-restart-app]")?.addEventListener("click", () => {
    void runAppRestartFromSettings();
  });
  const browserSyncEnabledInput = form.querySelector("input[name='browserSyncEnabled']");
  const browserSyncUrlInput = form.querySelector("input[name='githubFileUrl']");
  const browserSyncPatInput = form.querySelector("input[name='githubPat']");
  const browserSyncIntervalInput = form.querySelector("input[name='syncIntervalHours']");
  const browserSyncStatusEl = form.querySelector("[data-browser-sync-status]");
  const browserSyncRunBtn = form.querySelector("[data-browser-sync-run]");
  const applyBrowserSyncToState = () => {
    state.settings.browserSync = normalizeBrowserSyncSettings({
      enabled: Boolean(browserSyncEnabledInput?.checked),
      githubFileUrl: browserSyncUrlInput?.value || "",
      githubPat: browserSyncPatInput?.value || "",
      syncIntervalHours: browserSyncIntervalInput?.value || 6
    });
  };
  const refreshBrowserSyncStatus = async () => {
    if (!browserSyncStatusEl) return;
    try {
      const status = await api.getBrowserSyncStatus();
      browserSyncStatusEl.textContent = formatBrowserSyncStatusLine(status);
    } catch {
      browserSyncStatusEl.textContent = t("ui.browserSyncStatusFailed");
    }
  };
  browserSyncEnabledInput?.addEventListener("change", () => {
    applyBrowserSyncToState();
    updateBrowserSyncFieldsVisibility(form, state.settings.browserSync.enabled);
    scheduleSettingsPersist(0);
  });
  browserSyncUrlInput?.addEventListener("input", () => {
    applyBrowserSyncToState();
    scheduleSettingsPersist();
  });
  browserSyncPatInput?.addEventListener("input", () => {
    applyBrowserSyncToState();
    scheduleSettingsPersist();
  });
  browserSyncIntervalInput?.addEventListener("input", () => {
    applyBrowserSyncToState();
    scheduleSettingsPersist();
  });
  browserSyncRunBtn?.addEventListener("click", async () => {
    applyBrowserSyncToState();
    await api.saveSettings(deepClone(state.settings));
    browserSyncRunBtn.disabled = true;
    browserSyncStatusEl.textContent = t("ui.browserSyncRunning");
    try {
      const result = await api.runBrowserSync();
      if (result?.ok) {
        state.config = normalizeConfig(await api.getConfig());
        render();
      }
      await refreshBrowserSyncStatus();
    } catch {
      browserSyncStatusEl.textContent = t("ui.browserSyncStatusFailed");
    } finally {
      browserSyncRunBtn.disabled = !state.settings.browserSync.enabled;
    }
  });
  updateBrowserSyncFieldsVisibility(form, browserSync.enabled);
  void refreshBrowserSyncStatus();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  const scheduleSettingsPersist = (delayMs = 250) => {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      const snapshot = deepClone(state.settings);
      persistChain = persistChain
        .then(async () => {
          await api.saveSettings(snapshot);
        })
        .catch(() => {});
    }, delayMs);
  };
  form.querySelector("input[name='appTitle']")?.addEventListener("input", (event) => {
    state.settings.appTitle = event.target.value;
    updateAppTitleUI();
    renderSidebar();
    scheduleSettingsPersist();
  });
  form.querySelector("select[name='language']")?.addEventListener("change", async (event) => {
    state.settings.language = event.target.value;
    await initI18n(state.settings.language);
    refreshStaticLocalizedTexts();
    refreshSettingsModalTexts(form);
    scheduleSettingsPersist(0);
  });
  form.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      form.querySelector("input[name='theme']").value = button.dataset.theme;
      form.querySelectorAll("[data-theme]").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.settings.theme = button.dataset.theme;
      applyTheme(state.settings.theme);
      scheduleSettingsPersist(0);
    });
  });
  form.querySelectorAll("[data-element-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSize = normalizeElementSize(button.dataset.elementSize);
      state.settings.elementSize = nextSize;
      applyElementSize(nextSize);
      form.querySelectorAll("[data-element-size]").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      scheduleSettingsPersist(0);
    });
  });
  const globalShortcutState = { ...globalShortcuts };
  const updateGlobalShortcutFeedback = (actionId, message = "", isError = false) => {
    const feedback = form.querySelector(`[data-shortcut-feedback="${actionId}"]`);
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  };
  const updateGlobalShortcutUI = (actionId) => {
    const capture = form.querySelector(`[data-global-shortcut="${actionId}"]`);
    if (!capture) return;
    const chips = capture.querySelector(".shortcut-input-chips");
    const placeholder = capture.querySelector(".shortcut-input-placeholder");
    const current = normalizeServiceShortcut(globalShortcutState[actionId]);
    chips.innerHTML = renderShortcutChips(current, "shortcut-chip");
    placeholder.classList.toggle("hidden", Boolean(current));
  };
  const setGlobalShortcut = (actionId, nextShortcut) => {
    const normalizedShortcut = normalizeServiceShortcut(nextShortcut);
    if (!normalizedShortcut) {
      globalShortcutState[actionId] = "";
      state.settings.globalShortcuts = { ...globalShortcutState };
      updateGlobalShortcutFeedback(actionId, "", false);
      updateGlobalShortcutUI(actionId);
      updateTopbarActionTexts();
      scheduleSettingsPersist(0);
      return;
    }
    if (isReservedShortcut(normalizedShortcut)) {
      updateGlobalShortcutFeedback(actionId, t("ui.shortcutReserved"), true);
      return;
    }
    const conflict = findShortcutUsage(normalizedShortcut, { skipGlobalAction: actionId });
    if (conflict) {
      updateGlobalShortcutFeedback(actionId, getShortcutConflictMessage(conflict), true);
      return;
    }
    globalShortcutState[actionId] = normalizedShortcut;
    state.settings.globalShortcuts = { ...globalShortcutState };
    updateGlobalShortcutFeedback(actionId, "", false);
    updateGlobalShortcutUI(actionId);
    updateTopbarActionTexts();
    scheduleSettingsPersist(0);
  };
  form.querySelectorAll("[data-shortcut-capture][data-global-shortcut]").forEach((capture) => {
    const actionId = capture.dataset.globalShortcut;
    capture.addEventListener("keydown", (event) => {
      event.preventDefault();
      if (event.key === "Backspace" || event.key === "Delete") {
        setGlobalShortcut(actionId, "");
        return;
      }
      if (event.key === "Escape") {
        capture.blur();
        return;
      }
      const nextShortcut = shortcutFromKeyboardEvent(event);
      if (!nextShortcut) return;
      setGlobalShortcut(actionId, nextShortcut);
    });
    capture.addEventListener("click", () => {
      capture.focus();
    });
    capture.addEventListener("focus", () => {
      updateGlobalShortcutFeedback(actionId, "", false);
    });
    updateGlobalShortcutUI(actionId);
  });
  const categoryAccentStrengthInput = form.querySelector("input[name='categoryAccentStrength']");
  const categoryAccentStrengthValue = form.querySelector("[data-category-accent-strength-value]");
  const positionRangeTooltip = () => {
    if (!categoryAccentStrengthInput || !categoryAccentStrengthValue) return;
    const min = Number(categoryAccentStrengthInput.min || 0);
    const max = Number(categoryAccentStrengthInput.max || 100);
    const value = Number(categoryAccentStrengthInput.value || min);
    const range = max - min;
    const ratio = range > 0 ? (value - min) / range : 0;
    const inputWidth = categoryAccentStrengthInput.clientWidth;
    const thumbSize = 18;
    const x = (thumbSize / 2) + (Math.min(1, Math.max(0, ratio)) * Math.max(0, inputWidth - thumbSize));
    categoryAccentStrengthValue.style.left = `${x}px`;
  };
  const showRangeTooltip = () => categoryAccentStrengthValue.classList.add("is-visible");
  const hideRangeTooltip = () => categoryAccentStrengthValue.classList.remove("is-visible");
  categoryAccentStrengthInput?.addEventListener("input", () => {
    const normalized = normalizeCategoryAccentStrength(categoryAccentStrengthInput.value);
    const normalizedPercent = `${normalized}%`;
    const rangeControl = categoryAccentStrengthInput.closest(".range-control");
    categoryAccentStrengthInput.value = String(normalized);
    if (rangeControl) rangeControl.style.setProperty("--range-percent", normalizedPercent);
    categoryAccentStrengthValue.textContent = normalizedPercent;
    positionRangeTooltip();
    state.settings.categoryAccentStrength = normalized;
    applyCategoryAccentStrength(normalized);
    scheduleSettingsPersist();
  });
  categoryAccentStrengthInput?.addEventListener("pointerdown", () => {
    positionRangeTooltip();
    showRangeTooltip();
  });
  categoryAccentStrengthInput?.addEventListener("pointerup", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("pointercancel", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("blur", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("keydown", () => {
    positionRangeTooltip();
    showRangeTooltip();
  });
  categoryAccentStrengthInput?.addEventListener("keyup", hideRangeTooltip);
  const resizeHandler = () => positionRangeTooltip();
  window.addEventListener("resize", resizeHandler);
  positionRangeTooltip();

  showModal({
    title: t("ui.settings"),
    content: form,
    cancelLabel: t("ui.close"),
    showSave: false,
    cancelVariant: "",
    submitOnEnter: false,
    modalClass: "modal--settings",
    onCancel: () => {
      window.removeEventListener("resize", resizeHandler);
    }
  });
}

function captureElementPositions(selector, keyBuilder) {
  const map = new Map();
  document.querySelectorAll(selector).forEach((element) => {
    const key = keyBuilder(element);
    if (!key) return;
    map.set(key, element.getBoundingClientRect());
  });
  return map;
}

function animatePositionChanges(selector, keyBuilder) {
  const before = captureElementPositions(selector, keyBuilder);
  render();
  const after = captureElementPositions(selector, keyBuilder);
  const afterElements = new Map();
  document.querySelectorAll(selector).forEach((entry) => {
    const key = keyBuilder(entry);
    if (!key) return;
    afterElements.set(key, entry);
  });
  for (const [key, oldRect] of before) {
    const nextRect = after.get(key);
    if (!nextRect) continue;
    const element = afterElements.get(key);
    if (!element) continue;
    const deltaX = oldRect.left - nextRect.left;
    const deltaY = oldRect.top - nextRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
    element.classList.add("is-swap-animating");
    const keyframes = [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: "translate(0px, 0px)" }
    ];
    const timing = { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    if (typeof element.animate === "function") {
      const animation = element.animate(keyframes, timing);
      animation.addEventListener("finish", () => {
        element.classList.remove("is-swap-animating");
      });
      animation.addEventListener("cancel", () => {
        element.classList.remove("is-swap-animating");
      });
      continue;
    }
    element.style.transform = keyframes[0].transform;
    element.getBoundingClientRect();
    element.style.transform = keyframes[1].transform;
    window.setTimeout(() => {
      element.classList.remove("is-swap-animating");
      element.style.transform = "";
    }, timing.duration + 30);
  }
}

async function swapCategoryByStep(categoryId, step) {
  if (!state.editMode) return;
  const list = state.config.categories;
  const from = list.findIndex((entry) => entry.id === categoryId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;
  pushUndo();
  [list[from], list[to]] = [list[to], list[from]];
  await persistConfig();
  animatePositionChanges(".category[data-category-id]", (element) => `category-${element.dataset.categoryId}`);
}

async function swapBookmarkByStep(categoryId, bookmarkId, step) {
  if (!state.editMode) return;
  const isSidebarCategory = isCategoryNavId(state.config, categoryId);
  const orderKey = isSidebarCategory ? "sidebarCategoryBookmarkOrder" : "categoryBookmarkOrder";
  const getOrderedBookmarks = isSidebarCategory
    ? getBookmarksForSidebarCategory
    : getBookmarksForCategory;
  if (!state.config[orderKey]) state.config[orderKey] = {};
  const list = [
    ...(state.config[orderKey][categoryId] || getOrderedBookmarks(state.config, categoryId).map((bookmark) => bookmark.id))
  ];
  const from = list.findIndex((entry) => entry === bookmarkId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;
  pushUndo();
  [list[from], list[to]] = [list[to], list[from]];
  state.config[orderKey][categoryId] = list;
  await persistConfig();
  const selector = isSidebarCategory
    ? `.bookmark-collection .bookmark-item[data-bookmark-id]`
    : `.category[data-category-id="${categoryId}"] .bookmark-item[data-bookmark-id]`;
  animatePositionChanges(selector, (element) => `bookmark-${categoryId}-${element.dataset.bookmarkId}`);
}

ensureSidebarShell();
bindSidebarEvents();

bootstrap().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});
