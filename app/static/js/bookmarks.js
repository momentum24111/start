/** Einheitliches Lesezeichen-Datenmodell (schemaVersion 2). */

export const SCHEMA_VERSION = 2;

export const BOOKMARK_SOURCE_OPTIONS = ["manual", "browser-import"];
export const DEFAULT_BOOKMARK_SOURCE = "manual";

const CATEGORY_TYPE_OPTIONS = ["service-list", "iframe"];
const DEFAULT_CATEGORY_TYPE = "service-list";
const CATEGORY_SLOT_OPTIONS = [1, 2, 3];
const DEFAULT_CATEGORY_SLOTS = 1;

export function normalizeBookmarkSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return BOOKMARK_SOURCE_OPTIONS.includes(normalized) ? normalized : DEFAULT_BOOKMARK_SOURCE;
}

export function normalizeCategoryType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CATEGORY_TYPE_OPTIONS.includes(normalized) ? normalized : DEFAULT_CATEGORY_TYPE;
}

export function normalizeCategorySlots(value) {
  const parsed = Number(value);
  return CATEGORY_SLOT_OPTIONS.includes(parsed) ? parsed : DEFAULT_CATEGORY_SLOTS;
}

export function normalizeIframeUrl(value) {
  return String(value || "").trim();
}

function legacyServiceToImage(service) {
  const cached = String(service?.cachedIcon || "").trim();
  const iconUrl = String(service?.iconUrl || "").trim();
  return cached || iconUrl;
}

function legacyServiceToBookmark(service, categoryId) {
  const bookmark = {
    id: String(service?.id || "").trim() || crypto.randomUUID().slice(0, 8),
    title: String(service?.name || service?.title || "").trim(),
    url: String(service?.url || "").trim(),
    description: String(service?.description || "").trim(),
    image: legacyServiceToImage(service),
    categoryIds: categoryId ? [categoryId] : [],
    favorite: Boolean(service?.favorite),
    source: normalizeBookmarkSource(service?.source)
  };
  if (service?.openMode) bookmark.openMode = service.openMode;
  if (service?.shortcut) bookmark.shortcut = service.shortcut;
  const browserId = String(service?.browserId || "").trim();
  if (browserId) bookmark.browserId = browserId;
  return bookmark;
}

function normalizeBookmarkEntry(raw) {
  const categoryIds = Array.isArray(raw?.categoryIds)
    ? raw.categoryIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const bookmark = {
    id: String(raw?.id || "").trim() || crypto.randomUUID().slice(0, 8),
    title: String(raw?.title || raw?.name || "").trim(),
    url: String(raw?.url || "").trim(),
    description: String(raw?.description || "").trim(),
    image: String(raw?.image || legacyServiceToImage(raw) || "").trim(),
    categoryIds,
    favorite: Boolean(raw?.favorite),
    source: normalizeBookmarkSource(raw?.source)
  };
  if (raw?.openMode) bookmark.openMode = raw.openMode;
  if (raw?.shortcut) bookmark.shortcut = raw.shortcut;
  const browserId = String(raw?.browserId || "").trim();
  if (browserId) bookmark.browserId = browserId;
  return bookmark;
}

function normalizeCategoryEntry(raw) {
  const { services: _services, ...rest } = raw && typeof raw === "object" ? raw : {};
  return {
    ...rest,
    id: String(rest.id || "").trim(),
    type: normalizeCategoryType(rest.type),
    iframeUrl: normalizeIframeUrl(rest.iframeUrl),
    slots: normalizeCategorySlots(rest.slots)
  };
}

function migrateLegacyConfig(config) {
  const categories = [];
  const bookmarks = [];
  const bookmarkById = new Map();
  const categoryBookmarkOrder = {};

  for (const rawCategory of Array.isArray(config?.categories) ? config.categories : []) {
    if (!rawCategory || typeof rawCategory !== "object") continue;
    const category = normalizeCategoryEntry(rawCategory);
    const categoryId = category.id;
    categories.push(category);

    if (normalizeCategoryType(category.type) === "iframe") continue;

    const order = [];
    for (const rawService of Array.isArray(rawCategory.services) ? rawCategory.services : []) {
      if (!rawService || typeof rawService !== "object") continue;
      const serviceId = String(rawService.id || "").trim();
      if (!serviceId) continue;

      if (bookmarkById.has(serviceId)) {
        const existing = bookmarkById.get(serviceId);
        if (categoryId && !existing.categoryIds.includes(categoryId)) {
          existing.categoryIds.push(categoryId);
        }
      } else {
        const bookmark = legacyServiceToBookmark(rawService, categoryId);
        bookmarkById.set(serviceId, bookmark);
        bookmarks.push(bookmark);
      }
      order.push(serviceId);
    }
    if (categoryId) categoryBookmarkOrder[categoryId] = order;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    categories,
    bookmarks,
    categoryBookmarkOrder
  };
}

