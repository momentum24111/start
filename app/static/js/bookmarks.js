/** Einheitliches Lesezeichen-Datenmodell (schemaVersion 2). */

export const SCHEMA_VERSION = 2;
export const UNSORTED_CATEGORY_ID = "unsorted";
export const FAVORITES_CATEGORY_ID = "favorites";
export const QUICK_ACCESS_CATEGORY_ID = "quick_access";
export const CATEGORY_ROLE_QUICK_ACCESS = "quick_access";
export const UNSECTIONED_SECTION_ID = "__unsectioned__";
export const HOMEPAGE_SECTIONS_CATEGORY_ID = "all";

const RESERVED_SIDEBAR_SLUGS = new Set(["start", "favoriten", "unsortiert", "schnellzugriff", "kategorie"]);

export function slugifySidebarCategoryName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "kategorie";
}

function prepareSidebarSlugCandidate(baseSlug) {
  let slug = String(baseSlug || "").trim().toLowerCase() || "kategorie";
  if (RESERVED_SIDEBAR_SLUGS.has(slug)) slug = `${slug}-2`;
  return slug;
}

function ensureUniqueSidebarSlugValue(baseSlug, usedSlugs) {
  const root = prepareSidebarSlugCandidate(baseSlug);
  if (!usedSlugs.has(root)) return root;
  let counter = 2;
  while (usedSlugs.has(`${root}-${counter}`)) counter += 1;
  return `${root}-${counter}`;
}

export function allocateSidebarCategorySlug(config, name, excludeCategoryId = "") {
  const usedSlugs = new Set(
    listSidebarCategories(config)
      .filter((category) => category.id !== excludeCategoryId)
      .map((category) => category.slug)
      .filter(Boolean)
  );
  return ensureUniqueSidebarSlugValue(slugifySidebarCategoryName(name), usedSlugs);
}

function finalizeSidebarCategorySlugs(categories) {
  const usedSlugs = new Set();
  return categories.map((category) => {
    const baseSlug = category.slug || slugifySidebarCategoryName(category.name);
    const slug = ensureUniqueSidebarSlugValue(baseSlug, usedSlugs);
    usedSlugs.add(slug);
    return { ...category, slug };
  });
}

export const BOOKMARK_SOURCE_OPTIONS = ["manual", "browser-import"];
export const DEFAULT_BOOKMARK_SOURCE = "manual";

export const BOOKMARK_IMAGE_SOURCE_OPTIONS = [
  "og_image",
  "twitter_image",
  "apple_touch_icon",
  "png_favicon",
  "favicon"
];

export function normalizeBookmarkImageSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return BOOKMARK_IMAGE_SOURCE_OPTIONS.includes(normalized) ? normalized : "";
}

const CATEGORY_TYPE_OPTIONS = ["service-list", "iframe"];
const DEFAULT_CATEGORY_TYPE = "service-list";
const CATEGORY_SLOT_OPTIONS = [1, 2, 3];
const DEFAULT_CATEGORY_SLOTS = 1;

export function normalizeCreatedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return "";
  return raw;
}

export function bookmarkTimestampNow() {
  const date = new Date();
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

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
    ? raw.categoryIds
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== UNSORTED_CATEGORY_ID)
    : [];
  const sidebarCategoryIds = Array.isArray(raw?.sidebarCategoryIds)
    ? raw.sidebarCategoryIds
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== UNSORTED_CATEGORY_ID)
    : [];
  const bookmark = {
    id: String(raw?.id || "").trim() || crypto.randomUUID().slice(0, 8),
    title: String(raw?.title || raw?.name || "").trim(),
    url: String(raw?.url || "").trim(),
    description: String(raw?.description || "").trim(),
    image: String(raw?.image || legacyServiceToImage(raw) || "").trim(),
    domain: String(raw?.domain || "").trim(),
    imageSource: normalizeBookmarkImageSource(raw?.imageSource),
    categoryIds,
    sidebarCategoryIds,
    favorite: Boolean(raw?.favorite),
    source: normalizeBookmarkSource(raw?.source),
    navSectionAssignments: raw?.navSectionAssignments && typeof raw.navSectionAssignments === "object"
      ? Object.fromEntries(
        Object.entries(raw.navSectionAssignments)
          .map(([navId, sectionId]) => [String(navId || "").trim(), String(sectionId || "").trim()])
          .filter(([navId, sectionId]) => navId && sectionId)
      )
      : {}
  };
  if (raw?.openMode) bookmark.openMode = raw.openMode;
  if (raw?.shortcut) bookmark.shortcut = raw.shortcut;
  const browserId = String(raw?.browserId || "").trim();
  if (browserId) bookmark.browserId = browserId;
  const browserFolderPath = String(raw?.browserFolderPath || "").trim();
  if (browserFolderPath) bookmark.browserFolderPath = browserFolderPath;
  const createdAt = normalizeCreatedAt(raw?.createdAt);
  if (createdAt) bookmark.createdAt = createdAt;
  return bookmark;
}

