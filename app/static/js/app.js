import { api } from "./api.js";
import { showModal, showStatusModal, dismissActiveModalListeners } from "./modal.js";
import { showToast, updateToast, closeToast } from "./toast.js";
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
  UNSORTED_CATEGORY_ID,
  getBookmarksForCategory,
  getBookmarksForSidebarCategory,
  getBookmarkHomepageCategoryId,
  getBookmarkSidebarPlacementIds,
  findBookmarkById,
  findSidebarCategoryById,
  normalizeBookmarkImageSource,
  ensureBookmarkInCategoryOrder,
  ensureBookmarkInSidebarCategoryOrder,
  removeBookmarkFromCategoryOrder,
  removeBookmarkFromSidebarCategoryOrder,
  removeCategoryFromConfig,
  removeBookmarkFromConfig,
  listBookmarkListCategories,
  listSidebarCategories,
  allocateSidebarCategorySlug,
  assignBookmarkToCustomSidebarCategory,
  removeSidebarCategoryFromConfig,
  deleteSidebarCategoryFromConfig,
  getHomepageCategories,
  shouldShowUnsortedBrowserImportPath,
  collectUnsortedBrowserFolderPaths,
  filterBookmarksByBrowserFolderPaths,
  bookmarkTimestampNow
} from "./bookmarks.js";
import {
  NAV_ALL,
  NAV_FAVORITES,
  NAV_UNSORTED,
  VIEW_LIST,
  VIEW_CARDS,
  SYSTEM_NAV_ITEMS,
  normalizeNavViewModes,
  normalizeActiveNavId,
  getNavViewMode,
  setNavViewMode,
  normalizeNavSortSettings,
  getNavSortSetting,
  setNavSortSetting,
  sortNavBookmarks,
  SORT_FIELD_NAME,
  SORT_FIELD_CREATED_AT,
  SORT_ORDER_ASC,
  SORT_ORDER_DESC,
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
  escapeHtml,
  openBookmarkUrl
} from "./bookmark-views.js";
import { initBookmarkSearch, refreshBookmarkSearchTexts } from "./bookmark-search.js";
import { bindBookmarkDrag, initBookmarkDragDrop, SIDEBAR_ADD_CATEGORY_DROP_ID } from "./bookmark-drag.js";

const EDIT_MODE_URL_KEY = "edit";
let editModeHistoryPushed = false;
const unsortedBrowserFolderFilter = new Set();
let unsortedFolderFilterDropdownOpen = false;
let unsortedFolderFilterSearchQuery = "";
let unsortedFolderFilterDismissBound = false;
let bookmarkSortDropdownOpen = false;
let bookmarkSortDismissBound = false;
let navSelectionMode = false;
const navSelectedBookmarkIds = new Set();
let activeSidebarCategoryMenu = null;
let sidebarCategoryMenuOverlay = null;
let sidebarCategoryMenuDismissBound = false;
let navSelectionAnchorId = null;
const navSelectionPreviewIds = new Set();
let navSelectionEventsBound = false;

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
    navViewModes: {},
    navSortSettings: {},
    sidebarOpen: false
  },
  editMode: false,
  sidebarOpen: false,
  editModeCollapsedSnapshot: null,
  /** Ephemeral UI overrides for normal mode only; never persisted. Absent key means use `category.collapsed`. */
  sessionCategoryCollapsed: {},
  undoStack: [],
  themes: [],
  languages: [],
  faviconLoading: false,
  categoryMetadataReload: null
};

const CATEGORY_METADATA_TOAST_ID = "category-metadata-reload";
const SIDEBAR_MOBILE_BREAKPOINT = "(max-width: 900px)";
let sidebarMobileQuery = null;
let sidebarOpenBeforeDrag = null;
let sidebarTooltipEl = null;
let sidebarTooltipAnchor = null;

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
  addBookmarkFab: document.getElementById("add-bookmark-fab"),
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
  sync: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
  open: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  dotsVertical: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 3.23-.87l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  close: "M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  sort: "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z",
  selectMark: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.58-2.58-2.57-1.42 1.41 4 3.99z"
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

function isGlobalKeyboardShortcutBlocked() {
  if (document.querySelector(".modal-overlay")) return true;
  return isBlockingFocusTarget(document.activeElement);
}

function triggerBookmarkLaunch(bookmarkId) {
  const tile = document.querySelector(`.bookmark-item[data-bookmark-id="${bookmarkId}"] [data-bookmark-open]`);
  if (!(tile instanceof HTMLAnchorElement)) return;
  tile.click();
}

function openBookmarkFromSearch(bookmark, { newTab = false } = {}) {
  openBookmarkUrl(bookmark, { newTab });
}

