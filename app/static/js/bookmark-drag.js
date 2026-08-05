/** Drag and Drop: Lesezeichen in Sidebar-Kategorien verschieben und Schnellzugriff sortieren. */

import { escapeHtml } from "./bookmark-views.js";
import {
  assignBookmarkToCustomSidebarCategory,
  assignBookmarkToFavorites,
  assignBookmarkToHomepageCategory,
  assignBookmarkToUnsorted,
  findBookmarkById,
  getBookmarkDisplayDomain,
  QUICK_ACCESS_CATEGORY_ID,
  reorderQuickAccessBookmarks,
  setBookmarkSectionIdForNav
} from "./bookmarks.js";
import { NAV_ALL, NAV_FAVORITES, NAV_UNSORTED } from "./navigation.js";

const DRAG_MIME = "application/x-start-bookmark-id";
const DRAG_MIME_MULTI = "application/x-start-bookmark-ids";
const QUICK_ACCESS_REORDER_MIME = "application/x-start-quick-access-reorder";
export const SIDEBAR_ADD_CATEGORY_DROP_ID = "__sidebar-add-category__";
let deps = null;
let activeDropTarget = null;
let activeDragBookmarkIds = [];
let activeDragElement = null;
let dragDropBound = false;
let quickAccessReorderId = "";
let quickAccessInsertIndex = -1;
let quickAccessPointerDrag = null;

function clearDropTarget() {
  if (!(activeDropTarget instanceof HTMLElement)) return;
  activeDropTarget.classList.remove("is-drop-target", "is-drop-target--multi");
  activeDropTarget.querySelector(".sidebar-drop-badge")?.remove();
  if (activeDropTarget.dataset.dropCount) delete activeDropTarget.dataset.dropCount;
  activeDropTarget = null;
}

function setDropTarget(link, dragCount = 1) {
  if (activeDropTarget === link && activeDropTarget?.dataset.dropCount === String(dragCount)) return;
  clearDropTarget();
  if (!(link instanceof HTMLElement)) return;
  activeDropTarget = link;
  link.classList.add("is-drop-target");
  link.dataset.dropCount = String(dragCount);
  if (dragCount > 1) {
    link.classList.add("is-drop-target--multi");
    const badge = document.createElement("span");
    badge.className = "sidebar-drop-badge";
    badge.textContent = deps?.formatDropBadgeCount?.(dragCount) ?? String(dragCount);
    badge.setAttribute("aria-hidden", "true");
    link.append(badge);
  }
}

function isActiveBookmarkDrag() {
  return activeDragBookmarkIds.length > 0;
}

export function isBookmarkDragSessionActive() {
  return isActiveBookmarkDrag() || Boolean(quickAccessReorderId) || Boolean(quickAccessPointerDrag);
}

function markNonDraggableChildren(item) {
  item.querySelectorAll("a, button, input, select, textarea, img").forEach((element) => {
    element.setAttribute("draggable", "false");
  });
}

function resolveDragBookmark(item) {
  const bookmarkId = String(item?.dataset?.bookmarkId || "").trim();
  if (!bookmarkId || !deps) return null;
  return findBookmarkById(deps.getConfig(), bookmarkId);
}

function resolveDragBookmarkIds(draggedBookmarkId) {
  const selectedIds = deps?.getSelectedBookmarkIds?.() || [];
  if (selectedIds.length > 1 && selectedIds.includes(draggedBookmarkId)) {
    return selectedIds;
  }
  return [draggedBookmarkId];
}

function buildDragGhost(bookmark) {
  const ghost = document.createElement("div");
  ghost.className = "bookmark-drag-ghost";
  const title = escapeHtml(bookmark.title || bookmark.url || "");
  const domain = escapeHtml(getBookmarkDisplayDomain(bookmark));
  const thumbSrc = escapeHtml(deps.bookmarkStoredImageSrc(bookmark));
  ghost.innerHTML = `
    <div class="bookmark-drag-ghost__thumb">
      <img src="${thumbSrc}" alt="" draggable="false" />
    </div>
    <div class="bookmark-drag-ghost__body">
      <span class="bookmark-drag-ghost__title">${title}</span>
      ${domain ? `<span class="bookmark-drag-ghost__domain">${domain}</span>` : ""}
    </div>
  `;
  document.body.append(ghost);
  return ghost;
}