export function isQuickAccessCategory(category) {
  if (!category || typeof category !== "object") return false;
  const id = String(category.id || "").trim();
  const role = String(category.role || "").trim();
  return id === QUICK_ACCESS_CATEGORY_ID || role === CATEGORY_ROLE_QUICK_ACCESS;
}

function buildQuickAccessCategoryEntry(raw = {}) {
  return {
    id: QUICK_ACCESS_CATEGORY_ID,
    role: CATEGORY_ROLE_QUICK_ACCESS,
    name: String(raw.name || "Quick access").trim() || "Quick access",
    icon: String(raw.icon || "flash").trim() || "flash",
    color: String(raw.color || "primary").trim() || "primary",
    collapsed: false,
    type: "service-list",
    iframeUrl: "",
    slots: 1
  };
}

export function ensureQuickAccessCategory(config) {
  if (!config || typeof config !== "object") return null;
  if (!Array.isArray(config.categories)) config.categories = [];
  const existingIndex = config.categories.findIndex(isQuickAccessCategory);
  if (existingIndex >= 0) {
    const normalized = buildQuickAccessCategoryEntry(config.categories[existingIndex]);
    config.categories[existingIndex] = normalized;
    return normalized;
  }
  const created = buildQuickAccessCategoryEntry();
  config.categories = [created, ...config.categories];
  if (!config.categoryBookmarkOrder || typeof config.categoryBookmarkOrder !== "object") {
    config.categoryBookmarkOrder = {};
  }
  if (!Array.isArray(config.categoryBookmarkOrder[QUICK_ACCESS_CATEGORY_ID])) {
    config.categoryBookmarkOrder[QUICK_ACCESS_CATEGORY_ID] = [];
  }
  return created;
}

function normalizeCategoryEntry(raw) {
  const { services: _services, ...rest } = raw && typeof raw === "object" ? raw : {};
  const id = String(rest.id || "").trim();
  const role = String(rest.role || "").trim();
  if (id === QUICK_ACCESS_CATEGORY_ID || role === CATEGORY_ROLE_QUICK_ACCESS) {
    return buildQuickAccessCategoryEntry(rest);
  }
  const entry = {
    ...rest,
    id,
    type: normalizeCategoryType(rest.type),
    iframeUrl: normalizeIframeUrl(rest.iframeUrl),
    slots: normalizeCategorySlots(rest.slots)
  };
  if (role) entry.role = role;
  return entry;
}

function normalizeSidebarCategoryEntry(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(entry.id || "").trim(),
    name: String(entry.name || "").trim(),
    icon: String(entry.icon || "folder").trim() || "folder",
    slug: String(entry.slug || "").trim().toLowerCase()
  };
}

function normalizeSidebarCategoryBookmarkOrder(raw, sidebarCategories, bookmarks) {
  const validCategoryIds = new Set(
    sidebarCategories.map((category) => category.id).filter((id) => id && id !== UNSORTED_CATEGORY_ID)
  );
  const validBookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id).filter(Boolean));
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
      const sidebarCategoryIds = bookmark.sidebarCategoryIds || [];
      if (!sidebarCategoryIds.includes(categoryId) || seen.has(bookmark.id)) continue;
      order.push(bookmark.id);
      seen.add(bookmark.id);
    }
    normalized[categoryId] = order;
  }
  return normalized;
}

function normalizeBookmarkSectionAssignments(rawAssignments, validNavIds, navSectionsByNavId) {
  const source = rawAssignments && typeof rawAssignments === "object" ? rawAssignments : {};
  const normalized = {};
  for (const navId of validNavIds) {
    const sectionId = String(source[navId] || "").trim();
    if (!sectionId) continue;
    const sections = navSectionsByNavId[navId] || [];
    if (sections.some((section) => section.id === sectionId)) {
      normalized[navId] = sectionId;
    }
  }
  return normalized;
}

function normalizeNavSectionEntry(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(entry.id || "").trim(),
    name: String(entry.name || "").trim(),
    icon: String(entry.icon || "folder").trim() || "folder",
    color: String(entry.color || "primary").trim() || "primary",
    collapsed: Boolean(entry.collapsed),
    type: normalizeCategoryType(entry.type || "service-list"),
    iframeUrl: normalizeIframeUrl(entry.iframeUrl),
    slots: 1
  };
}

function normalizeNavSections(raw, validNavIds) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const navId of validNavIds) {
    const list = Array.isArray(source[navId]) ? source[navId] : [];
    normalized[navId] = list
      .map(normalizeNavSectionEntry)
      .filter((section) => section.id);
  }
  return normalized;
}

