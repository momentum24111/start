/** Drag and Drop: Lesezeichen in Sidebar-Kategorien verschieben. */

import { escapeHtml } from "./bookmark-views.js";
import {
  assignBookmarkToCustomSidebarCategory,
  assignBookmarkToFavorites,
  assignBookmarkToHomepageCategory,
  assignBookmarkToUnsorted,
  findBookmarkById,
  getBookmarkDisplayDomain
} from "./bookmarks.js";
import { NAV_ALL, NAV_FAVORITES, NAV_UNSORTED } from "./navigation.js";

const DRAG_MIME = "application/x-start-bookmark-id";
const DRAG_MIME_MULTI = "application/x-start-bookmark-ids";
let deps = null;
let activeDropTarget = null;
let activeDragBookmarkIds = [];
let activeDragElement = null;
let dragDropBound = false;

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
  return isActiveBookmarkDrag();
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

function endDragSession() {
  activeDragElement?.classList.remove("is-dragging");
  activeDragElement = null;
  activeDragBookmarkIds = [];
  clearDraggingGroup();
  document.body.classList.remove("bookmark-drag-active", "bookmark-drag-active--multi");
  clearDropTarget();
  deps?.onDragSessionEnd?.();
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
    } else {
      deps.pushUndo();
      for (const bookmark of bookmarks) {
        assignBookmarkToCustomSidebarCategory(config, bookmark, navId);
      }
    }

    await deps.persistAndRender();
  } catch {
    // Kein inkonsistenter UI-Zustand: Änderungen nur nach erfolgreicher Persistenz.
  }
}

function onDocumentDragStart(event) {
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
  if (!(event.target.closest("[data-bookmark-drag]"))) return;
  if (!isActiveBookmarkDrag()) return;
  endDragSession();
}

function bindDocumentDragDrop() {
  if (dragDropBound) return;
  dragDropBound = true;
  document.addEventListener("dragstart", onDocumentDragStart, true);
  document.addEventListener("dragover", onDocumentDragOver, true);
  document.addEventListener("drop", onDocumentDrop, true);
  document.addEventListener("dragend", onDocumentDragEnd, true);
}

/** Markiert Kinder als nicht ziehbar; Drag läuft zentral per Event-Delegation. */
export function bindBookmarkDrag(item) {
  if (!(item instanceof HTMLElement)) return;
  if (!item.hasAttribute("data-bookmark-drag")) return;
  markNonDraggableChildren(item);
}

export function initBookmarkDragDrop(options) {
  deps = options;
  bindDocumentDragDrop();
}