function buildMultiDragGhost(bookmark, count) {
  const ghost = document.createElement("div");
  ghost.className = "bookmark-drag-ghost bookmark-drag-ghost--multi";
  const title = escapeHtml(bookmark.title || bookmark.url || "");
  const thumbSrc = escapeHtml(deps.bookmarkStoredImageSrc(bookmark));
  const countLabel = escapeHtml(deps?.formatDragCount?.(count) ?? String(count));
  ghost.innerHTML = `
    <div class="bookmark-drag-ghost__stack" aria-hidden="true">
      <span class="bookmark-drag-ghost__stack-layer bookmark-drag-ghost__stack-layer--back"></span>
      <span class="bookmark-drag-ghost__stack-layer bookmark-drag-ghost__stack-layer--mid"></span>
      <div class="bookmark-drag-ghost__thumb">
        <img src="${thumbSrc}" alt="" draggable="false" />
      </div>
    </div>
    <div class="bookmark-drag-ghost__body">
      <span class="bookmark-drag-ghost__count">${countLabel}</span>
      <span class="bookmark-drag-ghost__title">${title}</span>
    </div>
  `;
  document.body.append(ghost);
  return ghost;
}

function markDraggingGroup(bookmarkIds) {
  if (bookmarkIds.length < 2) return;
  for (const bookmarkId of bookmarkIds) {
    const item = document.querySelector(`.bookmark-item[data-bookmark-id="${bookmarkId}"]`);
    item?.classList.add("is-dragging-group");
  }
}

function clearDraggingGroup() {
  document.querySelectorAll(".bookmark-item.is-dragging-group").forEach((item) => {
    item.classList.remove("is-dragging-group");
  });
}

function clearQuickAccessInsertMarker() {
  document.querySelectorAll(".quick-access-bar__item.is-drop-before, .quick-access-bar__item.is-drop-after")
    .forEach((item) => {
      item.classList.remove("is-drop-before", "is-drop-after");
    });
  quickAccessInsertIndex = -1;
}

function endDragSession() {
  const wasQuickAccess = Boolean(quickAccessReorderId);
  activeDragElement?.classList.remove("is-dragging");
  activeDragElement = null;
  activeDragBookmarkIds = [];
  quickAccessReorderId = "";
  clearQuickAccessInsertMarker();
  clearDraggingGroup();
  document.body.classList.remove("bookmark-drag-active", "bookmark-drag-active--multi", "quick-access-reorder-active");
  clearDropTarget();
  if (wasQuickAccess) deps?.onQuickAccessDragEnd?.();
  else deps?.onDragSessionEnd?.();
}

function parseDroppedBookmarkIds(dataTransfer) {
  const multiRaw = dataTransfer?.getData(DRAG_MIME_MULTI);
  if (multiRaw) {
    try {
      const parsed = JSON.parse(multiRaw);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id || "").trim()).filter(Boolean);
      }
    } catch {
      // Einzel-ID-Fallback unten.
    }
  }
  const single = dataTransfer?.getData(DRAG_MIME)
    || dataTransfer?.getData("text/plain")
    || activeDragBookmarkIds[0];
  return single ? [String(single).trim()] : [];
}