function normalizeNavSectionOrder(raw, validNavIds, navSectionsByNavId) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const navId of validNavIds) {
    const listed = Array.isArray(source[navId]) ? source[navId] : [];
    const validIds = new Set((navSectionsByNavId[navId] || []).map((section) => section.id));
    const seen = new Set();
    const order = [];
    for (const rawId of listed) {
      const id = String(rawId || "").trim();
      if (!id || (!validIds.has(id) && id !== UNSECTIONED_SECTION_ID) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const sectionId of validIds) {
      if (seen.has(sectionId)) continue;
      seen.add(sectionId);
      order.push(sectionId);
    }
    if (!seen.has(UNSECTIONED_SECTION_ID)) {
      order.push(UNSECTIONED_SECTION_ID);
    }
    normalized[navId] = order;
  }
  return normalized;
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

function mergeBookmarkLists(existing, legacy) {
  const byId = new Map();
  for (const bookmark of existing) {
    if (bookmark?.id) byId.set(bookmark.id, bookmark);
  }
  for (const bookmark of legacy) {
    if (!bookmark?.id) continue;
    const current = byId.get(bookmark.id);
    if (!current) {
      byId.set(bookmark.id, bookmark);
      continue;
    }
    for (const categoryId of bookmark.categoryIds || []) {
      if (!current.categoryIds.includes(categoryId)) {
        current.categoryIds.push(categoryId);
      }
    }
    if (!String(current.title || "").trim() && bookmark.title) current.title = bookmark.title;
    if (!String(current.url || "").trim() && bookmark.url) current.url = bookmark.url;
    if (!String(current.image || "").trim() && bookmark.image) current.image = bookmark.image;
  }
  return [...byId.values()];
}

/** Lädt und normalisiert Config; migriert Legacy-Format (services in Kategorien) automatisch. */
export function normalizeConfig(config) {
  const input = config && typeof config === "object" ? config : { categories: [] };
  let categories = (Array.isArray(input.categories) ? input.categories : [])
    .map(normalizeCategoryEntry)
    .filter((category) => category.id && category.id !== UNSORTED_CATEGORY_ID);
  // Genau eine Schnellzugriff-Kategorie behalten (stabile Systemrolle).
  const quickAccessEntries = categories.filter(isQuickAccessCategory);
  categories = categories.filter((category) => !isQuickAccessCategory(category));
  if (quickAccessEntries.length) {
    categories = [buildQuickAccessCategoryEntry(quickAccessEntries[0]), ...categories];
  }
  const sidebarCategories = finalizeSidebarCategorySlugs(
    (Array.isArray(input.sidebarCategories) ? input.sidebarCategories : [])
      .map(normalizeSidebarCategoryEntry)
      .filter((category) => category.id && category.id !== UNSORTED_CATEGORY_ID && category.id !== QUICK_ACCESS_CATEGORY_ID)
  );
  const existingBookmarks = Array.isArray(input.bookmarks)
    ? input.bookmarks.map(normalizeBookmarkEntry)
    : [];
  const legacyMigrated = migrateLegacyConfig(input);
  const bookmarks = mergeBookmarkLists(existingBookmarks, legacyMigrated.bookmarks.map(normalizeBookmarkEntry));

  const orderSource = { ...(input.categoryBookmarkOrder || {}) };
  for (const [categoryId, order] of Object.entries(legacyMigrated.categoryBookmarkOrder || {})) {
    if (!Array.isArray(orderSource[categoryId]) || !orderSource[categoryId].length) {
      orderSource[categoryId] = order;
    }
  }
  delete orderSource[UNSORTED_CATEGORY_ID];

  const sidebarOrderSource = { ...(input.sidebarCategoryBookmarkOrder || {}) };
  delete sidebarOrderSource[UNSORTED_CATEGORY_ID];
  delete sidebarOrderSource[QUICK_ACCESS_CATEGORY_ID];
  const sidebarNavIds = sidebarCategories.map((category) => category.id).filter(Boolean);
  const navSections = normalizeNavSections(input.navSections, sidebarNavIds);
  const navSectionOrder = normalizeNavSectionOrder(input.navSectionOrder, sidebarNavIds, navSections);
  for (const bookmark of bookmarks) {
    bookmark.navSectionAssignments = normalizeBookmarkSectionAssignments(
      bookmark.navSectionAssignments,
      sidebarNavIds,
      navSections
    );
  }

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    categories,
    sidebarCategories,
    bookmarks,
    categoryBookmarkOrder: {},
    sidebarCategoryBookmarkOrder: {},
    navSections,
    navSectionOrder
  };
  ensureQuickAccessCategory(normalized);
  for (const bookmark of normalized.bookmarks) {
    normalizeBookmarkCategoryAssignments(normalized, bookmark);
  }
  normalized.categoryBookmarkOrder = normalizeCategoryBookmarkOrder(
    orderSource,
    normalized.categories,
    normalized.bookmarks
  );
  normalized.sidebarCategoryBookmarkOrder = normalizeSidebarCategoryBookmarkOrder(
    sidebarOrderSource,
    normalized.sidebarCategories,
    normalized.bookmarks
  );
  return normalized;
}

export function getCategoryBookmarkOrder(config, categoryId) {
  const order = config.categoryBookmarkOrder?.[categoryId];
  return Array.isArray(order) ? [...order] : [];
}

export function getBookmarkHomepageCategoryId(config, bookmark) {
  if (!bookmark) return "";
  const listCategoryIds = new Set(listBookmarkListCategories(config).map((category) => category.id));
  return (bookmark.categoryIds || []).find((id) => listCategoryIds.has(id)) || "";
}

