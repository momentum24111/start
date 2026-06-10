import {
  getBookmarksForCategory,
  getBookmarksForSidebarCategory,
  getBookmarksOnHomepage,
  findSidebarCategoryById,
  findSidebarCategoryBySlug,
  listSidebarCategories,
  isBookmarkInFavorites,
  isUnsortedBookmark,
  UNSORTED_CATEGORY_ID
} from "./bookmarks.js";

export { UNSORTED_CATEGORY_ID };

export const NAV_ALL = "all";
export const NAV_FAVORITES = "favorites";
export const NAV_UNSORTED = "unsorted";

export const VIEW_LIST = "list";
export const VIEW_CARDS = "cards";
export const VIEW_MODE_OPTIONS = [VIEW_LIST, VIEW_CARDS];

export const SYSTEM_NAV_ITEMS = [
  { id: NAV_ALL, labelKey: "ui.navStart", icon: "play" },
  { id: NAV_FAVORITES, labelKey: "ui.navFavorites", icon: "star" },
  { id: NAV_UNSORTED, labelKey: "ui.navUnsorted", icon: "folder-outline" }
];

const DEFAULT_ACTIVE_NAV_ID = NAV_ALL;
const DEFAULT_VIEW_MODE = VIEW_LIST;

const HASH_ROUTE_START = "start";
const HASH_ROUTE_FAVORITES = "favoriten";
const HASH_ROUTE_UNSORTED = "unsortiert";
const HASH_ROUTE_CATEGORY_PREFIX = "kategorie/";

export function normalizeNavHash(value) {
  return decodeURIComponent(String(value || "").replace(/^#/, "").trim()).toLowerCase();
}

export function navIdToHash(config, navId) {
  const normalizedNavId = normalizeActiveNavId(navId);
  if (normalizedNavId === NAV_ALL) return HASH_ROUTE_START;
  if (normalizedNavId === NAV_FAVORITES) return HASH_ROUTE_FAVORITES;
  if (normalizedNavId === NAV_UNSORTED) return HASH_ROUTE_UNSORTED;
  const category = findSidebarCategoryById(config, normalizedNavId);
  if (category?.slug) return `${HASH_ROUTE_CATEGORY_PREFIX}${category.slug}`;
  return HASH_ROUTE_START;
}

export function parseNavIdFromHash(hash, config) {
  const raw = normalizeNavHash(hash);
  if (!raw || raw === HASH_ROUTE_START) return NAV_ALL;
  if (raw === HASH_ROUTE_FAVORITES) return NAV_FAVORITES;
  if (raw === HASH_ROUTE_UNSORTED) return NAV_UNSORTED;
  if (raw.startsWith(HASH_ROUTE_CATEGORY_PREFIX)) {
    const slug = raw.slice(HASH_ROUTE_CATEGORY_PREFIX.length);
    const category = findSidebarCategoryBySlug(config, slug);
    if (category) return category.id;
    return null;
  }
  return null;
}

export function resolveNavIdFromHash(config, hash, settings) {
  const parsed = parseNavIdFromHash(hash, config);
  if (parsed === null) {
    if (normalizeNavHash(hash)) return NAV_ALL;
    return resolveActiveNavId(config, settings);
  }
  if (isValidNavId(config, parsed)) return parsed;
  return NAV_ALL;
}

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
  return listSidebarCategories(config);
}

export function findCategoryById(config, categoryId) {
  return (config.categories || []).find((entry) => entry.id === categoryId) || null;
}

export function getBookmarksForNav(config, navId) {
  const bookmarks = config.bookmarks || [];
  if (navId === NAV_ALL) {
    return getBookmarksOnHomepage(config);
  }
  if (navId === NAV_FAVORITES) {
    return bookmarks.filter((bookmark) => isBookmarkInFavorites(bookmark));
  }
  if (navId === NAV_UNSORTED) {
    return bookmarks.filter((bookmark) => isUnsortedBookmark(bookmark, config));
  }
  if (findSidebarCategoryById(config, navId)) {
    return getBookmarksForSidebarCategory(config, navId);
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
  return Boolean(findSidebarCategoryById(config, navId));
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

export function shouldShowCategoryGrid(activeNavId) {
  return activeNavId === NAV_ALL;
}