async function applyDrop(bookmarkIds, navId) {
  const config = deps.getConfig();
  const bookmarks = bookmarkIds
    .map((bookmarkId) => findBookmarkById(config, bookmarkId))
    .filter(Boolean);
  if (!bookmarks.length) return;

  try {
    if (navId === NAV_UNSORTED) {
      const confirmed = await deps.confirmDropToUnsorted(bookmarks);
      if (!confirmed) return;
      deps.pushUndo();
      for (const bookmark of bookmarks) {
        assignBookmarkToUnsorted(config, bookmark);
      }
    } else if (navId === NAV_FAVORITES) {
      deps.pushUndo();
      for (const bookmark of bookmarks) {
        assignBookmarkToFavorites(bookmark);
      }
    } else if (navId === NAV_ALL) {
      const categoryId = await deps.pickHomepageCategory(bookmarks);
      if (!categoryId) return;
      deps.pushUndo();
      for (const bookmark of bookmarks) {
        assignBookmarkToHomepageCategory(config, bookmark, categoryId);
      }
    } else if (navId === SIDEBAR_ADD_CATEGORY_DROP_ID) {
      deps.openAddSidebarCategoryModal?.(bookmarkIds);
      return;
    } else {
      const sectionId = await deps.pickSectionForCategory?.(navId, bookmarks);
      if (sectionId === null) return;
      deps.pushUndo();
      for (const bookmark of bookmarks) {
        assignBookmarkToCustomSidebarCategory(config, bookmark, navId);
        setBookmarkSectionIdForNav(bookmark, navId, sectionId || "");
      }
    }

    await deps.persistAndRender();
  } catch {
    // Kein inkonsistenter UI-Zustand: Änderungen nur nach erfolgreicher Persistenz.
  }
}

function getQuickAccessItems() {
  return [...document.querySelectorAll(".quick-access-bar__item[data-bookmark-id]")];
}

function resolveQuickAccessInsertIndex(clientX) {
  const items = getQuickAccessItems().filter((item) => item.dataset.bookmarkId !== quickAccessReorderId);
  if (!items.length) return 0;
  for (let index = 0; index < items.length; index += 1) {
    const rect = items[index].getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (clientX < midpoint) return index;
  }
  return items.length;
}

function paintQuickAccessInsertMarker(insertIndex) {
  clearQuickAccessInsertMarker();
  quickAccessInsertIndex = insertIndex;
  const items = getQuickAccessItems().filter((item) => item.dataset.bookmarkId !== quickAccessReorderId);
  if (!items.length) return;
  if (insertIndex <= 0) {
    items[0]?.classList.add("is-drop-before");
    return;
  }
  if (insertIndex >= items.length) {
    items[items.length - 1]?.classList.add("is-drop-after");
    return;
  }
  items[insertIndex]?.classList.add("is-drop-before");
}

function autoScrollQuickAccess(clientX) {
  const scroller = document.querySelector(".quick-access-bar__scroller");
  if (!(scroller instanceof HTMLElement)) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 36;
  if (clientX < rect.left + edge) {
    scroller.scrollLeft -= 18;
  } else if (clientX > rect.right - edge) {
    scroller.scrollLeft += 18;
  }
}

async function commitQuickAccessReorder(bookmarkId, insertIndex) {
  if (!deps || !bookmarkId) return;
  const config = deps.getConfig();
  const currentIds = getQuickAccessItems().map((item) => item.dataset.bookmarkId).filter(Boolean);
  const without = currentIds.filter((id) => id !== bookmarkId);
  const nextIndex = Math.max(0, Math.min(insertIndex, without.length));
  without.splice(nextIndex, 0, bookmarkId);
  const unchanged = without.length === currentIds.length
    && without.every((id, index) => id === currentIds[index]);
  if (unchanged) return;
  deps.pushUndo();
  reorderQuickAccessBookmarks(config, without);
  await deps.persistAndRender();
}