export function getBookmarkSidebarPlacementIds(bookmark) {
  if (!bookmark) return [];
  const ids = (bookmark.sidebarCategoryIds || []).filter(
    (id) => id && id !== UNSORTED_CATEGORY_ID && id !== QUICK_ACCESS_CATEGORY_ID
  );
  if (bookmark.favorite && !ids.includes(FAVORITES_CATEGORY_ID)) {
    return [...ids, FAVORITES_CATEGORY_ID];
  }
  return ids;
}

export function isBookmarkInFavorites(bookmark) {
  return getBookmarkSidebarPlacementIds(bookmark).includes(FAVORITES_CATEGORY_ID);
}

export function isBookmarkInQuickAccess(bookmark) {
  return Boolean(bookmark && (bookmark.categoryIds || []).includes(QUICK_ACCESS_CATEGORY_ID));
}

export function bookmarkHasNonUnsortedPlacement(bookmark, config) {
  if (!bookmark) return false;
  if (getBookmarkHomepageCategoryId(config, bookmark)) return true;
  if (isBookmarkInQuickAccess(bookmark)) return true;
  if (isBookmarkInFavorites(bookmark)) return true;
  const customSidebarIds = new Set(listCustomSidebarCategoryIds(config));
  return (bookmark.sidebarCategoryIds || []).some((id) => customSidebarIds.has(id));
}

/**
 * Zentrale Unsortiert-Regel: entweder ausschließlich Unsortiert (keine andere Zuordnung)
 * oder mindestens eine andere Kategorie und nicht Unsortiert.
 * Unsortiert wird nie persistiert; es ist der abgeleitete Zustand ohne Platzierung.
 */
export function normalizeBookmarkCategoryAssignments(config, bookmark) {
  if (!bookmark) return bookmark;
  bookmark.categoryIds = (bookmark.categoryIds || [])
    .map((id) => String(id || "").trim())
    .filter((id) => id && id !== UNSORTED_CATEGORY_ID);
  bookmark.sidebarCategoryIds = (bookmark.sidebarCategoryIds || [])
    .map((id) => String(id || "").trim())
    .filter((id) => id && id !== UNSORTED_CATEGORY_ID && id !== QUICK_ACCESS_CATEGORY_ID);

  const hasQuickAccess = bookmark.categoryIds.includes(QUICK_ACCESS_CATEGORY_ID);
  const listCategoryIds = new Set(listBookmarkListCategories(config).map((category) => category.id));
  const homepageIds = bookmark.categoryIds.filter((id) => listCategoryIds.has(id));
  const otherCategoryIds = bookmark.categoryIds.filter(
    (id) => id !== QUICK_ACCESS_CATEGORY_ID && !listCategoryIds.has(id)
  );
  bookmark.categoryIds = [
    ...(hasQuickAccess ? [QUICK_ACCESS_CATEGORY_ID] : []),
    ...homepageIds,
    ...otherCategoryIds
  ];

  if (bookmark.favorite && !bookmark.sidebarCategoryIds.includes(FAVORITES_CATEGORY_ID)) {
    bookmark.sidebarCategoryIds.push(FAVORITES_CATEGORY_ID);
  }
  bookmark.favorite = bookmark.sidebarCategoryIds.includes(FAVORITES_CATEGORY_ID);

  // Unsortiert ist exklusiv: sobald eine andere Zuordnung existiert, bleibt Unsortiert abgeleitet aus.
  // Fehlt jede Zuordnung, ist das Lesezeichen Unsortiert — nichts zu speichern.
  return bookmark;
}

export function isUnsortedBookmark(bookmark, config) {
  return !bookmarkHasNonUnsortedPlacement(bookmark, config);
}

export function getBookmarkBrowserFolderPath(bookmark) {
  return String(bookmark?.browserFolderPath || "").trim();
}

export function shouldShowUnsortedBrowserImportPath(bookmark, config) {
  if (normalizeBookmarkSource(bookmark?.source) !== "browser-import") return false;
  return isUnsortedBookmark(bookmark, config);
}

export function formatUnsortedBrowserImportPathLine(bookmark) {
  const domain = getBookmarkDisplayDomain(bookmark);
  const path = getBookmarkBrowserFolderPath(bookmark);
  if (path && domain) return { text: `${path} / ${domain}`, style: "path" };
  if (path) return { text: path, style: "path" };
  if (domain) return { text: domain, style: "domain" };
  return null;
}

export function shouldShowBrowserFolderPath(bookmark, config) {
  if (normalizeBookmarkSource(bookmark?.source) !== "browser-import") return false;
  if (!isUnsortedBookmark(bookmark, config)) return false;
  return Boolean(getBookmarkBrowserFolderPath(bookmark));
}