async function confirmDropToUnsorted(bookmarkOrBookmarks) {
  const bookmarks = Array.isArray(bookmarkOrBookmarks) ? bookmarkOrBookmarks : [bookmarkOrBookmarks];
  let confirmed = false;
  const body = document.createElement("p");
  if (bookmarks.length > 1) {
    body.textContent = interpolateLabel(t("ui.dropToUnsortedConfirmMultiple"), { count: bookmarks.length });
  } else {
    const label = bookmarks[0]?.title || bookmarks[0]?.url || "";
    body.textContent = interpolateLabel(t("ui.dropToUnsortedConfirm"), { title: label });
  }
  await showModal({
    title: t("ui.dropToUnsorted"),
    content: body,
    saveLabel: t("ui.confirm"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed;
}

async function pickHomepageCategoryForDrop(bookmarksForDrop = null) {
  const categories = listBookmarkListCategories(state.config);
  if (!categories.length) return null;

  let selectedCategoryId = categories[0].id;
  const body = document.createElement("div");
  body.className = "bookmark-drop-homepage-picker";
  const label = document.createElement("label");
  label.textContent = t("ui.dropToHomepageLabel");
  const select = document.createElement("select");
  select.className = "bookmark-drop-homepage-picker__select";
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.append(option);
  }
  select.addEventListener("change", () => {
    selectedCategoryId = select.value;
  });
  body.append(label, select);

  let confirmed = false;
  await showModal({
    title: t("ui.dropToHomepage"),
    content: body,
    saveLabel: t("ui.confirm"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed ? selectedCategoryId : null;
}

function createBookmarkUiDeps() {
  return {
    button,
    iconSvg,
    mdiIcon,
    bookmarkStoredImageSrc,
    bindBookmarkDrag,
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

function isCategoryMetadataReloadRunning() {
  return Boolean(state.categoryMetadataReload?.running);
}

function getBookmarkMetadataLabel(bookmark) {
  const title = String(bookmark?.title || "").trim();
  if (title) return title;
  return String(bookmark?.url || "").trim();
}

function findBookmarkItemElement(bookmarkId) {
  if (!bookmarkId) return null;
  return document.querySelector(`.bookmark-item[data-bookmark-id="${CSS.escape(bookmarkId)}"]`);
}

function buildCategoryMetadataToastProgress(reload) {
  return {
    title: t("ui.reloadCategoryMetadataToastTitle"),
    description: interpolateLabel(t("ui.reloadCategoryMetadataToastProgress"), {
      category: reload.categoryName,
      current: reload.processedCount,
      total: reload.totalCount
    }),
    detail: reload.currentBookmarkLabel
      ? interpolateLabel(t("ui.reloadCategoryMetadataToastCurrent"), { bookmark: reload.currentBookmarkLabel })
      : "",
    showCancel: true,
    cancelLabel: t("ui.cancel"),
    onCancel: cancelCategoryMetadataReload
  };
}

function cancelCategoryMetadataReload() {
  const reload = state.categoryMetadataReload;
  if (!reload?.running || reload.cancelled) return;
  reload.cancelled = true;
  reload.abortController?.abort();
}

function syncCategoryMetadataReloadBookmarkLoading() {
  const reload = state.categoryMetadataReload;
  if (!reload?.running || !reload.currentBookmarkId) return;
  const item = findBookmarkItemElement(reload.currentBookmarkId);
  if (item) setBookmarkMetadataLoading(item, true);
}

function applyMetadataToBookmark(bookmark, metadata) {
  if (!bookmark || !metadata || metadata.ok === false) return;
  if (metadata.title) bookmark.title = String(metadata.title).trim();
  bookmark.description = String(metadata.description || "").trim();
  if (metadata.domain) bookmark.domain = String(metadata.domain).trim();
  if (metadata.image) bookmark.image = normalizeBookmarkImageValue(metadata.image);
  if (metadata.imageSource) bookmark.imageSource = normalizeBookmarkImageSource(metadata.imageSource);
}

async function applyBookmarkMetadata(
  bookmarkId,
  { item = null, pushUndoOnChange = true, skipPersistAndRender = false } = {}
) {
  const bookmark = findBookmarkById(state.config, bookmarkId);
  if (!bookmark?.url) return false;
  if (item instanceof HTMLElement && item.classList.contains("is-reloading-metadata")) return false;
  if (item instanceof HTMLElement) setBookmarkMetadataLoading(item, true);
  try {
    const metadata = await api.fetchBookmarkMetadata(bookmark.url);
    if (metadata?.ok === false) {
      throw new Error("metadata fetch failed");
    }
    if (pushUndoOnChange) pushUndo();
    applyMetadataToBookmark(bookmark, metadata);
    if (!skipPersistAndRender) {
      await persistConfig();
      render();
    }
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

async function confirmReloadCategoryMetadata(bookmarkCount, categoryName) {
  let confirmed = false;
  const body = document.createElement("p");
  body.textContent = interpolateLabel(t("ui.reloadCategoryMetadataConfirm"), {
    count: bookmarkCount,
    category: categoryName
  });
  await showModal({
    title: t("ui.reloadCategoryMetadata"),
    content: body,
    saveLabel: t("ui.confirm"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed;
}

async function reloadCategoryMetadata() {
  const navId = getActiveNavId();
  if (navId === NAV_ALL || isCategoryMetadataReloadRunning()) return;

  const bookmarks = getBookmarksForNav(state.config, navId).filter((bookmark) => String(bookmark.url || "").trim());
  const totalCount = bookmarks.length;
  if (!totalCount) return;

  const categoryName = getNavTitle(navId);
  const confirmed = await confirmReloadCategoryMetadata(totalCount, categoryName);
  if (!confirmed) return;

  const abortController = new AbortController();
  state.categoryMetadataReload = {
    running: true,
    navId,
    categoryName,
    totalCount,
    processedCount: 0,
    updatedCount: 0,
    errorCount: 0,
    currentBookmarkId: null,
    currentBookmarkLabel: "",
    cancelled: false,
    abortController
  };
  render();

  showToast({
    id: CATEGORY_METADATA_TOAST_ID,
    ...buildCategoryMetadataToastProgress(state.categoryMetadataReload)
  });

  pushUndo();
  let activeItem = null;

  try {
    for (let index = 0; index < bookmarks.length; index += 1) {
      const reload = state.categoryMetadataReload;
      if (!reload?.running || reload.cancelled) break;

      const bookmark = bookmarks[index];
      if (activeItem) {
        setBookmarkMetadataLoading(activeItem, false);
        activeItem = null;
      }

      reload.processedCount = index + 1;
      reload.currentBookmarkId = bookmark.id;
      reload.currentBookmarkLabel = getBookmarkMetadataLabel(bookmark);
      updateToast(CATEGORY_METADATA_TOAST_ID, buildCategoryMetadataToastProgress(reload));

      activeItem = findBookmarkItemElement(bookmark.id);
      if (activeItem) setBookmarkMetadataLoading(activeItem, true);

      try {
        const metadata = await api.fetchBookmarkMetadata(bookmark.url, { signal: abortController.signal });
        if (reload.cancelled) break;
        if (metadata?.ok === false) {
          reload.errorCount += 1;
          continue;
        }
        applyMetadataToBookmark(bookmark, metadata);
        reload.updatedCount += 1;
      } catch (error) {
        if (error?.name === "AbortError" || reload.cancelled) break;
        reload.errorCount += 1;
      } finally {
        if (activeItem) {
          setBookmarkMetadataLoading(activeItem, false);
          activeItem = null;
        }
        reload.currentBookmarkId = null;
        reload.currentBookmarkLabel = "";
      }
    }
  } finally {
    if (activeItem) setBookmarkMetadataLoading(activeItem, false);

    const reload = state.categoryMetadataReload;
    const updatedCount = reload?.updatedCount ?? 0;
    const total = reload?.totalCount ?? totalCount;
    const errorCount = reload?.errorCount ?? 0;
    const wasCancelled = reload?.cancelled ?? false;
    const errorDetail = errorCount > 0
      ? interpolateLabel(t("ui.reloadCategoryMetadataErrors"), { errors: errorCount })
      : "";

    await persistConfig();

    state.categoryMetadataReload = null;
    render();

    if (wasCancelled) {
      updateToast(CATEGORY_METADATA_TOAST_ID, {
        title: t("ui.reloadCategoryMetadataCancelled"),
        description: interpolateLabel(t("ui.reloadCategoryMetadataCancelledDetail"), {
          updated: updatedCount,
          total
        }),
        detail: errorDetail,
        showCancel: false
      });
    } else {
      updateToast(CATEGORY_METADATA_TOAST_ID, {
        title: t("ui.reloadCategoryMetadataDoneTitle"),
        description: interpolateLabel(t("ui.reloadCategoryMetadataDoneDetail"), {
          updated: updatedCount,
          total
        }),
        detail: errorDetail,
        showCancel: false
      });
    }
    closeToast(CATEGORY_METADATA_TOAST_ID, { delayMs: 4500 });
  }
}

function resetNavSelection() {
  navSelectionMode = false;
  navSelectedBookmarkIds.clear();
  navSelectionAnchorId = null;
  navSelectionPreviewIds.clear();
}

function getActiveNavBookmarks() {
  const navId = getActiveNavId();
  let bookmarks = getBookmarksForNav(state.config, navId);
  if (navId === NAV_UNSORTED) {
    bookmarks = filterUnsortedNavBookmarks(bookmarks);
  }
  return sortNavBookmarks(bookmarks, getNavSortSetting(state.settings, navId));
}

function getVisibleNavBookmarkIds() {
  return getActiveNavBookmarks().map((bookmark) => bookmark.id);
}

function pruneNavSelectionToVisible() {
  const visible = new Set(getVisibleNavBookmarkIds());
  for (const id of navSelectedBookmarkIds) {
    if (!visible.has(id)) navSelectedBookmarkIds.delete(id);
  }
  for (const id of navSelectionPreviewIds) {
    if (!visible.has(id)) navSelectionPreviewIds.delete(id);
  }
  if (navSelectionAnchorId && !visible.has(navSelectionAnchorId)) {
    navSelectionAnchorId = navSelectedBookmarkIds.size
      ? [...navSelectedBookmarkIds][navSelectedBookmarkIds.size - 1]
      : null;
  }
}

function clearNavSelectionPreview() {
  if (!navSelectionPreviewIds.size) return;
  navSelectionPreviewIds.clear();
  applyNavSelectionStateToDom();
}

function getNavSelectionRangeIds(anchorId, targetId) {
  const ids = getVisibleNavBookmarkIds();
  const anchorIndex = ids.indexOf(anchorId);
  const targetIndex = ids.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return [];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ids.slice(start, end + 1);
}

function toggleNavBookmarkSelection(bookmarkId) {
  if (navSelectedBookmarkIds.has(bookmarkId)) navSelectedBookmarkIds.delete(bookmarkId);
  else navSelectedBookmarkIds.add(bookmarkId);
  navSelectionAnchorId = bookmarkId;
}

function selectNavBookmarkRange(anchorId, targetId) {
  for (const id of getNavSelectionRangeIds(anchorId, targetId)) {
    navSelectedBookmarkIds.add(id);
  }
  navSelectionAnchorId = targetId;
}

function setNavSelectionPreviewForTarget(targetId) {
  if (!navSelectionAnchorId || !targetId) return;
  const nextPreview = new Set(
    getNavSelectionRangeIds(navSelectionAnchorId, targetId)
      .filter((id) => !navSelectedBookmarkIds.has(id))
  );
  if (nextPreview.size === navSelectionPreviewIds.size
    && [...nextPreview].every((id) => navSelectionPreviewIds.has(id))) {
    return;
  }
  navSelectionPreviewIds.clear();
  for (const id of nextPreview) navSelectionPreviewIds.add(id);
  applyNavSelectionStateToDom();
}

function applyNavSelectionStateToDom() {
  const collection = elements.navView?.querySelector(".bookmark-collection");
  if (!collection) return;
  collection.querySelectorAll(".bookmark-item[data-bookmark-id]").forEach((item) => {
    const bookmarkId = item.dataset.bookmarkId;
    const selected = navSelectedBookmarkIds.has(bookmarkId);
    const preview = navSelectionPreviewIds.has(bookmarkId);
    item.classList.toggle("is-selected", selected);
    item.classList.toggle("is-selection-preview", preview && !selected);
    const checkbox = item.querySelector("[data-bookmark-select]");
    if (checkbox instanceof HTMLInputElement) checkbox.checked = selected;
  });
  updateNavSelectionToolbar();
}

function updateNavSelectionToolbar() {
  const bar = elements.navView?.querySelector(".nav-view-header__selection-actions");
  if (!bar) return;
  const deleteButton = bar.querySelector("[data-nav-select-delete]");
  if (!(deleteButton instanceof HTMLElement)) return;
  const count = navSelectedBookmarkIds.size;
  const visible = navSelectionMode && count > 0;
  deleteButton.classList.toggle("hidden", !visible);
  const label = deleteButton.querySelector(".btn__label");
  if (label) {
    label.textContent = interpolateLabel(t("ui.deleteSelectedBookmarks"), { count: String(count) });
  }
}

async function confirmDeleteSelectedNavBookmarks() {
  const count = navSelectedBookmarkIds.size;
  if (!count) return false;
  let confirmed = false;
  const body = document.createElement("p");
  body.textContent = interpolateLabel(t("ui.deleteSelectedBookmarksConfirm"), { count: String(count) });
  await showModal({
    title: t("ui.delete"),
    content: body,
    saveLabel: t("ui.delete"),
    cancelLabel: t("ui.cancel"),
    submitOnEnter: false,
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed;
}

async function requestDeleteSelectedNavBookmarks() {
  if (!navSelectionMode || navSelectedBookmarkIds.size === 0) return;
  const confirmed = await confirmDeleteSelectedNavBookmarks();
  if (!confirmed) return;
  const ids = [...navSelectedBookmarkIds];
  pushUndo();
  for (const id of ids) {
    removeBookmarkFromConfig(state.config, id);
  }
  navSelectedBookmarkIds.clear();
  navSelectionAnchorId = null;
  navSelectionPreviewIds.clear();
  await persistConfig();
  render();
}

function handleNavDeleteSelectedShortcut(event) {
  if (event.defaultPrevented) return;
  if (event.key !== "Delete" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (!navSelectionMode || navSelectedBookmarkIds.size === 0) return;
  if (shouldShowCategoryGrid(getActiveNavId())) return;
  if (isGlobalKeyboardShortcutBlocked()) return;
  event.preventDefault();
  void requestDeleteSelectedNavBookmarks();
}

function selectAllVisibleNavBookmarks() {
  navSelectedBookmarkIds.clear();
  for (const id of getVisibleNavBookmarkIds()) navSelectedBookmarkIds.add(id);
  navSelectionAnchorId = getVisibleNavBookmarkIds().at(-1) || null;
  clearNavSelectionPreview();
  applyNavSelectionStateToDom();
}

function activateNavSelectionAndSelectAllVisible() {
  if (shouldShowCategoryGrid(getActiveNavId())) return;
  if (!navSelectionMode) {
    setNavSelectionMode(true);
  }
  selectAllVisibleNavBookmarks();
}

function handleNavSelectAllShortcut(event) {
  if (event.defaultPrevented) return;
  const key = String(event.key || "").toLowerCase();
  if (key !== "a" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (isBlockingFocusTarget(document.activeElement) || isBlockingFocusTarget(event.target)) return;
  if (shouldShowCategoryGrid(getActiveNavId())) return;
  event.preventDefault();
  activateNavSelectionAndSelectAllVisible();
}

function clearAllNavBookmarkSelection() {
  navSelectedBookmarkIds.clear();
  navSelectionAnchorId = null;
  clearNavSelectionPreview();
  applyNavSelectionStateToDom();
}

function setNavSelectionMode(active) {
  if (navSelectionMode === active) return;
  navSelectionMode = active;
  if (!active) {
    navSelectedBookmarkIds.clear();
    navSelectionAnchorId = null;
    navSelectionPreviewIds.clear();
  }
  render();
}

function isNavSelectionInteractionTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "[data-edit-bookmark], [data-delete-bookmark], [data-move-bookmark-left], [data-move-bookmark-right], [data-bookmark-menu-trigger], .bookmark-menu__item, .bookmark-reorder"
  ));
}

function handleNavBookmarkSelectionClick(event) {
  if (!navSelectionMode) return;
  if (isNavSelectionInteractionTarget(event.target)) return;
  const item = event.target.closest?.(".bookmark-item[data-bookmark-id]");
  if (!(item instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const bookmarkId = item.dataset.bookmarkId;
  if (!bookmarkId) return;
  if (event.shiftKey && navSelectionAnchorId) {
    selectNavBookmarkRange(navSelectionAnchorId, bookmarkId);
    clearNavSelectionPreview();
  } else {
    toggleNavBookmarkSelection(bookmarkId);
    clearNavSelectionPreview();
  }
  applyNavSelectionStateToDom();
}

function handleNavBookmarkSelectionHover(event) {
  if (!navSelectionMode || !event.shiftKey || !navSelectionAnchorId) return;
  if (isNavSelectionInteractionTarget(event.target)) return;
  const item = event.target.closest?.(".bookmark-item[data-bookmark-id]");
  if (!(item instanceof HTMLElement)) return;
  setNavSelectionPreviewForTarget(item.dataset.bookmarkId || "");
}

function ensureNavSelectionEvents() {
  if (navSelectionEventsBound) return;
  navSelectionEventsBound = true;
  document.addEventListener("keydown", handleNavSelectAllShortcut);
  document.addEventListener("keydown", handleNavDeleteSelectedShortcut);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift") clearNavSelectionPreview();
  });
}

function bindNavSelectionCollectionEvents(collection) {
  if (!(collection instanceof HTMLElement)) return;
  collection.addEventListener("click", handleNavBookmarkSelectionClick);
  collection.addEventListener("mouseover", handleNavBookmarkSelectionHover);
}

function refreshNavBookmarkList() {
  const navId = getActiveNavId();
  if (shouldShowCategoryGrid(navId)) return;
  const panel = elements.navView?.querySelector(".nav-view-panel");
  if (!panel) return;
  const viewMode = getActiveNavViewMode();
  const bookmarks = getActiveNavBookmarks();
  const nextCollection = renderBookmarkCollection(bookmarks, navId, viewMode);
  const currentCollection = panel.querySelector(".bookmark-collection");
  if (currentCollection) currentCollection.replaceWith(nextCollection);
  else panel.append(nextCollection);
  pruneNavSelectionToVisible();
  if (navSelectionMode) {
    bindNavSelectionCollectionEvents(nextCollection);
    applyNavSelectionStateToDom();
  }
}

function updateUnsortedFolderFilterToggleState() {
  const toggle = document.querySelector(".unsorted-folder-filter__toggle");
  toggle?.classList.toggle("is-active", isUnsortedBrowserFolderFilterActive());
}

function captureUnsortedFolderFilterScroll() {
  if (!unsortedFolderFilterDropdownOpen) return null;
  const options = document.querySelector(".unsorted-folder-filter__options");
  return options instanceof HTMLElement ? options.scrollTop : null;
}

function restoreUnsortedFolderFilterScroll(scrollTop) {
  if (scrollTop == null) return;
  requestAnimationFrame(() => {
    const options = document.querySelector(".unsorted-folder-filter__options");
    if (options instanceof HTMLElement) options.scrollTop = scrollTop;
  });
}

function createBookmarkElementForBookmark(bookmark, category, view, { homepage = false, navId = null } = {}) {
  const categoryContext = category || { id: navId || resolveBookmarkModalCategoryId(bookmark, category) };
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
      showUnsortedBrowserImportPath: navId === NAV_UNSORTED && shouldShowUnsortedBrowserImportPath(bookmark, state.config),
      showCategoryChips: navId !== NAV_UNSORTED,
      hasShortcut: Boolean(normalizeServiceShortcut(bookmark.shortcut)),
      canMoveLeft: reorder.canMoveLeft,
      canMoveRight: reorder.canMoveRight,
      selectionMode: !homepage && navSelectionMode,
      selected: navSelectedBookmarkIds.has(bookmark.id),
      selectionPreview: navSelectionPreviewIds.has(bookmark.id)
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

function wireMdiIconSearch(form, { fallbackIcon = FALLBACK_MDI_ICON } = {}) {
  const input = form.querySelector("input[name='icon']");
  const results = form.querySelector("[data-icon-results]");
  const selectedPreview = form.querySelector("[data-selected-icon-preview]");
  if (!(input instanceof HTMLInputElement) || !(results instanceof HTMLElement) || !(selectedPreview instanceof HTMLElement)) {
    return;
  }
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
        applySelectedIcon(fallbackIcon);
      } else {
        applySelectedIcon(input.value);
      }
    }, 120);
  });
  applySelectedIcon(fallbackIcon);
  results.classList.remove("is-open");
  results.innerHTML = "";
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
    bookmarkSortDropdownOpen = false;
    resetNavSelection();
    state.settings.activeNavId = nextNavId;
    changed = true;
  }

  if (urlEditMode !== state.editMode) {
    if (urlEditMode) captureEditModeCollapsedSnapshot();
    else {
      restoreEditModeCollapsedSnapshot();
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
  sidebarMobileQuery = window.matchMedia(SIDEBAR_MOBILE_BREAKPOINT);
  document.body.classList.toggle("sidebar-mobile", sidebarMobileQuery.matches);
  setSidebarOpen(false, { instant: true });
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
    navViewModes: normalizeNavViewModes(settings?.navViewModes),
    navSortSettings: normalizeNavSortSettings(settings?.navSortSettings),
    sidebarOpen: Boolean(settings?.sidebarOpen)
  };
  state.settings.activeNavId = resolveNavIdFromHash(state.config, window.location.hash, state.settings);
  state.themes = themes.themes;
  state.languages = languages.languages;
  const sidebarMobileOnLoad = sidebarMobileQuery.matches;
  state.sidebarOpen = sidebarMobileOnLoad ? false : state.settings.sidebarOpen;
  ensureSidebarShell();
  setSidebarOpen(state.sidebarOpen, {
    instant: true
  });
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
  initBookmarkDragDrop({
    getConfig: () => state.config,
    bookmarkStoredImageSrc,
    pushUndo,
    persistAndRender: async () => {
      await persistConfig();
      render();
    },
    pickHomepageCategory: pickHomepageCategoryForDrop,
    confirmDropToUnsorted,
    getSelectedBookmarkIds: () => [...navSelectedBookmarkIds],
    formatDragCount: (count) => interpolateLabel(t("ui.dragSelectedCount"), { count }),
    formatDropBadgeCount: (count) => String(count),
    onDragSessionStart: () => {
      sidebarOpenBeforeDrag = state.sidebarOpen;
      setSidebarOpen(true);
    },
    onDragSessionEnd: () => {
      if (sidebarOpenBeforeDrag === null) return;
      setSidebarOpen(sidebarOpenBeforeDrag);
      sidebarOpenBeforeDrag = null;
    },
    openAddSidebarCategoryModal: (bookmarkIds) => {
      openSidebarCategoryModal({ bookmarkIdsToAssign: bookmarkIds });
    }
  });
  initBookmarkSearch({
    getBookmarks: () => state.config.bookmarks || [],
    bookmarkStoredImageSrc,
    mdiIcon,
    iconSvg,
    clearIcon: ICONS.close,
    searchIcon: ICONS.search,
    t,
    openBookmark: openBookmarkFromSearch
  });
  initSidebarResponsiveBehavior();
  bindSidebarTooltipEvents();
  ensureBookmarkMenuDismiss();
  ensureSidebarCategoryMenuDismiss();
  const searchToggle = document.getElementById("bookmark-search-toggle");
  if (searchToggle) {
    searchToggle.innerHTML = `<span class="btn__icon" aria-hidden="true">${iconSvg(ICONS.search, "inline-icon")}</span>`;
  }
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
  elements.addBookmarkFab?.addEventListener("click", () => {
    openBookmarkModal({ navId: getActiveNavId() });
  });
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
  state.settings.navSortSettings = normalizeNavSortSettings(state.settings.navSortSettings);
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
    navViewModes: normalizeNavViewModes(saved?.navViewModes),
    navSortSettings: normalizeNavSortSettings(saved?.navSortSettings),
    sidebarOpen: Boolean(saved?.sidebarOpen)
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

function ensureSidebarBackdrop() {
  let backdrop = document.getElementById("sidebar-backdrop");
  if (!(backdrop instanceof HTMLElement)) {
    backdrop = document.createElement("div");
    backdrop.id = "sidebar-backdrop";
    backdrop.className = "sidebar-backdrop";
    backdrop.hidden = true;
    backdrop.addEventListener("click", () => {
      setSidebarOpen(false);
    });
    document.body.append(backdrop);
  }
  return backdrop;
}

function isSidebarMobileLayout() {
  return Boolean(sidebarMobileQuery?.matches);
}

function syncSidebarBackdrop() {
  const backdrop = ensureSidebarBackdrop();
  const show = isSidebarMobileLayout() && state.sidebarOpen;
  backdrop.hidden = !show;
  document.body.classList.toggle("sidebar-mobile-open", show);
}

function ensureAppShell() {
  ensureSidebarBackdrop();

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

function isSidebarCollapsedDesktop() {
  return !isSidebarMobileLayout() && !state.sidebarOpen;
}

function ensureSidebarTooltip() {
  if (sidebarTooltipEl instanceof HTMLElement) return sidebarTooltipEl;
  const el = document.createElement("div");
  el.id = "sidebar-tooltip";
  el.className = "sidebar-tooltip";
  el.hidden = true;
  document.body.append(el);
  sidebarTooltipEl = el;
  return el;
}

function hideSidebarTooltip() {
  sidebarTooltipAnchor = null;
  if (!(sidebarTooltipEl instanceof HTMLElement)) return;
  sidebarTooltipEl.hidden = true;
  sidebarTooltipEl.textContent = "";
}

function showSidebarTooltip(anchor, label) {
  if (!(anchor instanceof HTMLElement) || !label) {
    hideSidebarTooltip();
    return;
  }
  const tooltip = ensureSidebarTooltip();
  if (sidebarTooltipAnchor === anchor && tooltip.textContent === label && !tooltip.hidden) return;
  sidebarTooltipAnchor = anchor;
  tooltip.textContent = label;
  tooltip.hidden = false;
  const rect = anchor.getBoundingClientRect();
  tooltip.style.top = `${rect.top + rect.height / 2}px`;
  tooltip.style.left = `${rect.left + rect.width}px`;
}

function bindSidebarTooltipEvents() {
  if (document.documentElement.dataset.sidebarTooltipBound === "true") return;
  document.documentElement.dataset.sidebarTooltipBound = "true";
  queryNavigationElements();
  ensureSidebarTooltip();
  const showTooltipForLink = (link) => {
    if (!isSidebarCollapsedDesktop()) {
      hideSidebarTooltip();
      return;
    }
    if (!(link instanceof HTMLElement) || link.classList.contains("sidebar-link--draft")) {
      hideSidebarTooltip();
      return;
    }
    const label = link.querySelector(".sidebar-link__label")?.textContent?.trim();
    showSidebarTooltip(link, label || "");
  };
  elements.sidebar?.addEventListener("mouseover", (event) => {
    const link = event.target.closest?.(".sidebar-link");
    if (!(link instanceof HTMLElement) || !elements.sidebar?.contains(link)) {
      hideSidebarTooltip();
      return;
    }
    showTooltipForLink(link);
  });
  elements.sidebar?.addEventListener("mouseout", (event) => {
    if (!isSidebarCollapsedDesktop()) return;
    const link = event.target.closest?.(".sidebar-link");
    const related = event.relatedTarget;
    if (link instanceof HTMLElement && related instanceof Node && link.contains(related)) return;
    hideSidebarTooltip();
  });
  elements.sidebar?.addEventListener("focusin", (event) => {
    const link = event.target.closest?.(".sidebar-link");
    if (link instanceof HTMLElement) showTooltipForLink(link);
  });
  elements.sidebar?.addEventListener("focusout", () => {
    hideSidebarTooltip();
  });
  elements.sidebar?.querySelector(".sidebar-nav")?.addEventListener("scroll", hideSidebarTooltip, { passive: true });
  window.addEventListener("resize", hideSidebarTooltip);
}

function ensureSidebarHeader() {
  queryNavigationElements();
  if (!elements.sidebar || !elements.navToggle) return;
  let header = elements.sidebar.querySelector(".sidebar-header");
  if (!header) {
    header = document.createElement("div");
    header.className = "sidebar-header";
    elements.sidebar.prepend(header);
  }
  const topbarLeading = document.querySelector(".topbar-leading");
  if (isSidebarMobileLayout()) {
    if (topbarLeading instanceof HTMLElement && elements.navToggle.parentElement !== topbarLeading) {
      topbarLeading.prepend(elements.navToggle);
    }
    return;
  }
  if (elements.navToggle.parentElement !== header) {
    header.append(elements.navToggle);
  }
}

function ensureSidebarShell() {
  ensureAppShell();
  queryNavigationElements();

  if (!elements.sidebar) {
    const sidebar = document.createElement("aside");
    sidebar.id = "sidebar";
    sidebar.className = "sidebar";
    sidebar.setAttribute("aria-hidden", "false");
    sidebar.innerHTML = `
      <div class="sidebar-header"></div>
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

  ensureSidebarHeader();
  if (elements.navToggle) {
    elements.navToggle.setAttribute("aria-controls", "sidebar");
  }
}

function updateNavToggleIcon() {
  queryNavigationElements();
  if (!elements.navToggle) return;
  const mobile = isSidebarMobileLayout();
  const iconPath = mobile || !state.sidebarOpen ? ICONS.menu : ICONS.arrowLeft;
  elements.navToggle.innerHTML = `<span class="btn__icon" aria-hidden="true">${iconSvg(iconPath, "inline-icon")}</span>`;
}

function updateNavToggleLabels() {
  queryNavigationElements();
  if (!elements.navToggle) return;
  const mobile = isSidebarMobileLayout();
  const expanded = state.sidebarOpen;
  const label = mobile
    ? t("ui.navToggle")
    : expanded
      ? t("ui.navToggleCollapse")
      : t("ui.navToggleExpand");
  elements.navToggle.title = label;
  elements.navToggle.setAttribute("aria-label", label);
}

function bindSidebarEvents() {
  queryNavigationElements();
  ensureSidebarShell();
  if (document.documentElement.dataset.sidebarEventsBound === "true") return;
  document.documentElement.dataset.sidebarEventsBound = "true";
  document.addEventListener("click", (event) => {
    if (event.target.closest("#nav-toggle-btn")) {
      event.preventDefault();
      queryNavigationElements();
      setSidebarOpen(!state.sidebarOpen, { persist: !isSidebarMobileLayout() });
      return;
    }
    const categoryMenuTrigger = event.target.closest("[data-sidebar-category-menu-trigger]");
    if (categoryMenuTrigger instanceof HTMLElement && elements.sidebar?.contains(categoryMenuTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      const row = categoryMenuTrigger.closest(".sidebar-link-row");
      const navId = row?.querySelector(".sidebar-link[data-nav-id]")?.dataset.navId;
      const category = findSidebarCategoryById(state.config, navId);
      if (!category) return;
      openSidebarCategoryMenu(categoryMenuTrigger, category);
      return;
    }
    const link = event.target.closest(".sidebar-link[data-nav-id]");
    if (!(link instanceof HTMLElement)) return;
    if (!elements.sidebar?.contains(link)) return;
    if (link.classList.contains("sidebar-link--add") || link.classList.contains("sidebar-link--draft")) return;
    event.preventDefault();
    const navId = link.dataset.navId;
    if (!navId) return;
    void (async () => {
      await selectNav(navId);
      if (isSidebarMobileLayout()) {
        setSidebarOpen(false);
      }
    })();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!isSidebarMobileLayout() || !state.sidebarOpen) return;
      event.preventDefault();
      setSidebarOpen(false);
      return;
    }
    if (event.key !== "ArrowLeft" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) {
      return;
    }
    if (isGlobalKeyboardShortcutBlocked()) return;
    event.preventDefault();
    setSidebarOpen(!state.sidebarOpen, { persist: !isSidebarMobileLayout() });
  });
}

function getActiveNavId() {
  return resolveActiveNavId(state.config, state.settings);
}

function getActiveNavViewMode() {
  return getNavViewMode(state.settings, getActiveNavId());
}

function releaseSidebarInstantTransition() {
  elements.sidebar?.classList.remove("sidebar--instant");
}

function setSidebarOpen(open, { persist = false, instant = false } = {}) {
  ensureSidebarShell();
  queryNavigationElements();
  const mobile = isSidebarMobileLayout();
  const nextOpen = Boolean(open);
  state.sidebarOpen = nextOpen;
  if (persist && !mobile) {
    state.settings.sidebarOpen = nextOpen;
    void persistSettings();
  }
  if (instant && elements.sidebar) {
    elements.sidebar.classList.add("sidebar--instant");
  }
  if (elements.sidebar) {
    elements.sidebar.classList.toggle("is-open", nextOpen);
    elements.sidebar.setAttribute("aria-hidden", mobile && !nextOpen ? "true" : "false");
  }
  elements.navToggle?.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  elements.navToggle?.classList.toggle("is-active", mobile && nextOpen);
  document.body.classList.toggle("sidebar-open", nextOpen && !mobile);
  document.body.classList.toggle("sidebar-mobile", mobile);
  syncSidebarBackdrop();
  updateNavToggleIcon();
  updateNavToggleLabels();
  if (!nextOpen || mobile) hideSidebarTooltip();
  if (instant && elements.sidebar) {
    void elements.sidebar.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(releaseSidebarInstantTransition);
    });
  }
}

function initSidebarResponsiveBehavior() {
  sidebarMobileQuery ??= window.matchMedia(SIDEBAR_MOBILE_BREAKPOINT);
  const applyLayout = () => {
    ensureSidebarShell();
    elements.sidebar?.classList.add("sidebar--instant");
    document.body.classList.toggle("sidebar-mobile", isSidebarMobileLayout());
    ensureSidebarHeader();
    if (isSidebarMobileLayout()) {
      setSidebarOpen(false, { instant: true });
      return;
    }
    setSidebarOpen(Boolean(state.settings.sidebarOpen), { instant: true });
  };
  sidebarMobileQuery.addEventListener("change", applyLayout);
  applyLayout();
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
  bookmarkSortDropdownOpen = false;
  resetNavSelection();
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

async function setNavSortForActive(partial) {
  const navId = getActiveNavId();
  setNavSortSetting(state.settings, navId, partial);
  await persistSettings();
  bookmarkSortDropdownOpen = true;
  pruneNavSelectionToVisible();
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

function isSidebarLinkStructureValid(button) {
  if (!(button instanceof HTMLButtonElement)) return false;
  const iconWrap = button.querySelector(":scope > .sidebar-link__icon");
  const details = button.querySelector(":scope > .sidebar-link__details");
  const labelEl = details?.querySelector(":scope > .sidebar-link__label");
  const countEl = details?.querySelector(":scope > .sidebar-link__count");
  return Boolean(iconWrap && details && labelEl && countEl);
}

function isSidebarCategoryRowStructureValid(row) {
  if (!(row instanceof HTMLElement)) return false;
  const link = row.querySelector(":scope > .sidebar-link[data-nav-id]");
  const menuTrigger = row.querySelector(":scope > [data-sidebar-category-menu-trigger]");
  const menuPanel = row.querySelector(":scope > [data-sidebar-category-menu-panel]");
  return isSidebarLinkStructureValid(link) && menuTrigger instanceof HTMLButtonElement && menuPanel instanceof HTMLElement;
}

function buildSidebarLink(button, { navId, label, count, iconName }) {
  const isActive = getActiveNavId() === navId;
  button.type = "button";
  button.className = `sidebar-link ${isActive ? "is-active" : ""}`;
  button.dataset.navId = navId;
  button.dataset.sidebarDrop = navId;
  button.dataset.sidebarIcon = iconName;
  button.innerHTML = `
    <span class="sidebar-link__icon">${mdiIcon(iconName)}</span>
    <span class="sidebar-link__details">
      <span class="sidebar-link__label">${escapeHtml(label)}</span>
      <span class="sidebar-link__count">${escapeHtml(String(count))}</span>
    </span>
  `;
}

function patchSidebarLink(button, { navId, label, count, iconName }) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!isSidebarLinkStructureValid(button)) {
    buildSidebarLink(button, { navId, label, count, iconName });
    return;
  }
  const isActive = getActiveNavId() === navId;
  button.className = `sidebar-link ${isActive ? "is-active" : ""}`;
  button.dataset.navId = navId;
  button.dataset.sidebarDrop = navId;
  button.querySelector(".sidebar-link__label").textContent = label;
  button.querySelector(".sidebar-link__count").textContent = String(count);
  if (button.dataset.sidebarIcon !== iconName) {
    button.querySelector(".sidebar-link__icon").innerHTML = mdiIcon(iconName);
    button.dataset.sidebarIcon = iconName;
  }
}

function buildSidebarCategoryMenuPanel() {
  return `
    <button type="button" class="sidebar-category-menu__item" data-sidebar-category-edit role="menuitem">${escapeHtml(t("ui.edit"))}</button>
    <button type="button" class="sidebar-category-menu__item sidebar-category-menu__item--danger" data-sidebar-category-delete role="menuitem">${escapeHtml(t("ui.delete"))}</button>
  `;
}

function buildSidebarCategoryRow(row, { navId, label, count, iconName }) {
  row.className = "sidebar-link-row";
  row.innerHTML = `
    <button type="button" class="sidebar-link"></button>
    <button
      type="button"
      class="btn btn--ghost btn--icon sidebar-category-menu__trigger"
      data-sidebar-category-menu-trigger
      aria-label="${escapeHtml(t("ui.sidebarCategoryActions"))}"
      aria-haspopup="menu"
      aria-expanded="false"
    >
      <span class="btn__icon" aria-hidden="true">${iconSvg(ICONS.dotsVertical, "inline-icon")}</span>
    </button>
    <div class="sidebar-category-menu__panel sidebar-category-menu__panel--source hidden" data-sidebar-category-menu-panel role="menu" aria-hidden="true">
      ${buildSidebarCategoryMenuPanel()}
    </div>
  `;
  buildSidebarLink(row.querySelector(".sidebar-link"), { navId, label, count, iconName });
}

function patchSidebarCategoryRow(row, { navId, label, count, iconName }) {
  if (!isSidebarCategoryRowStructureValid(row)) {
    buildSidebarCategoryRow(row, { navId, label, count, iconName });
    return;
  }
  patchSidebarLink(row.querySelector(".sidebar-link"), { navId, label, count, iconName });
}

function ensureSidebarCategoryItemRow(li) {
  let row = li.querySelector(":scope > .sidebar-link-row");
  if (!(row instanceof HTMLElement)) {
    li.replaceChildren();
    row = document.createElement("div");
    li.append(row);
  }
  return row;
}

function ensureSidebarItemButton(li) {
  let button = li.querySelector(":scope > .sidebar-link");
  if (!(button instanceof HTMLButtonElement)) {
    button = document.createElement("button");
    button.type = "button";
    li.replaceChildren(button);
  }
  return button;
}

function findSidebarItemByNavId(list, navId) {
  for (const child of list.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.dataset.sidebarExtra === "true") continue;
    const link = child.querySelector(":scope .sidebar-link[data-nav-id], :scope > .sidebar-link[data-nav-id]");
    if (link?.dataset.navId === navId) return child;
  }
  return null;
}

function syncSidebarNavList(list, entries, { showCategoryMenu = false } = {}) {
  const seen = new Set();
  entries.forEach((entry, index) => {
    let li = findSidebarItemByNavId(list, entry.navId);
    if (!(li instanceof HTMLElement)) {
      li = document.createElement("li");
      li.className = showCategoryMenu ? "sidebar-item sidebar-item--category" : "sidebar-item";
    } else if (showCategoryMenu) {
      li.classList.add("sidebar-item--category");
    } else {
      li.classList.remove("sidebar-item--category");
    }
    if (showCategoryMenu) {
      patchSidebarCategoryRow(ensureSidebarCategoryItemRow(li), entry);
    } else {
      patchSidebarLink(ensureSidebarItemButton(li), entry);
    }
    seen.add(entry.navId);
    if (list.children[index] !== li) {
      list.insertBefore(li, list.children[index] || null);
    }
  });
  [...list.children].forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    if (child.dataset.sidebarExtra === "true") return;
    const navId = child.querySelector(":scope .sidebar-link[data-nav-id], :scope > .sidebar-link[data-nav-id]")?.dataset.navId;
    if (navId && !seen.has(navId)) child.remove();
  });
}

function renderSidebarLink(navId, label, count, iconName) {
  const li = document.createElement("li");
  li.className = "sidebar-item";
  const button = document.createElement("button");
  button.type = "button";
  li.append(button);
  buildSidebarLink(button, { navId, label, count, iconName });
  return li;
}

function syncSidebarDomState() {
  queryNavigationElements();
  if (!elements.sidebar) return;
  const mobile = isSidebarMobileLayout();
  elements.sidebar.classList.toggle("is-open", state.sidebarOpen);
  elements.sidebar.setAttribute("aria-hidden", mobile && !state.sidebarOpen ? "true" : "false");
  document.body.classList.toggle("sidebar-open", state.sidebarOpen && !mobile);
}

function renderSidebar() {
  closeSidebarCategoryMenu();
  ensureSidebarShell();
  syncSidebarDomState();
  updateNavToggleIcon();
  updateNavToggleLabels();
  if (!elements.sidebarSystem || !elements.sidebarCategories) return;

  syncSidebarNavList(
    elements.sidebarSystem,
    SYSTEM_NAV_ITEMS.map((item) => ({
      navId: item.id,
      label: item.id === NAV_ALL ? getHomepageName() : t(item.labelKey),
      count: getBookmarkCountForNav(state.config, item.id),
      iconName: item.icon
    }))
  );

  syncSidebarNavList(
    elements.sidebarCategories,
    getSidebarCategories(state.config).map((category) => ({
      navId: category.id,
      label: category.name,
      count: getBookmarkCountForNav(state.config, category.id),
      iconName: category.icon || FALLBACK_MDI_ICON
    })),
    { showCategoryMenu: state.editMode }
  );

  [...elements.sidebarCategories.children].forEach((child) => {
    if (child instanceof HTMLElement && child.dataset.sidebarExtra === "true") {
      child.remove();
    }
  });

  if (state.editMode) {
    const li = renderSidebarAddCategoryTrigger();
    li.dataset.sidebarExtra = "true";
    elements.sidebarCategories.append(li);
  }
}

function renderSidebarAddCategoryTrigger() {
  const li = document.createElement("li");
  li.className = "sidebar-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-link sidebar-link--add";
  button.dataset.sidebarDrop = SIDEBAR_ADD_CATEGORY_DROP_ID;
  button.innerHTML = `
    <span class="sidebar-link__icon">${mdiIcon("plus")}</span>
    <span class="sidebar-link__details">
      <span class="sidebar-link__label">${escapeHtml(t("ui.addSidebarCategory"))}</span>
      <span class="sidebar-link__count" aria-hidden="true"></span>
    </span>
  `;
  button.addEventListener("click", () => {
    openSidebarCategoryModal();
  });
  li.append(button);
  return li;
}

function createSidebarCategoryForm(category = null) {
  const form = document.createElement("form");
  const iconName = category?.icon || FALLBACK_MDI_ICON;
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.name")}</label>
      <input name="name" value="${escapeHtml(category?.name || "")}" required />
    </div>
    <div class="form-row icon-search">
      <label>${t("ui.icon")}</label>
      <div>
        <div class="icon-input-wrap">
          <span class="icon-input-preview" data-selected-icon-preview>${mdiIcon(iconName, "icon-preview icon-preview--theme")}</span>
          <input name="icon" value="${normalizeMdiIconName(iconName)}" autocomplete="off" />
        </div>
        <div class="icon-search-results" data-icon-results></div>
      </div>
    </div>
  `;
  return form;
}

function openSidebarCategoryModal({ category = null, bookmarkIdsToAssign = [] } = {}) {
  const isEdit = Boolean(category);
  const form = createSidebarCategoryForm(category);
  const assignBookmarkIds = isEdit
    ? []
    : bookmarkIdsToAssign.map((id) => String(id || "").trim()).filter(Boolean);

  showModal({
    title: isEdit ? t("ui.editSidebarCategory") : t("ui.addSidebarCategory"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    modalClass: "modal--sidebar-category",
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      const nextName = String(fd.get("name") || "").trim();
      if (!nextName) return false;
      const selectedIcon = normalizeMdiIconName(fd.get("icon"));
      pushUndo();
      if (isEdit) {
        const previousSlug = category.slug;
        category.name = nextName;
        category.icon = selectedIcon;
        category.slug = allocateSidebarCategorySlug(state.config, nextName, category.id);
        await persistConfig();
        if (getActiveNavId() === category.id && previousSlug !== category.slug) {
          syncAppUrl({ navId: category.id, historyMode: "replace" });
        }
        render();
        return;
      }
      const id = uid();
      if (!state.config.sidebarCategories) state.config.sidebarCategories = [];
      state.config.sidebarCategories.push({
        id,
        name: nextName,
        icon: selectedIcon,
        slug: allocateSidebarCategorySlug(state.config, nextName)
      });
      if (!state.config.sidebarCategoryBookmarkOrder) state.config.sidebarCategoryBookmarkOrder = {};
      state.config.sidebarCategoryBookmarkOrder[id] = [];
      if (assignBookmarkIds.length) {
        for (const bookmarkId of assignBookmarkIds) {
          const bookmark = findBookmarkById(state.config, bookmarkId);
          if (bookmark) assignBookmarkToCustomSidebarCategory(state.config, bookmark, id);
        }
        navSelectedBookmarkIds.clear();
        navSelectionAnchorId = null;
        navSelectionPreviewIds.clear();
      }
      await persistConfig();
      render();
    }
  });

  wireMdiIconSearch(form, { fallbackIcon: category?.icon || FALLBACK_MDI_ICON });
  const nameInput = form.querySelector("input[name='name']");
  if (nameInput instanceof HTMLInputElement) {
    requestAnimationFrame(() => nameInput.focus());
  }
}

function getSidebarCategoryMenuOverlay() {
  if (sidebarCategoryMenuOverlay instanceof HTMLElement) return sidebarCategoryMenuOverlay;
  const overlay = document.createElement("div");
  overlay.id = "sidebar-category-menu-overlay";
  overlay.className = "sidebar-category-menu-overlay hidden";
  overlay.innerHTML = `<div class="sidebar-category-menu__panel" data-sidebar-category-menu-panel role="menu"></div>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeSidebarCategoryMenu();
  });
  document.body.append(overlay);
  sidebarCategoryMenuOverlay = overlay;
  return overlay;
}

function positionSidebarCategoryMenuPanel(panel, trigger) {
  const gap = 6;
  const margin = 8;
  panel.style.left = "0px";
  panel.style.top = "0px";
  const panelRect = panel.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = triggerRect.bottom + gap;
  let left = triggerRect.right - panelRect.width;

  if (top + panelRect.height > viewportHeight - margin) {
    const aboveTop = triggerRect.top - panelRect.height - gap;
    if (aboveTop >= margin) top = aboveTop;
    else top = Math.max(margin, viewportHeight - panelRect.height - margin);
  }
  if (top < margin) top = margin;

  if (left < margin) left = margin;
  if (left + panelRect.width > viewportWidth - margin) {
    left = Math.max(margin, viewportWidth - panelRect.width - margin);
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function bindSidebarCategoryMenuActions(panel, category) {
  panel.querySelector("[data-sidebar-category-edit]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSidebarCategoryMenu();
    openSidebarCategoryModal({ category });
  });
  panel.querySelector("[data-sidebar-category-delete]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSidebarCategoryMenu();
    void confirmDeleteSidebarCategory(category);
  });
}

function closeSidebarCategoryMenu() {
  const overlay = sidebarCategoryMenuOverlay;
  const panel = overlay?.querySelector("[data-sidebar-category-menu-panel]");
  if (panel) panel.innerHTML = "";
  overlay?.classList.add("hidden");
  overlay?.classList.remove("is-open");
  if (activeSidebarCategoryMenu?.trigger) {
    activeSidebarCategoryMenu.trigger.setAttribute("aria-expanded", "false");
  }
  activeSidebarCategoryMenu?.row?.classList.remove("is-menu-open");
  activeSidebarCategoryMenu = null;
}

function openSidebarCategoryMenu(trigger, category) {
  if (!(trigger instanceof HTMLElement)) return;

  if (activeSidebarCategoryMenu?.trigger === trigger) {
    closeSidebarCategoryMenu();
    return;
  }

  closeSidebarCategoryMenu();

  const row = trigger.closest(".sidebar-link-row");
  const sourcePanel = row?.querySelector("[data-sidebar-category-menu-panel]");
  if (!(sourcePanel instanceof HTMLElement)) return;

  const overlay = getSidebarCategoryMenuOverlay();
  const panel = overlay.querySelector("[data-sidebar-category-menu-panel]");
  if (!(panel instanceof HTMLElement)) return;

  panel.innerHTML = buildSidebarCategoryMenuPanel();
  bindSidebarCategoryMenuActions(panel, category);

  overlay.classList.remove("hidden");
  overlay.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  row?.classList.add("is-menu-open");
  activeSidebarCategoryMenu = { trigger, row, categoryId: category.id };

  requestAnimationFrame(() => {
    if (activeSidebarCategoryMenu?.trigger !== trigger) return;
    positionSidebarCategoryMenuPanel(panel, trigger);
  });
}

function onSidebarCategoryMenuViewportChange() {
  if (activeSidebarCategoryMenu) closeSidebarCategoryMenu();
}

function ensureSidebarCategoryMenuDismiss() {
  if (sidebarCategoryMenuDismissBound) return;
  sidebarCategoryMenuDismissBound = true;
  getSidebarCategoryMenuOverlay();
  document.addEventListener("click", (event) => {
    if (!activeSidebarCategoryMenu) return;
    const target = event.target;
    if (target instanceof Element && (
      target.closest("#sidebar-category-menu-overlay") ||
      target.closest("[data-sidebar-category-menu-trigger]")
    )) return;
    closeSidebarCategoryMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeSidebarCategoryMenu) return;
    closeSidebarCategoryMenu();
  });
  window.addEventListener("scroll", onSidebarCategoryMenuViewportChange, true);
  window.addEventListener("resize", onSidebarCategoryMenuViewportChange);
}

function cleanupNavSettingsForCategory(categoryId) {
  delete state.settings.navViewModes?.[categoryId];
  delete state.settings.navSortSettings?.[categoryId];
}

async function confirmDeleteSidebarCategory(category) {
  if (!category) return;
  let confirmed = false;
  const body = document.createElement("div");
  body.className = "sidebar-category-delete-modal";
  body.innerHTML = `
    <p class="sidebar-category-delete-modal__lead">${escapeHtml(interpolateLabel(t("ui.deleteSidebarCategoryConfirm"), { name: category.name || "" }))}</p>
    <p class="sidebar-category-delete-modal__hint">${escapeHtml(t("ui.deleteSidebarCategoryKeepBookmarks"))}</p>
    <div class="sidebar-category-delete-modal__switch-row">
      <label class="toggle-switch" for="sidebar-category-delete-bookmarks">
        <input id="sidebar-category-delete-bookmarks" name="deleteBookmarks" type="checkbox" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="toggle-switch__label">${escapeHtml(t("ui.deleteSidebarCategoryAlsoBookmarks"))}</span>
      </label>
    </div>
    <p class="sidebar-category-delete-modal__warning hidden" data-delete-bookmarks-warning>${escapeHtml(t("ui.deleteSidebarCategoryAlsoBookmarksHint"))}</p>
  `;
  const deleteBookmarksToggle = body.querySelector("#sidebar-category-delete-bookmarks");
  const warning = body.querySelector("[data-delete-bookmarks-warning]");
  deleteBookmarksToggle?.addEventListener("change", () => {
    warning?.classList.toggle("hidden", !deleteBookmarksToggle.checked);
  });

  await showModal({
    title: t("ui.delete"),
    content: body,
    saveLabel: t("ui.delete"),
    cancelLabel: t("ui.cancel"),
    submitOnEnter: false,
    onSave: async () => {
      confirmed = true;
      const deleteBookmarks = Boolean(deleteBookmarksToggle?.checked);
      const categoryId = category.id;
      const wasActive = getActiveNavId() === categoryId;
      pushUndo();
      deleteSidebarCategoryFromConfig(state.config, categoryId, { deleteBookmarks });
      cleanupNavSettingsForCategory(categoryId);
      await persistConfig();
      await persistSettings();
      if (wasActive) {
        await selectNav(NAV_ALL);
      } else {
        render();
      }
    }
  });
  return confirmed;
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
      { homepage: navId === NAV_ALL, navId }
    ));
  }
  return root;
}

function isUnsortedBrowserFolderFilterActive() {
  return unsortedBrowserFolderFilter.size > 0;
}

function pathMatchesUnsortedFolderFilterSearch(path, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  return String(path || "").toLowerCase().includes(normalizedQuery);
}

function closeUnsortedFolderFilterDropdown() {
  unsortedFolderFilterDropdownOpen = false;
  unsortedFolderFilterSearchQuery = "";
}

function applyUnsortedFolderFilterSearchVisibility(container, query) {
  if (!(container instanceof Element)) return;
  const options = container.querySelector(".unsorted-folder-filter__options");
  if (!options) return;
  let visibleCount = 0;
  options.querySelectorAll(".unsorted-folder-filter__option").forEach((label) => {
    const path = label.getAttribute("data-path") || "";
    const visible = pathMatchesUnsortedFolderFilterSearch(path, query);
    label.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });
  const noMatch = container.querySelector("[data-unsorted-filter-no-match]");
  const hasPaths = options.querySelector(".unsorted-folder-filter__option") != null;
  if (noMatch instanceof HTMLElement) {
    noMatch.classList.toggle(
      "hidden",
      !hasPaths || visibleCount > 0 || !String(query || "").trim()
    );
  }
}

function filterUnsortedNavBookmarks(bookmarks) {
  return filterBookmarksByBrowserFolderPaths(bookmarks, unsortedBrowserFolderFilter);
}

function ensureUnsortedFolderFilterDismiss() {
  if (unsortedFolderFilterDismissBound) return;
  unsortedFolderFilterDismissBound = true;
  document.addEventListener("pointerdown", (event) => {
    if (!unsortedFolderFilterDropdownOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".unsorted-folder-filter")) return;
    closeUnsortedFolderFilterDropdown();
    render();
  });
}

function ensureBookmarkSortDismiss() {
  if (bookmarkSortDismissBound) return;
  bookmarkSortDismissBound = true;
  document.addEventListener("pointerdown", (event) => {
    if (!bookmarkSortDropdownOpen) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".bookmark-sort")) return;
    bookmarkSortDropdownOpen = false;
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !bookmarkSortDropdownOpen) return;
    bookmarkSortDropdownOpen = false;
    render();
  });
}

function renderBookmarkSortControl(navId) {
  ensureBookmarkSortDismiss();
  const sortSetting = getNavSortSetting(state.settings, navId);
  const dropdownOpen = bookmarkSortDropdownOpen;
  const wrap = document.createElement("div");
  wrap.className = "bookmark-sort";

  const orderOption = (order, icon, label) => `
    <button
      type="button"
      class="bookmark-sort__option ${sortSetting.order === order ? "is-active" : ""}"
      data-sort-order="${order}"
      role="radio"
      aria-checked="${sortSetting.order === order ? "true" : "false"}"
    >
      <span class="bookmark-sort__option-icon" aria-hidden="true">${iconSvg(icon, "inline-icon")}</span>
      <span class="bookmark-sort__option-label">${escapeHtml(label)}</span>
    </button>
  `;

  const fieldOption = (field, label) => `
    <button
      type="button"
      class="bookmark-sort__option ${sortSetting.field === field ? "is-active" : ""}"
      data-sort-field="${field}"
      role="radio"
      aria-checked="${sortSetting.field === field ? "true" : "false"}"
    >
      <span class="bookmark-sort__option-label">${escapeHtml(label)}</span>
    </button>
  `;

  wrap.innerHTML = `
    <button
      type="button"
      class="btn btn--ghost btn--compact bookmark-sort__toggle ${dropdownOpen ? "is-active" : ""}"
      data-bookmark-sort-toggle
      aria-expanded="${dropdownOpen ? "true" : "false"}"
      aria-haspopup="true"
    >
      <span class="btn__icon" aria-hidden="true">${iconSvg(ICONS.sort, "inline-icon")}</span>
      <span class="btn__label">${escapeHtml(t("ui.sort"))}</span>
    </button>
    <div class="bookmark-sort__dropdown ${dropdownOpen ? "" : "hidden"}" data-bookmark-sort-dropdown>
      <div class="bookmark-sort__section" role="radiogroup" aria-label="${escapeHtml(t("ui.sort"))}">
        ${orderOption(SORT_ORDER_ASC, ICONS.arrowUp, t("ui.sortAscending"))}
        ${orderOption(SORT_ORDER_DESC, ICONS.arrowDown, t("ui.sortDescending"))}
      </div>
      <div class="bookmark-sort__divider" aria-hidden="true"></div>
      <div class="bookmark-sort__section" role="radiogroup" aria-label="${escapeHtml(t("ui.sort"))}">
        ${fieldOption(SORT_FIELD_NAME, t("ui.sortName"))}
        ${fieldOption(SORT_FIELD_CREATED_AT, t("ui.sortCreatedDate"))}
      </div>
    </div>
  `;

  wrap.querySelector("[data-bookmark-sort-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    bookmarkSortDropdownOpen = !bookmarkSortDropdownOpen;
    render();
  });
  wrap.querySelectorAll("[data-sort-order]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void setNavSortForActive({ order: button.getAttribute("data-sort-order") });
    });
  });
  wrap.querySelectorAll("[data-sort-field]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void setNavSortForActive({ field: button.getAttribute("data-sort-field") });
    });
  });

  return wrap;
}

function renderNavSelectionToggle() {
  const wrap = document.createElement("div");
  wrap.className = "nav-selection-toggle";
  wrap.innerHTML = button({
    label: t("ui.selectMode"),
    icon: iconSvg(ICONS.selectMark, "inline-icon"),
    dataAttr: "data-nav-selection-toggle",
    variant: "btn--ghost",
    className: `btn--compact ${navSelectionMode ? "is-active" : ""}`
  });
  wrap.querySelector("[data-nav-selection-toggle]")?.addEventListener("click", () => {
    setNavSelectionMode(!navSelectionMode);
  });
  return wrap;
}

function renderNavSelectionActions() {
  const bar = document.createElement("div");
  bar.className = "nav-view-header__selection-actions";
  if (navSelectionMode) bar.classList.add("is-visible");
  const selectedCount = navSelectedBookmarkIds.size;
  bar.innerHTML = `
    ${button({
      label: t("ui.selectAll"),
      icon: mdiIcon("select-all", "inline-icon"),
      dataAttr: "data-nav-select-all",
      variant: "btn--ghost",
      className: "btn--compact"
    })}
    ${button({
      label: t("ui.selectNone"),
      icon: mdiIcon("select-off", "inline-icon"),
      dataAttr: "data-nav-select-none",
      variant: "btn--ghost",
      className: "btn--compact"
    })}
    ${button({
      label: interpolateLabel(t("ui.deleteSelectedBookmarks"), { count: String(selectedCount) }),
      icon: iconSvg(ICONS.trash, "inline-icon"),
      dataAttr: "data-nav-select-delete",
      variant: "btn--ghost",
      className: `btn--compact${selectedCount > 0 ? "" : " hidden"}`
    })}
  `;
  bar.querySelector("[data-nav-select-all]")?.addEventListener("click", () => {
    activateNavSelectionAndSelectAllVisible();
  });
  bar.querySelector("[data-nav-select-none]")?.addEventListener("click", () => {
    clearAllNavBookmarkSelection();
  });
  bar.querySelector("[data-nav-select-delete]")?.addEventListener("click", () => {
    void requestDeleteSelectedNavBookmarks();
  });
  return bar;
}

function renderUnsortedFolderFilter() {
  ensureUnsortedFolderFilterDismiss();
  const wrap = document.createElement("div");
  wrap.className = "unsorted-folder-filter";
  const allBookmarks = getBookmarksForNav(state.config, NAV_UNSORTED);
  const paths = collectUnsortedBrowserFolderPaths(allBookmarks, state.config);
  const filterActive = isUnsortedBrowserFolderFilterActive();
  const dropdownOpen = unsortedFolderFilterDropdownOpen;
  const searchQuery = unsortedFolderFilterSearchQuery;
  const showNoMatch = paths.length > 0
    && String(searchQuery || "").trim()
    && !paths.some((path) => pathMatchesUnsortedFolderFilterSearch(path, searchQuery));

  wrap.innerHTML = `
    <button
      type="button"
      class="btn btn--ghost btn--compact unsorted-folder-filter__toggle ${filterActive ? "is-active" : ""}"
      data-unsorted-filter-toggle
      aria-expanded="${dropdownOpen ? "true" : "false"}"
      aria-haspopup="true"
    >
      <span class="btn__icon" aria-hidden="true">${iconSvg(ICONS.filter, "inline-icon")}</span>
      <span class="btn__label" data-unsorted-filter-label>${escapeHtml(t("ui.unsortedFilter"))}</span>
    </button>
    <div class="unsorted-folder-filter__dropdown ${dropdownOpen ? "" : "hidden"}" data-unsorted-filter-dropdown>
      <div class="unsorted-folder-filter__search">
        <input
          type="search"
          class="unsorted-folder-filter__search-input"
          data-unsorted-filter-search
          value="${escapeHtml(searchQuery)}"
          placeholder="${escapeHtml(t("ui.unsortedFilterSearchPlaceholder"))}"
          aria-label="${escapeHtml(t("ui.unsortedFilterSearchPlaceholder"))}"
          autocomplete="off"
        />
      </div>
      <button type="button" class="unsorted-folder-filter__reset" data-unsorted-filter-reset>
        ${escapeHtml(t("ui.unsortedFilterReset"))}
      </button>
      <div class="unsorted-folder-filter__options" role="group" aria-label="${escapeHtml(t("ui.unsortedFilter"))}">
        ${paths.length
    ? paths.map((path) => {
      const visible = pathMatchesUnsortedFolderFilterSearch(path, searchQuery);
      return `
            <label
              class="theme-checkbox unsorted-folder-filter__option ${visible ? "" : "hidden"}"
              data-path="${escapeHtml(path)}"
            >
              <input
                type="checkbox"
                class="theme-checkbox__input"
                value="${escapeHtml(path)}"
                ${unsortedBrowserFolderFilter.has(path) ? "checked" : ""}
              />
              <span class="theme-checkbox__box" aria-hidden="true"></span>
              <span class="theme-checkbox__label">${escapeHtml(path)}</span>
            </label>
          `;
    }).join("")
    : `<p class="unsorted-folder-filter__empty">${escapeHtml(t("ui.unsortedFilterEmpty"))}</p>`}
      </div>
      <p class="unsorted-folder-filter__no-match ${showNoMatch ? "" : "hidden"}" data-unsorted-filter-no-match>
        ${escapeHtml(t("ui.unsortedFilterNoMatch"))}
      </p>
    </div>
  `;

  wrap.querySelector("[data-unsorted-filter-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (unsortedFolderFilterDropdownOpen) {
      closeUnsortedFolderFilterDropdown();
    } else {
      unsortedFolderFilterDropdownOpen = true;
    }
    render();
  });
  wrap.querySelector("[data-unsorted-filter-search]")?.addEventListener("input", (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    unsortedFolderFilterSearchQuery = input.value;
    applyUnsortedFolderFilterSearchVisibility(wrap, unsortedFolderFilterSearchQuery);
  });
  wrap.querySelector("[data-unsorted-filter-reset]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    unsortedBrowserFolderFilter.clear();
    unsortedFolderFilterDropdownOpen = true;
    wrap.querySelectorAll(".theme-checkbox__input").forEach((input) => {
      if (input instanceof HTMLInputElement) input.checked = false;
    });
    updateUnsortedFolderFilterToggleState();
    pruneNavSelectionToVisible();
    refreshNavBookmarkList();
  });
  wrap.querySelectorAll(".theme-checkbox__input").forEach((input) => {
    input.addEventListener("change", () => {
      const path = String(input.value || "").trim();
      if (!path) return;
      if (input.checked) unsortedBrowserFolderFilter.add(path);
      else unsortedBrowserFolderFilter.delete(path);
      unsortedFolderFilterDropdownOpen = true;
      updateUnsortedFolderFilterToggleState();
      pruneNavSelectionToVisible();
      refreshNavBookmarkList();
    });
  });

  return wrap;
}

function renderViewModeToggle(viewMode, { showCategorySync = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "view-mode-toggle";
  const syncDisabled = isCategoryMetadataReloadRunning() ? "disabled" : "";
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
    ${showCategorySync ? button({
      label: t("ui.reloadCategoryMetadata"),
      icon: iconSvg(ICONS.sync, "inline-icon"),
      dataAttr: `data-reload-category-metadata ${syncDisabled}`,
      variant: "btn--ghost",
      className: "btn--compact",
      iconOnly: true
    }) : ""}
  `;
  const listButton = wrap.querySelector(`[data-view-mode="${VIEW_LIST}"]`);
  const cardsButton = wrap.querySelector(`[data-view-mode="${VIEW_CARDS}"]`);
  const syncButton = wrap.querySelector("[data-reload-category-metadata]");
  listButton?.setAttribute("aria-label", t("ui.viewList"));
  listButton?.setAttribute("title", t("ui.viewList"));
  cardsButton?.setAttribute("aria-label", t("ui.viewCards"));
  cardsButton?.setAttribute("title", t("ui.viewCards"));
  if (syncButton instanceof HTMLButtonElement) {
    syncButton.setAttribute("aria-label", t("ui.reloadCategoryMetadata"));
    syncButton.setAttribute("title", t("ui.reloadCategoryMetadata"));
    syncButton.addEventListener("click", () => {
      void reloadCategoryMetadata();
    });
  }
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
  header.className = "nav-view-header nav-view-header--toolbar";
  header.append(renderNavSelectionActions());
  const actions = document.createElement("div");
  actions.className = "nav-view-header__actions";
  actions.append(renderNavSelectionToggle());
  actions.append(renderBookmarkSortControl(navId));
  if (navId === NAV_UNSORTED) {
    actions.append(renderUnsortedFolderFilter());
  }
  actions.append(renderViewModeToggle(viewMode, { showCategorySync: isCategoryNavId(state.config, navId) }));
  header.append(actions);
  panel.append(header);

  const bookmarks = getActiveNavBookmarks();
  const collection = renderBookmarkCollection(bookmarks, navId, viewMode);
  if (navSelectionMode) bindNavSelectionCollectionEvents(collection);
  panel.append(collection);
  return panel;
}

function render() {
  ensureNavSelectionEvents();
  const savedFilterScroll = captureUnsortedFolderFilterScroll();
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
  if (elements.addBookmarkFab) {
    elements.addBookmarkFab.classList.toggle("hidden", !state.editMode);
    elements.addBookmarkFab.setAttribute("aria-label", t("ui.newBookmark"));
    elements.addBookmarkFab.innerHTML = iconSvg(ICONS.plus, "inline-icon");
  }
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
    syncCategoryMetadataReloadBookmarkLoading();
    return;
  }

  elements.navView?.classList.remove("nav-view--homepage");
  elements.navView?.classList.remove("hidden");
  elements.categories.classList.add("hidden");
  pruneNavSelectionToVisible();
  elements.navView?.append(renderNavView());
  syncCategoryMetadataReloadBookmarkLoading();
  restoreUnsortedFolderFilterScroll(savedFilterScroll);
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
  elements.navView?.querySelectorAll("[data-reload-category-metadata]").forEach((button) => {
    button.title = t("ui.reloadCategoryMetadata");
    button.setAttribute("aria-label", t("ui.reloadCategoryMetadata"));
  });
  elements.navView?.querySelectorAll("[data-nav-selection-toggle] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.selectMode");
  });
  elements.navView?.querySelectorAll("[data-nav-select-all] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.selectAll");
  });
  elements.navView?.querySelectorAll("[data-nav-select-none] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.selectNone");
  });
  updateNavSelectionToolbar();
  document.querySelectorAll("[data-add-bookmark] .service-name").forEach((entry) => {
    entry.textContent = t("ui.addBookmark");
  });
  document.querySelectorAll("[data-add-category] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.addCategory");
  });
  refreshBookmarkSearchTexts();
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
  form.querySelector("[data-settings-browser-sync-status-label]")?.replaceChildren(t("ui.browserSyncStatus"));
  form.querySelector("[data-browser-sync-run] .btn__label")?.replaceChildren(t("ui.browserSyncRunNow"));
  form.querySelectorAll("[data-secret-field-edit] .btn__label").forEach((label) => {
    label.textContent = t("ui.edit");
  });
  const browserSyncStatusEl = form.querySelector("[data-browser-sync-status]");
  if (browserSyncStatusEl?._lastBrowserSyncStatus !== undefined) {
    renderBrowserSyncStatus(browserSyncStatusEl, browserSyncStatusEl._lastBrowserSyncStatus);
  }
  form.closest(".modal")?.querySelector("[data-cancel] .btn__label")?.replaceChildren(t("ui.close"));
}

function maskSecretDisplay(value) {
  if (!value) return "";
  return "\u2022".repeat(Math.min(Math.max(value.length, 8), 32));
}

function initSecretField(wrap, { onChange } = {}) {
  if (!wrap) return null;
  const input = wrap.querySelector(".secret-field__input");
  const editBtn = wrap.querySelector("[data-secret-field-edit]");
  if (!input || !editBtn) return null;

  const getValue = () => wrap.dataset.secretValue || "";
  const setValue = (next) => {
    wrap.dataset.secretValue = next ?? "";
    if (input.classList.contains("is-locked")) {
      input.value = maskSecretDisplay(wrap.dataset.secretValue);
    } else {
      input.value = wrap.dataset.secretValue;
    }
  };
  const lock = () => {
    input.classList.add("is-locked");
    input.readOnly = true;
    input.tabIndex = -1;
    input.setAttribute("aria-readonly", "true");
    input.value = maskSecretDisplay(getValue());
  };
  const unlock = () => {
    input.classList.remove("is-locked");
    input.readOnly = false;
    input.tabIndex = 0;
    input.removeAttribute("aria-readonly");
    input.value = getValue();
    input.focus();
    if (typeof input.select === "function") input.select();
  };

  editBtn.addEventListener("click", () => {
    if (input.disabled || !input.classList.contains("is-locked")) return;
    unlock();
  });
  input.addEventListener("input", () => {
    wrap.dataset.secretValue = input.value;
    onChange?.(input.value);
  });

  lock();
  return { getValue, setValue, lock, unlock, input, editBtn };
}

function setBrowserSyncStatusMessage(container, className, message) {
  if (!container) return;
  container.className = `browser-sync-status ${className}`.trim();
  container.replaceChildren(document.createTextNode(message));
  container._lastBrowserSyncStatus = undefined;
}

function renderBrowserSyncStatus(container, status) {
  if (!container) return;
  container._lastBrowserSyncStatus = status;
  if (!status?.lastSync) {
    setBrowserSyncStatusMessage(container, "browser-sync-status--empty", t("ui.browserSyncNever"));
    return;
  }
  const last = status.lastSync;
  if (!last.ok) {
    container.className = "browser-sync-status browser-sync-status--error";
    container.replaceChildren();
    const label = document.createElement("span");
    label.className = "browser-sync-status__label";
    label.textContent = t("ui.browserSyncLastFailedLabel");
    const message = document.createElement("span");
    message.className = "browser-sync-status__message";
    message.textContent = last.error || "?";
    container.append(label, document.createTextNode(" "), message);
    return;
  }
  container.className = "browser-sync-status browser-sync-status--ok";
  container.replaceChildren();
  const label = document.createElement("span");
  label.className = "browser-sync-status__label";
  label.textContent = t("ui.browserSyncLastSyncLabel");
  const time = document.createElement("time");
  time.className = "browser-sync-status__time";
  if (last.at) time.dateTime = last.at;
  time.textContent = last.at || "";
  const stats = document.createElement("ul");
  stats.className = "browser-sync-status__stats";
  [
    ["browserSyncImported", last.imported || 0],
    ["browserSyncReimported", last.reimported || 0],
    ["browserSyncDisappeared", last.disappeared || 0]
  ].forEach(([key, value]) => {
    const item = document.createElement("li");
    item.className = "browser-sync-status__stat";
    const statLabel = document.createElement("span");
    statLabel.className = "browser-sync-status__stat-label";
    statLabel.textContent = t(`ui.${key}`);
    const statValue = document.createElement("span");
    statValue.className = "browser-sync-status__stat-value";
    statValue.textContent = String(value);
    item.append(statLabel, statValue);
    stats.append(item);
  });
  container.append(label, time, stats);
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

  wireMdiIconSearch(form, { fallbackIcon: category?.icon || FALLBACK_MDI_ICON });
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
}

function renderBookmarkThemeCheckbox({
  name,
  value = "",
  checked = false,
  label,
  inputAttrs = "",
  extraClass = ""
} = {}) {
  const nameAttr = name ? ` name="${escapeHtml(name)}"` : "";
  const valueAttr = value ? ` value="${escapeHtml(value)}"` : "";
  const checkedAttr = checked ? " checked" : "";
  const className = ["theme-checkbox", "bookmark-placement-option", extraClass].filter(Boolean).join(" ");
  return `
    <label class="${className}">
      <input
        type="checkbox"
        class="theme-checkbox__input"
        ${nameAttr}${valueAttr}${checkedAttr}
        ${inputAttrs}
      />
      <span class="theme-checkbox__box" aria-hidden="true"></span>
      <span class="theme-checkbox__label">${escapeHtml(label)}</span>
    </label>
  `;
}

function renderBookmarkPlacementFields({
  homepageEnabled,
  homepageCategoryId,
  selectedSidebarIds,
  unsortedSelected = false
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
    .map((category) => renderBookmarkThemeCheckbox({
      name: "sidebarCategoryIds",
      value: category.id,
      checked: sidebarSelected.has(category.id),
      label: category.name
    }))
    .join("");

  return `
    <div class="bookmark-placement-option bookmark-placement-option--with-select">
      ${renderBookmarkThemeCheckbox({
    name: "homepageEnabled",
    checked: homepageEnabled,
    label: getHomepageName(),
    inputAttrs: "data-homepage-toggle",
    extraClass: "bookmark-placement-option__toggle"
  })}
      <select
        name="homepageCategoryId"
        data-homepage-category
        class="bookmark-placement-option__select"
        ${homepageEnabled ? "" : "disabled"}
      >
        <option value="">${escapeHtml(t("ui.homepageCategoryPlaceholder"))}</option>
        ${homepageOptions}
      </select>
    </div>
    ${renderBookmarkThemeCheckbox({
    name: "sidebarCategoryIds",
    value: FAVORITES_CATEGORY_ID,
    checked: sidebarSelected.has(FAVORITES_CATEGORY_ID),
    label: t("ui.navFavorites")
  })}
    ${renderBookmarkThemeCheckbox({
    checked: unsortedSelected,
    label: t("ui.navUnsorted"),
    inputAttrs: "data-unsorted-toggle",
    extraClass: "bookmark-placement-option--unsorted"
  })}
    ${sidebarOptions}
  `;
}

function renderBookmarkPlacementTailFields({
  homepageEnabled,
  homepageCategoryId,
  selectedSidebarIds,
  unsortedSelected,
  existing
}) {
  const placementFields = renderBookmarkPlacementFields({
    homepageEnabled,
    homepageCategoryId,
    selectedSidebarIds,
    unsortedSelected
  });
  const openMode = existing?.openMode;
  return `
    <div class="form-row form-row--bookmark-placements">
      <label>${t("ui.bookmarkCategories")}</label>
      <div class="checkbox-group" data-bookmark-placements>
        ${placementFields}
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.openMode")}</label>
      <select name="openMode">
        <option value="current-tab" ${openMode !== "new-tab" ? "selected" : ""}>${t("ui.currentTab")}</option>
        <option value="new-tab" ${openMode === "new-tab" ? "selected" : ""}>${t("ui.newTab")}</option>
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
}

function renderBookmarkFormMarkup({ existing, previewImgSrc, placementTailHtml }) {
  const urlValue = escapeHtml(existing?.url || "");
  const titleValue = escapeHtml(existing?.title || "");
  const descriptionValue = escapeHtml(existing?.description || "");
  const imageValue = escapeHtml(existing?.image || "");

  return `
    <div class="form-row">
      <label>${t("ui.url")}</label>
      <input name="url" type="url" value="${urlValue}" required />
    </div>
    <div class="bookmark-metadata-section">
      <div class="bookmark-metadata-fields">
        <div class="form-row">
          <label>${t("ui.title")}</label>
          <input name="title" value="${titleValue}" required />
        </div>
        <div class="form-row">
          <label>${t("ui.description")}</label>
          <textarea name="description" rows="2">${descriptionValue}</textarea>
        </div>
        <div class="form-row">
          <label>${t("ui.image")}</label>
          <div>
            <div class="icon-url-controls">
              <input name="image" value="${imageValue}" />
              <div class="icon-preview-box">
                <img id="favicon-preview" class="icon-preview" src="${escapeHtml(previewImgSrc)}" alt="" />
              </div>
            </div>
            <small id="metadata-status" data-metadata-status></small>
          </div>
        </div>
      </div>
      <div class="bookmark-metadata-action">
        <button type="button" class="btn btn--ghost btn--load-metadata" data-load-metadata disabled>
          <span class="spinner hidden" data-load-metadata-spinner aria-hidden="true"></span>
          <span class="btn__label">${t("ui.loadInformation")}</span>
        </button>
      </div>
    </div>
    ${placementTailHtml}
  `;
}

function resolveBookmarkModalDefaults(options = {}) {
  const navId = options.navId ?? getActiveNavId();
  const defaults = {
    homepageEnabled: false,
    homepageCategoryId: "",
    selectedSidebarIds: [],
    unsortedSelected: true
  };

  if (options.homepageCategoryId) {
    defaults.homepageEnabled = true;
    defaults.homepageCategoryId = options.homepageCategoryId;
  } else if (navId === NAV_FAVORITES) {
    defaults.selectedSidebarIds = [FAVORITES_CATEGORY_ID];
    defaults.unsortedSelected = false;
  } else if (navId === NAV_UNSORTED) {
    defaults.unsortedSelected = true;
  } else if (navId !== NAV_ALL && isCategoryNavId(state.config, navId)) {
    defaults.selectedSidebarIds = [navId];
    defaults.unsortedSelected = false;
  }

  if (options.selectedSidebarIds?.length) {
    defaults.selectedSidebarIds = [...options.selectedSidebarIds];
    defaults.unsortedSelected = false;
  }

  return defaults;
}

function captureBookmarkFormSnapshot(form, shortcut) {
  const fd = new FormData(form);
  return JSON.stringify({
    title: String(fd.get("title") || "").trim(),
    url: String(fd.get("url") || "").trim(),
    description: String(fd.get("description") || "").trim(),
    image: String(fd.get("image") || "").trim(),
    openMode: String(fd.get("openMode") || "").trim(),
    shortcut: shortcut || "",
    homepageEnabled: Boolean(form.querySelector("[data-homepage-toggle]")?.checked),
    homepageCategoryId: String(form.querySelector("[data-homepage-category]")?.value || "").trim(),
    sidebarCategoryIds: [...fd.getAll("sidebarCategoryIds")]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .sort(),
    unsortedSelected: Boolean(form.querySelector("[data-unsorted-toggle]")?.checked)
  });
}

async function confirmDiscardBookmarkChanges() {
  let confirmed = false;
  const body = document.createElement("p");
  body.textContent = t("ui.discardChangesText");
  await showModal({
    title: t("ui.discardChangesTitle"),
    content: body,
    saveLabel: t("ui.yes"),
    cancelLabel: t("ui.no"),
    onSave: async () => {
      confirmed = true;
    }
  });
  return confirmed;
}

function openBookmarkModal(arg = {}) {
  const options = typeof arg === "string" ? { homepageCategoryId: arg } : arg;
  const bookmark = options.bookmark ?? null;
  const defaultHomepageCategoryId = options.homepageCategoryId || "";
  const isEdit = Boolean(bookmark);
  const existing = isEdit ? findBookmarkById(state.config, bookmark.id) : null;
  const navDefaults = isEdit ? null : resolveBookmarkModalDefaults(options);
  const homepageCategoryId = existing
    ? getBookmarkHomepageCategoryId(state.config, existing)
    : (defaultHomepageCategoryId || navDefaults?.homepageCategoryId || "");
  const homepageEnabled = existing
    ? Boolean(homepageCategoryId)
    : Boolean(navDefaults?.homepageEnabled);
  const selectedSidebarIds = existing
    ? getBookmarkSidebarPlacementIds(existing)
    : [...(navDefaults?.selectedSidebarIds || [])];
  const unsortedSelected = existing
    ? selectedSidebarIds.length === 0
    : Boolean(navDefaults?.unsortedSelected);
  const form = document.createElement("form");
  form.className = "bookmark-form";
  const previewImgSrc = existing ? bookmarkStoredImageSrc(existing) : resolveIconSrcForImgTag("");
  const placementTailHtml = renderBookmarkPlacementTailFields({
    homepageEnabled,
    homepageCategoryId,
    selectedSidebarIds,
    unsortedSelected,
    existing
  });
  form.innerHTML = renderBookmarkFormMarkup({
    existing,
    previewImgSrc,
    placementTailHtml
  });

  const imageInput = form.querySelector("input[name='image']");
  const titleInput = form.querySelector("input[name='title']");
  const descriptionInput = form.querySelector("textarea[name='description']");
  const urlInput = form.querySelector("input[name='url']");
  const shortcutCapture = form.querySelector("[data-shortcut-capture]");
  const shortcutChips = shortcutCapture?.querySelector(".shortcut-input-chips");
  const shortcutPlaceholder = shortcutCapture?.querySelector(".shortcut-input-placeholder");
  const shortcutFeedback = form.querySelector("[data-shortcut-feedback]");
  const loadMetadataButton = form.querySelector("[data-load-metadata]");
  const loadMetadataSpinner = form.querySelector("[data-load-metadata-spinner]");
  const status = form.querySelector("[data-metadata-status]");
  const preview = form.querySelector("#favicon-preview");

  let selectedShortcut = normalizeServiceShortcut(existing?.shortcut || "");
  let userEditedTitle = false;
  let userEditedDescription = false;
  let userEditedImage = false;

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

  const setStatusMessage = (message = "", isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  };

  const syncIconPreviewFromField = () => {
    const v = String(imageInput.value || "").trim();
    preview.src = resolveBookmarkPreviewSrc(v);
  };

  const syncLoadMetadataButton = () => {
    if (!loadMetadataButton) return;
    loadMetadataButton.disabled = !String(urlInput?.value || "").trim() || loadMetadataButton.classList.contains("is-loading");
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

  titleInput?.addEventListener("input", () => {
    userEditedTitle = true;
  });
  descriptionInput?.addEventListener("input", () => {
    userEditedDescription = true;
  });
  imageInput?.addEventListener("input", () => {
    userEditedImage = true;
    setStatusMessage("");
    syncIconPreviewFromField();
  });
  urlInput?.addEventListener("input", () => {
    syncLoadMetadataButton();
  });

  preview?.addEventListener("error", () => {
    const manualValue = String(imageInput.value || "").trim();
    if (manualValue) {
      setStatusMessage(t("ui.faviconFailed"), true);
      return;
    }
    preview.src = resolveServiceIconDisplaySrc("");
  });
  preview?.addEventListener("load", () => {
    setStatusMessage("");
  });

  const triggerMetadataLoad = async () => {
    const value = String(urlInput?.value || "").trim();
    if (!value || !loadMetadataButton) return;
    loadMetadataButton.disabled = true;
    loadMetadataButton.classList.add("is-loading");
    loadMetadataSpinner?.classList.remove("hidden");
    setStatusMessage("");
    try {
      const metadata = await api.fetchBookmarkMetadata(value);
      if (metadata?.ok === false) {
        throw new Error(t("ui.loadInformationFailed"));
      }
      if (!userEditedTitle && metadata.title) {
        titleInput.value = String(metadata.title).trim();
      }
      if (!userEditedDescription && metadata.description) {
        descriptionInput.value = String(metadata.description).trim();
      }
      if (!userEditedImage && metadata.image) {
        imageInput.value = normalizeBookmarkImageValue(metadata.image);
        syncIconPreviewFromField();
      } else if (!userEditedImage && !metadata.image) {
        try {
          const result = await api.cacheFavicon(value);
          const path = normalizeAppIconPath(String(result.path || "").trim());
          if (path.startsWith("/static/assets/favicon-cache/")) {
            imageInput.value = path;
            syncIconPreviewFromField();
          }
        } catch {
          // Keep existing preview input when favicon fallback fails.
        }
      }
      setStatusMessage("");
    } catch (err) {
      const detail = err && typeof err.message === "string" ? err.message.trim() : "";
      setStatusMessage(detail || t("ui.loadInformationFailed"), true);
    } finally {
      loadMetadataButton.classList.remove("is-loading");
      loadMetadataSpinner?.classList.add("hidden");
      syncLoadMetadataButton();
    }
  };

  loadMetadataButton?.addEventListener("click", triggerMetadataLoad);

  const homepageToggle = form.querySelector("[data-homepage-toggle]");
  const homepageCategorySelect = form.querySelector("[data-homepage-category]");
  const unsortedToggle = form.querySelector("[data-unsorted-toggle]");
  const placementGroup = form.querySelector("[data-bookmark-placements]");
  const sidebarCategoryInputs = () => form.querySelectorAll('input[name="sidebarCategoryIds"]');

  const syncHomepageCategorySelect = () => {
    const enabled = Boolean(homepageToggle?.checked);
    if (!homepageCategorySelect) return;
    homepageCategorySelect.disabled = !enabled;
    if (!enabled) homepageCategorySelect.removeAttribute("data-invalid");
  };

  const syncUnsortedExclusive = (source) => {
    if (!unsortedToggle) return;
    const sidebarInputs = [...sidebarCategoryInputs()];
    const anySidebarChecked = sidebarInputs.some((input) => input.checked);

    if (source === unsortedToggle) {
      if (unsortedToggle.checked) {
        sidebarInputs.forEach((input) => {
          input.checked = false;
        });
      } else if (!anySidebarChecked) {
        unsortedToggle.checked = true;
      }
      return;
    }

    if (anySidebarChecked) {
      unsortedToggle.checked = false;
    } else {
      unsortedToggle.checked = true;
    }
  };

  const syncPlacementState = () => {
    placementGroup?.removeAttribute("data-invalid");
    homepageCategorySelect?.removeAttribute("data-invalid");
    syncHomepageCategorySelect();
  };

  homepageToggle?.addEventListener("change", syncPlacementState);
  homepageCategorySelect?.addEventListener("change", syncPlacementState);
  unsortedToggle?.addEventListener("change", () => {
    syncUnsortedExclusive(unsortedToggle);
    syncPlacementState();
  });
  sidebarCategoryInputs().forEach((input) => {
    input.addEventListener("change", () => {
      syncUnsortedExclusive(input);
      syncPlacementState();
    });
  });
  syncUnsortedExclusive(null);
  syncPlacementState();
  syncIconPreviewFromField();
  updateShortcutUI();
  validateShortcut();
  syncLoadMetadataButton();

  const initialSnapshot = captureBookmarkFormSnapshot(form, selectedShortcut);

  showModal({
    title: isEdit ? t("ui.editBookmark") : t("ui.newBookmark"),
    content: form,
    modalClass: "modal--bookmark-form",
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
    onCancel: async () => {
      const currentSnapshot = captureBookmarkFormSnapshot(form, selectedShortcut);
      if (currentSnapshot === initialSnapshot) return;
      const confirmed = await confirmDiscardBookmarkChanges();
      if (!confirmed) return false;
    },
    onSave: async () => {
      if (!form.reportValidity()) return false;
      if (!validateShortcut()) return false;
      const fd = new FormData(form);
      const homepageEnabledValue = Boolean(form.querySelector("[data-homepage-toggle]")?.checked);
      const homepageCategorySelectEl = form.querySelector("[data-homepage-category]");
      const homepageCategoryIdValue = String(homepageCategorySelectEl?.value || "").trim();
      const listCategoryIds = new Set(listBookmarkListCategories(state.config).map((category) => category.id));
      const unsortedActive = Boolean(form.querySelector("[data-unsorted-toggle]")?.checked);
      let sidebarCategoryIds = [
        ...new Set(fd.getAll("sidebarCategoryIds").map((id) => String(id || "").trim()).filter(Boolean))
      ];
      if (unsortedActive) {
        sidebarCategoryIds = [];
      } else {
        sidebarCategoryIds = sidebarCategoryIds.filter((id) => id !== UNSORTED_CATEGORY_ID);
      }

      form.querySelector("[data-bookmark-placements]")?.removeAttribute("data-invalid");
      homepageCategorySelectEl?.removeAttribute("data-invalid");

      let categoryIds = [];
      if (homepageEnabledValue) {
        if (!homepageCategoryIdValue || !listCategoryIds.has(homepageCategoryIdValue)) {
          form.querySelector("[data-bookmark-placements]")?.setAttribute("data-invalid", "true");
          homepageCategorySelectEl?.setAttribute("data-invalid", "true");
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
        entry.favorite = sidebarCategoryIds.includes(FAVORITES_CATEGORY_ID);
        entry.sidebarCategoryIds = sidebarCategoryIds;
        const preservedNonListCategoryIds = (entry.categoryIds || []).filter((id) => !listCategoryIds.has(id));
        entry.categoryIds = homepageEnabledValue
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
          shortcut: selectedShortcut,
          createdAt: bookmarkTimestampNow()
        };
        state.config.bookmarks.push(created);
        applyPlacementUpdates(created, created.id, [], []);
      }
      await persistConfig();
      render();
    }
  });
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
      <div class="secret-field" data-secret-field>
        <input
          id="browser-sync-pat"
          class="secret-field__input is-locked"
          name="githubPatDisplay"
          type="text"
          value=""
          readonly
          tabindex="-1"
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-form-type="other"
          aria-readonly="true"
        />
        <button type="button" class="btn btn--ghost btn--compact secret-field__edit" data-secret-field-edit>
          <span class="btn__label">${t("ui.edit")}</span>
        </button>
      </div>
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label data-settings-browser-sync-interval-label for="browser-sync-interval">${t("ui.browserSyncInterval")}</label>
      <input id="browser-sync-interval" name="syncIntervalHours" type="number" min="1" max="168" step="1" value="${browserSync.syncIntervalHours}" />
    </div>
    <div class="form-row ${browserSync.enabled ? "" : "hidden"}" data-browser-sync-field>
      <label data-settings-browser-sync-status-label>${t("ui.browserSyncStatus")}</label>
      <div class="browser-sync-actions">
        <button type="button" class="btn btn--ghost" data-browser-sync-run><span class="btn__label">${t("ui.browserSyncRunNow")}</span></button>
        <div class="browser-sync-status browser-sync-status--loading" data-browser-sync-status>${t("ui.browserSyncLoading")}</div>
      </div>
    </div>
    <div class="settings-section-title" data-settings-shortcuts-label>${t("ui.shortcuts")}</div>
    <div class="settings-shortcuts-list">
      ${shortcutRows}
    </div>
    <div class="settings-section-title" data-settings-actions-label>${t("ui.actions")}</div>
    <div class="form-row settings-actions-block">
      <span class="settings-actions-block__anchor" aria-hidden="true"></span>
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
  const browserSyncIntervalInput = form.querySelector("input[name='syncIntervalHours']");
  const browserSyncStatusEl = form.querySelector("[data-browser-sync-status]");
  const browserSyncRunBtn = form.querySelector("[data-browser-sync-run]");
  const browserSyncSecretField = initSecretField(form.querySelector("[data-secret-field]"), {
    onChange: () => {
      applyBrowserSyncToState();
      scheduleSettingsPersist();
    }
  });
  browserSyncSecretField?.setValue(browserSync.githubPat);
  const applyBrowserSyncToState = () => {
    state.settings.browserSync = normalizeBrowserSyncSettings({
      enabled: Boolean(browserSyncEnabledInput?.checked),
      githubFileUrl: browserSyncUrlInput?.value || "",
      githubPat: browserSyncSecretField?.getValue() || "",
      syncIntervalHours: browserSyncIntervalInput?.value || 6
    });
  };
  const refreshBrowserSyncStatus = async () => {
    if (!browserSyncStatusEl) return;
    try {
      const status = await api.getBrowserSyncStatus();
      renderBrowserSyncStatus(browserSyncStatusEl, status);
    } catch {
      setBrowserSyncStatusMessage(browserSyncStatusEl, "browser-sync-status--error", t("ui.browserSyncStatusFailed"));
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
  browserSyncIntervalInput?.addEventListener("input", () => {
    applyBrowserSyncToState();
    scheduleSettingsPersist();
  });
  browserSyncRunBtn?.addEventListener("click", async () => {
    applyBrowserSyncToState();
    await api.saveSettings(deepClone(state.settings));
    browserSyncRunBtn.disabled = true;
    setBrowserSyncStatusMessage(browserSyncStatusEl, "browser-sync-status--loading", t("ui.browserSyncRunning"));
    try {
      const result = await api.runBrowserSync();
      if (result?.ok) {
        state.config = normalizeConfig(await api.getConfig());
        render();
      }
      await refreshBrowserSyncStatus();
    } catch {
      setBrowserSyncStatusMessage(browserSyncStatusEl, "browser-sync-status--error", t("ui.browserSyncStatusFailed"));
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