function onDocumentDragStart(event) {
  const quickItem = event.target.closest?.("[data-quick-access-drag]");
  if (quickItem instanceof HTMLElement) {
    const bookmarkId = String(quickItem.dataset.bookmarkId || "").trim();
    if (!bookmarkId || !(event.dataTransfer instanceof DataTransfer)) return;
    quickAccessReorderId = bookmarkId;
    activeDragBookmarkIds = [bookmarkId];
    activeDragElement = quickItem;
    event.dataTransfer.clearData();
    event.dataTransfer.setData(QUICK_ACCESS_REORDER_MIME, bookmarkId);
    event.dataTransfer.setData(DRAG_MIME, bookmarkId);
    event.dataTransfer.setData("text/plain", bookmarkId);
    event.dataTransfer.effectAllowed = "move";
    markNonDraggableChildren(quickItem);
    const bookmark = resolveDragBookmark(quickItem);
    if (bookmark) {
      const ghost = buildDragGhost(bookmark);
      const rect = ghost.getBoundingClientRect();
      event.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2));
      window.setTimeout(() => ghost.remove(), 0);
    }
    quickItem.classList.add("is-dragging");
    document.body.classList.add("bookmark-drag-active", "quick-access-reorder-active");
    deps?.onQuickAccessDragStart?.();
    return;
  }

  const item = event.target.closest("[data-bookmark-drag]");
  if (!(item instanceof HTMLElement) || !deps) return;

  const bookmark = resolveDragBookmark(item);
  if (!bookmark?.id || !(event.dataTransfer instanceof DataTransfer)) return;

  const bookmarkIds = resolveDragBookmarkIds(bookmark.id);
  activeDragBookmarkIds = bookmarkIds;
  activeDragElement = item;
  event.dataTransfer.clearData();
  event.dataTransfer.setData(DRAG_MIME, bookmark.id);
  if (bookmarkIds.length > 1) {
    event.dataTransfer.setData(DRAG_MIME_MULTI, JSON.stringify(bookmarkIds));
  }
  event.dataTransfer.setData("text/plain", bookmark.id);
  event.dataTransfer.effectAllowed = "move";

  markNonDraggableChildren(item);

  const ghost = bookmarkIds.length > 1
    ? buildMultiDragGhost(bookmark, bookmarkIds.length)
    : buildDragGhost(bookmark);
  const rect = ghost.getBoundingClientRect();
  event.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2));
  window.setTimeout(() => ghost.remove(), 0);

  item.classList.add("is-dragging");
  markDraggingGroup(bookmarkIds);
  document.body.classList.add("bookmark-drag-active");
  if (bookmarkIds.length > 1) {
    document.body.classList.add("bookmark-drag-active--multi");
  }
  deps.onDragSessionStart?.();
}