function normalizeCategoryBookmarkOrder(raw, categories, bookmarks) {
  const validCategoryIds = new Set(categories.map((c) => c.id).filter(Boolean));
  const validBookmarkIds = new Set(bookmarks.map((b) => b.id).filter(Boolean));
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};

  for (const categoryId of validCategoryIds) {
    const listed = Array.isArray(source[categoryId]) ? source[categoryId] : [];
    const seen = new Set();
    const order = [];
    for (const bookmarkId of listed) {
      const id = String(bookmarkId || "").trim();
      if (!id || !validBookmarkIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const bookmark of bookmarks) {
      if (!bookmark.categoryIds.includes(categoryId)) continue;
      if (seen.has(bookmark.id)) continue;
      order.push(bookmark.id);
      seen.add(bookmark.id);
    }
    normalized[categoryId] = order;
  }
  return normalized;
}

/** Lädt und normalisiert Config; migriert Legacy-Format (services in Kategorien) automatisch. */
export function normalizeConfig(config) {
  const input = config && typeof config === "object" ? config : { categories: [] };
  const hasBookmarks = Array.isArray(input.bookmarks);
  const schemaVersion = Number(input.schemaVersion) || 1;

  let base;
  if (hasBookmarks && schemaVersion >= SCHEMA_VERSION) {
    const categories = (Array.isArray(input.categories) ? input.categories : []).map(normalizeCategoryEntry);
    const bookmarks = (Array.isArray(input.bookmarks) ? input.bookmarks : []).map(normalizeBookmarkEntry);
    base = {
      schemaVersion: SCHEMA_VERSION,
      categories,
      bookmarks,
      categoryBookmarkOrder: normalizeCategoryBookmarkOrder(input.categoryBookmarkOrder, categories, bookmarks)
    };
  } else {
    base = migrateLegacyConfig(input);
    base.bookmarks = base.bookmarks.map(normalizeBookmarkEntry);
    base.categories = base.categories.map(normalizeCategoryEntry);
    base.categoryBookmarkOrder = normalizeCategoryBookmarkOrder(
      base.categoryBookmarkOrder,
      base.categories,
      base.bookmarks
    );
  }

  return base;
}

export function getCategoryBookmarkOrder(config, categoryId) {
  const order = config.categoryBookmarkOrder?.[categoryId];
  return Array.isArray(order) ? [...order] : [];
}

export function getBookmarksForCategory(config, categoryId) {
  const bookmarkById = new Map((config.bookmarks || []).map((b) => [b.id, b]));
  const order = getCategoryBookmarkOrder(config, categoryId);
  const result = [];
  const seen = new Set();
  for (const id of order) {
    const bookmark = bookmarkById.get(id);
    if (!bookmark || !bookmark.categoryIds.includes(categoryId)) continue;
    result.push(bookmark);
    seen.add(id);
  }
  for (const bookmark of config.bookmarks || []) {
    if (!bookmark.categoryIds.includes(categoryId) || seen.has(bookmark.id)) continue;
    result.push(bookmark);
  }
  return result;
}

export function findBookmarkById(config, bookmarkId) {
  return (config.bookmarks || []).find((b) => b.id === bookmarkId) || null;
}

export function ensureBookmarkInCategoryOrder(config, categoryId, bookmarkId) {
  if (!categoryId || !bookmarkId) return;
  if (!config.categoryBookmarkOrder) config.categoryBookmarkOrder = {};
  const order = getCategoryBookmarkOrder(config, categoryId);
  if (!order.includes(bookmarkId)) {
    config.categoryBookmarkOrder[categoryId] = [...order, bookmarkId];
  }
}

export function removeBookmarkFromCategoryOrder(config, categoryId, bookmarkId) {
  if (!config.categoryBookmarkOrder?.[categoryId]) return;
  config.categoryBookmarkOrder[categoryId] = config.categoryBookmarkOrder[categoryId].filter((id) => id !== bookmarkId);
}

export function removeCategoryFromConfig(config, categoryId) {
  config.categories = (config.categories || []).filter((c) => c.id !== categoryId);
  delete config.categoryBookmarkOrder?.[categoryId];
  for (const bookmark of config.bookmarks || []) {
    bookmark.categoryIds = bookmark.categoryIds.filter((id) => id !== categoryId);
  }
}

export function removeBookmarkFromConfig(config, bookmarkId) {
  config.bookmarks = (config.bookmarks || []).filter((b) => b.id !== bookmarkId);
  for (const categoryId of Object.keys(config.categoryBookmarkOrder || {})) {
    removeBookmarkFromCategoryOrder(config, categoryId, bookmarkId);
  }
}

export function listBookmarkListCategories(config) {
  return (config.categories || []).filter((c) => normalizeCategoryType(c.type) !== "iframe");
}
