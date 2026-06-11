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

function markNonDraggableChildren(item) {
  item.querySelectorAll("a, button, input, select, textarea, img").forEach((element) => {
    element.setAttribute("draggable", "false");
  });
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

async function applyDrop(bookmarkId, navId) {
  const config = deps.getConfig();
  const bookmark = findBookmarkById(config, bookmarkId);
  if (!bookmark) return;

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
}

export function bindBookmarkDrag(item, bookmark) {
  if (!(item instanceof HTMLElement) || !bookmark?.id || !deps) return;
  if (!item.hasAttribute("data-bookmark-drag")) return;

  markNonDraggableChildren(item);

  item.addEventListener("dragstart", (event) => {
    if (!(event.dataTransfer instanceof DataTransfer)) return;
    activeDragBookmarkId = bookmark.id;
    event.dataTransfer.clearData();
    event.dataTransfer.setData(DRAG_MIME, bookmark.id);
    event.dataTransfer.setData("text/plain", bookmark.id);
    event.dataTransfer.effectAllowed = "move";

    const ghost = buildDragGhost(bookmark);
    const rect = ghost.getBoundingClientRect();
    event.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2));
    window.setTimeout(() => ghost.remove(), 0);

    item.classList.add("is-dragging");
    document.body.classList.add("bookmark-drag-active");
  });

  item.addEventListener("dragend", () => {
    activeDragBookmarkId = null;
    item.classList.remove("is-dragging");
    document.body.classList.remove("bookmark-drag-active");
    clearDropTarget();
  });
}

export function initBookmarkDragDrop(options) {
  deps = options;
  const sidebar = document.getElementById("sidebar");
  if (!(sidebar instanceof HTMLElement)) return;
  if (sidebar.dataset.dragDropBound === "true") return;
  sidebar.dataset.dragDropBound = "true";

  sidebar.addEventListener("dragover", (event) => {
    if (!isActiveBookmarkDrag()) return;
    const link = event.target.closest("[data-sidebar-drop]");
    if (!(link instanceof HTMLElement)) {
      clearDropTarget();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(link);
  });

  sidebar.addEventListener("dragenter", (event) => {
    if (!isActiveBookmarkDrag()) return;
    const link = event.target.closest("[data-sidebar-drop]");
    if (!(link instanceof HTMLElement)) return;
    event.preventDefault();
    setDropTarget(link);
  });

  sidebar.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && sidebar.contains(related)) return;
    const link = event.target.closest("[data-sidebar-drop]");
    if (link && related instanceof Node && link.contains(related)) return;
    clearDropTarget();
  });

  sidebar.addEventListener("drop", (event) => {
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
    activeDragBookmarkId = null;
    if (!bookmarkId || !navId) return;
    void applyDrop(bookmarkId, navId);
  });
}
