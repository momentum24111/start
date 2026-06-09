import {
  getBookmarksForCategory,
  listBookmarkListCategories,
  normalizeCategoryType
} from "./bookmarks.js";

export const NAV_ALL = "all";
export const NAV_FAVORITES = "favorites";
export const NAV_UNSORTED = "unsorted";
export const UNSORTED_CATEGORY_ID = "unsorted";

export const VIEW_LIST = "list";
export const VIEW_CARDS = "cards";
export const VIEW_MODE_OPTIONS = [VIEW_LIST, VIEW_CARDS];

export const SYSTEM_NAV_ITEMS = [
  { id: NAV_ALL, labelKey: "ui.navAllBookmarks", icon: "bookmark-multiple" },
  { id: NAV_FAVORITES, labelKey: "ui.navFavorites", icon: "star" },
  { id: NAV_UNSORTED, labelKey: "ui.navUnsorted", icon: "folder-outline" }
];

const DEFAULT_ACTIVE_NAV_ID = NAV_ALL;
const DEFAULT_VIEW_MODE = VIEW_LIST;

export function normalizeActiveNavId(value) {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_ACTIVE_NAV_ID;
}

export function normalizeNavViewModes(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const [navId, mode] of Object.entries(source)) {
    const key = String(navId || "").trim();
    if (!key) continue;
    if (VIEW_MODE_OPTIONS.includes(mode)) {
      normalized[key] = mode;
    }
  }
  return normalized;
}

export function getNavViewMode(settings, navId) {
  const modes = normalizeNavViewModes(settings?.navViewModes);
  return modes[navId] || DEFAULT_VIEW_MODE;
}

export function setNavViewMode(settings, navId, mode) {
  if (!VIEW_MODE_OPTIONS.includes(mode)) return;
  if (!settings.navViewModes) settings.navViewModes = {};
  settings.navViewModes[navId] = mode;
}

export function getSidebarCategories(config) {
  return listBookmarkListCategories(config)
    .filter((category) => category.id !== UNSORTED_CATEGORY_ID)
    .sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" })
    );
}

export function findCategoryById(config, categoryId) {
  return (config.categories || []).find((entry) => entry.id === categoryId) || null;
}

export function isUnsortedBookmark(bookmark) {
  const categoryIds = Array.isArray(bookmark?.categoryIds) ? bookmark.categoryIds : [];
  if (!categoryIds.length) return true;
  return categoryIds.every((id) => id === UNSORTED_CATEGORY_ID);
}

export function getBookmarksForNav(config, navId) {
  const bookmarks = config.bookmarks || [];
  if (navId === NAV_ALL) {
    return [...bookmarks];
  }
  if (navId === NAV_FAVORITES) {
    return bookmarks.filter((bookmark) => Boolean(bookmark.favorite));
  }
  if (navId === NAV_UNSORTED) {
    return bookmarks.filter((bookmark) => isUnsortedBookmark(bookmark));
  }
  return getBookmarksForCategory(config, navId);
}

export function getBookmarkCountForNav(config, navId) {
  return getBookmarksForNav(config, navId).length;
}

export function isSystemNavId(navId) {
  return SYSTEM_NAV_ITEMS.some((entry) => entry.id === navId);
}

export function isCategoryNavId(config, navId) {
  if (!navId || isSystemNavId(navId)) return false;
  const category = findCategoryById(config, navId);
  return Boolean(category && normalizeCategoryType(category.type) !== "iframe");
}

export function isValidNavId(config, navId) {
  if (isSystemNavId(navId)) return true;
  return isCategoryNavId(config, navId);
}

export function resolveActiveNavId(config, settings) {
  const candidate = normalizeActiveNavId(settings?.activeNavId);
  if (isValidNavId(config, candidate)) return candidate;
  return DEFAULT_ACTIVE_NAV_ID;
}

export function shouldShowCategoryGrid(activeNavId, editMode, viewMode) {
  if (editMode) return true;
  if (activeNavId !== NAV_ALL) return false;
  return viewMode === VIEW_LIST;
}
