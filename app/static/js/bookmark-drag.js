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
let deps = null;
let activeDropTarget = null;
let activeDragBookmarkId = null;
let activeDragElement = null;
let dragDropBound = false;

function clearDropTarget() {
  if (!(activeDropTarget instanceof HTMLElement)) return;
  activeDropTarget.classList.remove("is-drop-target");
  activeDropTarget = null;
}

function setDropTarget(link) {
  if (activeDropTarget === link) return;
  clearDropTarget();
  if (link instanceof HTMLElement) {
    activeDropTarget = link;
    link.classList.add("is-drop-target");
  }
}

function isActiveBookmarkDrag() {
  return Boolean(activeDragBookmarkId);
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

function endDragSession() {
  activeDragElement?.classList.remove("is-dragging");
  activeDragElement = null;
  activeDragBookmarkId = null;
  document.body.classList.remove("bookmark-drag-active");
  clearDropTarget();
  deps?.onDragSessionEnd?.();
}

async function applyDrop(bookmarkId, navId) {
  const config = deps.getConfig();
  const bookmark = findBookmarkById(config, bookmarkId);
  if (!bookmark) return;

  try {
    if (navId === NAV_UNSORTED) {
      const confirmed = await deps.confirmDropToUnsorted(bookmark);
      if (!confirmed) return;
      deps.pushUndo();
      assignBookmarkToUnsorted(config, bookmark);
    } else if (navId === NAV_FAVORITES) {
      deps.pushUndo();
      assignBookmarkToFavorites(bookmark);
    } else if (navId === NAV_ALL) {
      const categoryId = await deps.pickHomepageCategory();
      if (!categoryId) return;
      deps.pushUndo();
      assignBookmarkToHomepageCategory(config, bookmark, categoryId);
    } else {
      deps.pushUndo();
      assignBookmarkToCustomSidebarCategory(config, bookmark, navId);
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

  activeDragBookmarkId = bookmark.id;
  activeDragElement = item;
  event.dataTransfer.clearData();
  event.dataTransfer.setData(DRAG_MIME, bookmark.id);
  event.dataTransfer.setData("text/plain", bookmark.id);
  event.dataTransfer.effectAllowed = "move";

  markNonDraggableChildren(item);

  const ghost = buildDragGhost(bookmark);
  const rect = ghost.getBoundingClientRect();
  event.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2));
  window.setTimeout(() => ghost.remove(), 0);

  item.classList.add("is-dragging");
  document.body.classList.add("bookmark-drag-active");
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
  setDropTarget(link);
}

function onDocumentDrop(event) {
  if (!isActiveBookmarkDrag()) return;
  const link = event.target.closest("[data-sidebar-drop]");
  if (!(link instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  clearDropTarget();

  const bookmarkId = event.dataTransfer?.getData(DRAG_MIME)
    || event.dataTransfer?.getData("text/plain")
    || activeDragBookmarkId;
  const navId = link.dataset.sidebarDrop;
  if (!bookmarkId || !navId) return;

  const savedBookmarkId = bookmarkId;
  const savedNavId = navId;
  endDragSession();
  void applyDrop(savedBookmarkId, savedNavId);
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