function onDocumentDragOver(event) {
  if (quickAccessReorderId) {
    const bar = event.target.closest?.(".quick-access-bar");
    if (!(bar instanceof HTMLElement)) {
      clearQuickAccessInsertMarker();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    autoScrollQuickAccess(event.clientX);
    paintQuickAccessInsertMarker(resolveQuickAccessInsertIndex(event.clientX));
    return;
  }

  if (!isActiveBookmarkDrag()) return;
  const link = event.target.closest("[data-sidebar-drop]");
  if (!(link instanceof HTMLElement)) {
    clearDropTarget();
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  setDropTarget(link, activeDragBookmarkIds.length);
}

function onDocumentDrop(event) {
  if (quickAccessReorderId) {
    const bar = event.target.closest?.(".quick-access-bar");
    if (!(bar instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const bookmarkId = quickAccessReorderId;
    const insertIndex = quickAccessInsertIndex >= 0
      ? quickAccessInsertIndex
      : resolveQuickAccessInsertIndex(event.clientX);
    endDragSession();
    void commitQuickAccessReorder(bookmarkId, insertIndex);
    return;
  }

  if (!isActiveBookmarkDrag()) return;
  const link = event.target.closest("[data-sidebar-drop]");
  if (!(link instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  clearDropTarget();

  const bookmarkIds = parseDroppedBookmarkIds(event.dataTransfer);
  const navId = link.dataset.sidebarDrop;
  if (!bookmarkIds.length || !navId) return;

  const savedBookmarkIds = bookmarkIds;
  const savedNavId = navId;
  endDragSession();
  void applyDrop(savedBookmarkIds, savedNavId);
}

function onDocumentDragEnd(event) {
  if (event.target.closest?.("[data-quick-access-drag], [data-bookmark-drag]")) {
    if (!isActiveBookmarkDrag() && !quickAccessReorderId) return;
    endDragSession();
  }
}

function clearQuickAccessPointerDrag() {
  if (!quickAccessPointerDrag) return;
  const { item, longPressTimer, ghost } = quickAccessPointerDrag;
  if (longPressTimer) window.clearTimeout(longPressTimer);
  ghost?.remove();
  item?.classList.remove("is-dragging");
  quickAccessPointerDrag = null;
  quickAccessReorderId = "";
  clearQuickAccessInsertMarker();
  document.body.classList.remove("bookmark-drag-active", "quick-access-reorder-active");
  deps?.onQuickAccessDragEnd?.();
}

function onQuickAccessPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const item = event.target.closest?.("[data-quick-access-drag]");
  if (!(item instanceof HTMLElement)) return;
  // Maus: natives HTML5-Dragging. Touch/Pen: Long-Press → Pointer-Drag.
  if (event.pointerType === "mouse") return;

  const bookmarkId = String(item.dataset.bookmarkId || "").trim();
  if (!bookmarkId) return;

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const scroller = item.closest(".quick-access-bar__scroller");
  const startScrollLeft = scroller instanceof HTMLElement ? scroller.scrollLeft : 0;

  quickAccessPointerDrag = {
    item,
    bookmarkId,
    pointerId,
    startX,
    startY,
    startScrollLeft,
    activated: false,
    longPressTimer: window.setTimeout(() => {
      if (!quickAccessPointerDrag || quickAccessPointerDrag.pointerId !== pointerId) return;
      quickAccessPointerDrag.activated = true;
      quickAccessReorderId = bookmarkId;
      item.classList.add("is-dragging");
      document.body.classList.add("bookmark-drag-active", "quick-access-reorder-active");
      const bookmark = resolveDragBookmark(item);
      if (bookmark) {
        const ghost = buildDragGhost(bookmark);
        ghost.classList.add("bookmark-drag-ghost--pointer");
        ghost.style.left = `${startX}px`;
        ghost.style.top = `${startY}px`;
        quickAccessPointerDrag.ghost = ghost;
      }
      deps?.onQuickAccessDragStart?.();
      try {
        item.setPointerCapture(pointerId);
      } catch {
        // Capture optional.
      }
    }, 420)
  };
}

function onQuickAccessPointerMove(event) {
  const session = quickAccessPointerDrag;
  if (!session || session.pointerId !== event.pointerId) return;

  const dx = event.clientX - session.startX;
  const dy = event.clientY - session.startY;

  if (!session.activated) {
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearQuickAccessPointerDrag();
    }
    return;
  }

  event.preventDefault();
  if (session.ghost instanceof HTMLElement) {
    session.ghost.style.left = `${event.clientX}px`;
    session.ghost.style.top = `${event.clientY}px`;
  }
  autoScrollQuickAccess(event.clientX);
  paintQuickAccessInsertMarker(resolveQuickAccessInsertIndex(event.clientX));
}

function onQuickAccessPointerUp(event) {
  const session = quickAccessPointerDrag;
  if (!session || session.pointerId !== event.pointerId) return;
  const { bookmarkId, activated, item } = session;
  const insertIndex = quickAccessInsertIndex >= 0
    ? quickAccessInsertIndex
    : resolveQuickAccessInsertIndex(event.clientX);
  clearQuickAccessPointerDrag();
  if (activated) {
    if (item instanceof HTMLElement) {
      const suppressClick = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        item.removeEventListener("click", suppressClick, true);
      };
      item.addEventListener("click", suppressClick, true);
    }
    void commitQuickAccessReorder(bookmarkId, insertIndex);
  }
}

function bindDocumentDragDrop() {
  if (dragDropBound) return;
  dragDropBound = true;
  document.addEventListener("dragstart", onDocumentDragStart, true);
  document.addEventListener("dragover", onDocumentDragOver, true);
  document.addEventListener("drop", onDocumentDrop, true);
  document.addEventListener("dragend", onDocumentDragEnd, true);
  document.addEventListener("pointerdown", onQuickAccessPointerDown, true);
  document.addEventListener("pointermove", onQuickAccessPointerMove, true);
  document.addEventListener("pointerup", onQuickAccessPointerUp, true);
  document.addEventListener("pointercancel", onQuickAccessPointerUp, true);
}

/** Markiert Kinder als nicht ziehbar; Drag läuft zentral per Event-Delegation. */
export function bindBookmarkDrag(item) {
  if (!(item instanceof HTMLElement)) return;
  if (!item.hasAttribute("data-bookmark-drag") && !item.hasAttribute("data-quick-access-drag")) return;
  markNonDraggableChildren(item);
}

export function initBookmarkDragDrop(options) {
  deps = options;
  bindDocumentDragDrop();
}

export { QUICK_ACCESS_CATEGORY_ID };