export function collectUnsortedBrowserFolderPaths(bookmarks, config) {
  const paths = new Set();
  for (const bookmark of bookmarks || []) {
    if (normalizeBookmarkSource(bookmark?.source) !== "browser-import") continue;
    if (!isUnsortedBookmark(bookmark, config)) continue;
    const path = getBookmarkBrowserFolderPath(bookmark);
    if (path) paths.add(path);
  }
  return [...paths].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function filterBookmarksByBrowserFolderPaths(bookmarks, selectedPaths) {
  if (!(selectedPaths instanceof Set) || selectedPaths.size === 0) return bookmarks;
  return (bookmarks || []).filter((bookmark) => {
    const path = getBookmarkBrowserFolderPath(bookmark);
    return path && selectedPaths.has(path);
  });
}

export function getBookmarksOnHomepage(config) {
  const seen = new Set();
  const result = [];
  for (const category of listBookmarkListCategories(config)) {
    for (const bookmark of getBookmarksForCategory(config, category.id)) {
      if (seen.has(bookmark.id)) continue;
      seen.add(bookmark.id);
      result.push(bookmark);
    }
  }
  return result;
}

export function getBookmarksForCategory(config, categoryId, { prioritizeFavorites = true } = {}) {
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
  if (categoryId === QUICK_ACCESS_CATEGORY_ID || !prioritizeFavorites) return result;
  return prioritizeFavoriteBookmarks(result);
}

export function getBookmarksForQuickAccess(config) {
  ensureQuickAccessCategory(config);
  return getBookmarksForCategory(config, QUICK_ACCESS_CATEGORY_ID, { prioritizeFavorites: false });
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
  if (categoryId === QUICK_ACCESS_CATEGORY_ID || categoryId === UNSORTED_CATEGORY_ID) return;
  config.categories = (config.categories || []).filter((c) => c.id !== categoryId);
  delete config.categoryBookmarkOrder?.[categoryId];
  for (const bookmark of config.bookmarks || []) {
    bookmark.categoryIds = bookmark.categoryIds.filter((id) => id !== categoryId);
    normalizeBookmarkCategoryAssignments(config, bookmark);
  }
}

export function removeBookmarkFromConfig(config, bookmarkId) {
  config.bookmarks = (config.bookmarks || []).filter((b) => b.id !== bookmarkId);
  for (const categoryId of Object.keys(config.categoryBookmarkOrder || {})) {
    removeBookmarkFromCategoryOrder(config, categoryId, bookmarkId);
  }
  for (const categoryId of Object.keys(config.sidebarCategoryBookmarkOrder || {})) {
    removeBookmarkFromSidebarCategoryOrder(config, categoryId, bookmarkId);
  }
}

export function getHomepageCategories(config) {
  return (config.categories || []).filter(
    (category) => category.id !== UNSORTED_CATEGORY_ID && !isQuickAccessCategory(category)
  );
}

export function listBookmarkListCategories(config) {
  return getHomepageCategories(config).filter((category) => normalizeCategoryType(category.type) !== "iframe");
}

export function listSidebarCategories(config) {
  return (config.sidebarCategories || []).filter((category) => category.id !== UNSORTED_CATEGORY_ID);
}

export function findSidebarCategoryById(config, categoryId) {
  return listSidebarCategories(config).find((category) => category.id === categoryId) || null;
}

export function formatBookmarkDomain(url) {
  try {
    const hostname = new URL(String(url || "").trim()).hostname || "";
    return hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function getBookmarkDisplayDomain(bookmark) {
  const stored = String(bookmark?.domain || "").trim();
  if (stored) return stored;
  return formatBookmarkDomain(bookmark?.url);
}

export function getBookmarkDisplayCategoryLabels(config, bookmark, labelForFavorites, labelForQuickAccess) {
  const labels = [];
  const homepageCategoryId = getBookmarkHomepageCategoryId(config, bookmark);
  if (homepageCategoryId) {
    const homepageCategory = listBookmarkListCategories(config).find((entry) => entry.id === homepageCategoryId);
    if (homepageCategory?.name) labels.push(homepageCategory.name);
  }
  if (isBookmarkInQuickAccess(bookmark) && labelForQuickAccess) {
    labels.push(labelForQuickAccess);
  }
  if (isBookmarkInFavorites(bookmark) && labelForFavorites) {
    labels.push(labelForFavorites);
  }
  for (const categoryId of bookmark?.sidebarCategoryIds || []) {
    if (categoryId === FAVORITES_CATEGORY_ID || categoryId === UNSORTED_CATEGORY_ID) continue;
    const sidebarCategory = findSidebarCategoryById(config, categoryId);
    if (sidebarCategory?.name) labels.push(sidebarCategory.name);
  }
  return labels;
}

export function findSidebarCategoryBySlug(config, slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return null;
  return listSidebarCategories(config).find((category) => category.slug === normalized) || null;
}

export function getSidebarCategoryBookmarkOrder(config, categoryId) {
  const order = config.sidebarCategoryBookmarkOrder?.[categoryId];
  return Array.isArray(order) ? [...order] : [];
}

export function getBookmarksForSidebarCategory(config, categoryId) {
  const bookmarkById = new Map((config.bookmarks || []).map((bookmark) => [bookmark.id, bookmark]));
  const order = getSidebarCategoryBookmarkOrder(config, categoryId);
  const result = [];
  const seen = new Set();
  for (const id of order) {
    const bookmark = bookmarkById.get(id);
    if (!bookmark || !(bookmark.sidebarCategoryIds || []).includes(categoryId)) continue;
    result.push(bookmark);
    seen.add(id);
  }
  for (const bookmark of config.bookmarks || []) {
    if (!(bookmark.sidebarCategoryIds || []).includes(categoryId) || seen.has(bookmark.id)) continue;
    result.push(bookmark);
  }
  return prioritizeFavoriteBookmarks(result);
}

export function ensureBookmarkInSidebarCategoryOrder(config, categoryId, bookmarkId) {
  if (!categoryId || !bookmarkId) return;
  if (!config.sidebarCategoryBookmarkOrder) config.sidebarCategoryBookmarkOrder = {};
  const order = getSidebarCategoryBookmarkOrder(config, categoryId);
  if (!order.includes(bookmarkId)) {
    config.sidebarCategoryBookmarkOrder[categoryId] = [...order, bookmarkId];
  }
}

export function removeBookmarkFromSidebarCategoryOrder(config, categoryId, bookmarkId) {
  if (!config.sidebarCategoryBookmarkOrder?.[categoryId]) return;
  config.sidebarCategoryBookmarkOrder[categoryId] = config.sidebarCategoryBookmarkOrder[categoryId].filter(
    (id) => id !== bookmarkId
  );
}

export function listCustomSidebarCategoryIds(config) {
  return listSidebarCategories(config).map((category) => category.id);
}

export function clearCustomSidebarCategoriesFromBookmark(config, bookmark) {
  const customIds = new Set(listCustomSidebarCategoryIds(config));
  for (const categoryId of customIds) {
    if ((bookmark.sidebarCategoryIds || []).includes(categoryId)) {
      removeBookmarkFromSidebarCategoryOrder(config, categoryId, bookmark.id);
    }
  }
  bookmark.sidebarCategoryIds = (bookmark.sidebarCategoryIds || []).filter((id) => !customIds.has(id));
}

export function assignBookmarkToCustomSidebarCategory(config, bookmark, categoryId) {
  clearCustomSidebarCategoriesFromBookmark(config, bookmark);
  if (!bookmark.sidebarCategoryIds) bookmark.sidebarCategoryIds = [];
  if (!bookmark.sidebarCategoryIds.includes(categoryId)) {
    bookmark.sidebarCategoryIds.push(categoryId);
  }
  ensureBookmarkInSidebarCategoryOrder(config, categoryId, bookmark.id);
}

export function assignBookmarkToNavCategoryTargets(config, bookmark, targetIds) {
  const selected = new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  if (!selected.size || selected.has(UNSORTED_CATEGORY_ID)) {
    assignBookmarkToUnsorted(config, bookmark);
    return;
  }

  if (selected.has(QUICK_ACCESS_CATEGORY_ID)) {
    assignBookmarkToQuickAccess(config, bookmark);
  }

  const customCategoryIds = listCustomSidebarCategoryIds(config).filter((id) => selected.has(id));
  if (customCategoryIds.length) {
    assignBookmarkToCustomSidebarCategory(config, bookmark, customCategoryIds[customCategoryIds.length - 1]);
  }

  if (selected.has(FAVORITES_CATEGORY_ID)) {
    assignBookmarkToFavorites(bookmark);
  }

  normalizeBookmarkCategoryAssignments(config, bookmark);
}

export function assignBookmarkToUnsorted(config, bookmark) {
  if (!bookmark) return;
  const listCategoryIds = new Set(listBookmarkListCategories(config).map((category) => category.id));
  for (const categoryId of [...(bookmark.categoryIds || [])]) {
    removeBookmarkFromCategoryOrder(config, categoryId, bookmark.id);
  }
  clearCustomSidebarCategoriesFromBookmark(config, bookmark);
  removeBookmarkFromFavorites(bookmark);
  bookmark.categoryIds = (bookmark.categoryIds || []).filter(
    (id) => id !== QUICK_ACCESS_CATEGORY_ID && !listCategoryIds.has(id)
  );
  // Alle restlichen Listen- und Systemzuordnungen entfernen → Zustand Unsortiert.
  bookmark.categoryIds = [];
  bookmark.sidebarCategoryIds = [];
  bookmark.favorite = false;
  if (bookmark.navSectionAssignments && typeof bookmark.navSectionAssignments === "object") {
    bookmark.navSectionAssignments = {};
  }
  normalizeBookmarkCategoryAssignments(config, bookmark);
}

export function assignBookmarkToQuickAccess(config, bookmark) {
  if (!bookmark) return;
  ensureQuickAccessCategory(config);
  if (!bookmark.categoryIds) bookmark.categoryIds = [];
  if (!bookmark.categoryIds.includes(QUICK_ACCESS_CATEGORY_ID)) {
    bookmark.categoryIds.push(QUICK_ACCESS_CATEGORY_ID);
  }
  ensureBookmarkInCategoryOrder(config, QUICK_ACCESS_CATEGORY_ID, bookmark.id);
  normalizeBookmarkCategoryAssignments(config, bookmark);
}

export function removeBookmarkFromQuickAccess(config, bookmark) {
  if (!bookmark) return;
  bookmark.categoryIds = (bookmark.categoryIds || []).filter((id) => id !== QUICK_ACCESS_CATEGORY_ID);
  removeBookmarkFromCategoryOrder(config, QUICK_ACCESS_CATEGORY_ID, bookmark.id);
  normalizeBookmarkCategoryAssignments(config, bookmark);
}

export function setBookmarkQuickAccess(config, bookmark, enabled) {
  if (enabled) assignBookmarkToQuickAccess(config, bookmark);
  else removeBookmarkFromQuickAccess(config, bookmark);
}

export function reorderQuickAccessBookmarks(config, orderedBookmarkIds) {
  ensureQuickAccessCategory(config);
  const validIds = new Set(
    getBookmarksForQuickAccess(config).map((bookmark) => bookmark.id).filter(Boolean)
  );
  const seen = new Set();
  const order = [];
  for (const rawId of orderedBookmarkIds || []) {
    const id = String(rawId || "").trim();
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of validIds) {
    if (seen.has(id)) continue;
    order.push(id);
  }
  if (!config.categoryBookmarkOrder) config.categoryBookmarkOrder = {};
  config.categoryBookmarkOrder[QUICK_ACCESS_CATEGORY_ID] = order;
}

export function assignBookmarkToFavorites(bookmark) {
  if (!bookmark.sidebarCategoryIds) bookmark.sidebarCategoryIds = [];
  if (!bookmark.sidebarCategoryIds.includes(FAVORITES_CATEGORY_ID)) {
    bookmark.sidebarCategoryIds.push(FAVORITES_CATEGORY_ID);
  }
  bookmark.favorite = true;
}

export function removeBookmarkFromFavorites(bookmark) {
  if (!bookmark) return;
  bookmark.favorite = false;
  bookmark.sidebarCategoryIds = (bookmark.sidebarCategoryIds || []).filter((id) => id !== FAVORITES_CATEGORY_ID);
}

export function setBookmarkFavorite(bookmark, isFavorite) {
  if (!bookmark) return;
  if (isFavorite) assignBookmarkToFavorites(bookmark);
  else removeBookmarkFromFavorites(bookmark);
}

export function toggleBookmarkFavorite(bookmark) {
  if (!bookmark) return false;
  const nextFavorite = !isBookmarkInFavorites(bookmark);
  setBookmarkFavorite(bookmark, nextFavorite);
  return nextFavorite;
}

export function prioritizeFavoriteBookmarks(bookmarks) {
  const favorites = [];
  const rest = [];
  for (const bookmark of bookmarks || []) {
    if (isBookmarkInFavorites(bookmark)) favorites.push(bookmark);
    else rest.push(bookmark);
  }
  return [...favorites, ...rest];
}

export function assignBookmarkToHomepageCategory(config, bookmark, categoryId) {
  const listCategoryIds = new Set(listBookmarkListCategories(config).map((category) => category.id));
  if (!listCategoryIds.has(categoryId)) return;
  if (!bookmark.categoryIds) bookmark.categoryIds = [];
  // Eine Startseiten-Abschnittszuordnung; Schnellzugriff bleibt erhalten.
  bookmark.categoryIds = bookmark.categoryIds.filter(
    (id) => id === QUICK_ACCESS_CATEGORY_ID || !listCategoryIds.has(id)
  );
  if (!bookmark.categoryIds.includes(categoryId)) {
    bookmark.categoryIds.push(categoryId);
  }
  ensureBookmarkInCategoryOrder(config, categoryId, bookmark.id);
  normalizeBookmarkCategoryAssignments(config, bookmark);
}

export function removeSidebarCategoryFromConfig(config, categoryId) {
  config.sidebarCategories = (config.sidebarCategories || []).filter((category) => category.id !== categoryId);
  delete config.sidebarCategoryBookmarkOrder?.[categoryId];
  delete config.navSections?.[categoryId];
  delete config.navSectionOrder?.[categoryId];
  for (const bookmark of config.bookmarks || []) {
    bookmark.sidebarCategoryIds = (bookmark.sidebarCategoryIds || []).filter((id) => id !== categoryId);
    if (bookmark.navSectionAssignments && typeof bookmark.navSectionAssignments === "object") {
      delete bookmark.navSectionAssignments[categoryId];
    }
  }
}

export function deleteSidebarCategoryFromConfig(config, categoryId, { deleteBookmarks = false } = {}) {
  if (deleteBookmarks) {
    const bookmarks = getBookmarksForSidebarCategory(config, categoryId);
    for (const bookmark of bookmarks) {
      removeBookmarkFromConfig(config, bookmark.id);
    }
  }
  removeSidebarCategoryFromConfig(config, categoryId);
}

export function getNavSections(config, navId) {
  return [...(config?.navSections?.[navId] || [])];
}

export function setNavSections(config, navId, sections) {
  if (!config.navSections) config.navSections = {};
  config.navSections[navId] = [...(sections || [])];
}

export function getNavSectionOrder(config, navId) {
  const list = Array.isArray(config?.navSectionOrder?.[navId]) ? config.navSectionOrder[navId] : [];
  const sections = getNavSections(config, navId);
  const validIds = new Set(sections.map((section) => section.id));
  const seen = new Set();
  const order = [];
  for (const rawId of list) {
    const id = String(rawId || "").trim();
    if (!id || (!validIds.has(id) && id !== UNSECTIONED_SECTION_ID) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    order.push(section.id);
  }
  if (!seen.has(UNSECTIONED_SECTION_ID)) order.push(UNSECTIONED_SECTION_ID);
  return order;
}

export function setNavSectionOrder(config, navId, order) {
  if (!config.navSectionOrder) config.navSectionOrder = {};
  config.navSectionOrder[navId] = [...(order || [])];
}

export function getBookmarkSectionIdForNav(bookmark, navId) {
  return String(bookmark?.navSectionAssignments?.[navId] || "").trim();
}

export function setBookmarkSectionIdForNav(bookmark, navId, sectionId) {
  if (!bookmark.navSectionAssignments || typeof bookmark.navSectionAssignments !== "object") {
    bookmark.navSectionAssignments = {};
  }
  const normalized = String(sectionId || "").trim();
  if (normalized) bookmark.navSectionAssignments[navId] = normalized;
  else delete bookmark.navSectionAssignments[navId];
}

function generateSectionId() {
  return crypto.randomUUID().slice(0, 8);
}

export function findSectionIdByNameForCategory(config, categoryId, rawName) {
  const name = String(rawName || "").trim();
  if (!name) return "";
  const normalizedName = name.toLowerCase();
  if (categoryId === HOMEPAGE_SECTIONS_CATEGORY_ID) {
    const existing = listBookmarkListCategories(config).find(
      (section) => String(section.name || "").trim().toLowerCase() === normalizedName
    );
    return existing?.id || "";
  }
  const existing = getNavSections(config, categoryId).find(
    (section) => String(section.name || "").trim().toLowerCase() === normalizedName
  );
  return existing?.id || "";
}

function buildSectionEntry(sectionData = {}) {
  const type = normalizeCategoryType(sectionData.type || "service-list");
  return {
    id: String(sectionData.id || "").trim() || generateSectionId(),
    name: String(sectionData.name || "").trim(),
    icon: String(sectionData.icon || "folder").trim() || "folder",
    color: String(sectionData.color || "primary").trim() || "primary",
    collapsed: Boolean(sectionData.collapsed),
    type,
    iframeUrl: type === "iframe" ? normalizeIframeUrl(sectionData.iframeUrl) : "",
    slots: normalizeCategorySlots(sectionData.slots ?? 1)
  };
}

/**
 * Legt einen Abschnitt in genau einer Kategorie an oder wählt einen bestehenden gleichnamigen Abschnitt.
 * Für die Startseite categoryId = HOMEPAGE_SECTIONS_CATEGORY_ID ("all"), sonst Sidebar-Kategorie-ID.
 */
export function createSectionForCategory(config, categoryId, sectionData = {}) {
  const name = String(sectionData.name || "").trim();
  if (!name) return { sectionId: "", created: false, changed: false, section: null };

  const existingId = findSectionIdByNameForCategory(config, categoryId, name);
  if (existingId) {
    const section = categoryId === HOMEPAGE_SECTIONS_CATEGORY_ID
      ? listBookmarkListCategories(config).find((entry) => entry.id === existingId) || null
      : getNavSections(config, categoryId).find((entry) => entry.id === existingId) || null;
    return { sectionId: existingId, created: false, changed: false, section };
  }

  if (categoryId === HOMEPAGE_SECTIONS_CATEGORY_ID) {
    const created = buildSectionEntry(sectionData);
    created.name = name;
    const homepageCategories = getHomepageCategories(config);
    const quickAccess = (config.categories || []).filter(isQuickAccessCategory);
    config.categories = [...quickAccess, ...homepageCategories, created];
    config.categoryBookmarkOrder = config.categoryBookmarkOrder || {};
    config.categoryBookmarkOrder[created.id] = [];
    return { sectionId: created.id, created: true, changed: true, section: created };
  }

  const created = buildSectionEntry({ ...sectionData, slots: 1 });
  created.name = name;
  const sections = getNavSections(config, categoryId);
  sections.push(created);
  setNavSections(config, categoryId, sections);
  const order = getNavSectionOrder(config, categoryId).filter((entry) => entry !== UNSECTIONED_SECTION_ID);
  order.push(created.id, UNSECTIONED_SECTION_ID);
  setNavSectionOrder(config, categoryId, order);
  return { sectionId: created.id, created: true, changed: true, section: created };
}
