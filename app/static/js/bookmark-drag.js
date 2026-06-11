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
  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "-1000px";
  document.body.append(ghost);
  return ghost;
}

async function applyDrop(bookmarkId, navId) {
  const config = deps.getConfig();
  const bookmark = findBookmarkById(config, bookmarkId);
  if (!bookmark) return;

  deps.pushUndo();

  if (navId === NAV_UNSORTED) {
    assignBookmarkToUnsorted(config, bookmark);
  } else if (navId === NAV_FAVORITES) {
    assignBookmarkToFavorites(bookmark);
  } else if (navId === NAV_ALL) {
    const categoryId = await deps.pickHomepageCategory();
    if (!categoryId) return;
    assignBookmarkToHomepageCategory(config, bookmark, categoryId);
  } else {
    assignBookmarkToCustomSidebarCategory(config, bookmark, navId);
  }

  await deps.persistAndRender();
}

export function bindBookmarkDrag(item, bookmark) {
  if (!(item instanceof HTMLElement) || !bookmark?.id || !deps) return;
  if (!item.hasAttribute("data-bookmark-drag")) return;

  item.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button, [data-bookmark-menu-trigger]")) {
      event.preventDefault();
      return;
    }
    if (!(event.dataTransfer instanceof DataTransfer)) return;
    event.dataTransfer.setData(DRAG_MIME, bookmark.id);
    event.dataTransfer.setData("text/plain", bookmark.id);
    event.dataTransfer.effectAllowed = "move";

    const ghost = buildDragGhost(bookmark);
    event.dataTransfer.setDragImage(ghost, 24, 24);
    window.setTimeout(() => ghost.remove(), 0);

    item.classList.add("is-dragging");
    document.body.classList.add("bookmark-drag-active");
  });

  item.addEventListener("dragend", () => {
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
    const link = event.target.closest("[data-sidebar-drop]");
    if (!(link instanceof HTMLElement)) {
      clearDropTarget();
      return;
    }
    const types = event.dataTransfer?.types || [];
    const hasBookmark = Array.from(types).includes(DRAG_MIME) || Array.from(types).includes("text/plain");
    if (!hasBookmark) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(link);
  });

  sidebar.addEventListener("dragleave", (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && sidebar.contains(related)) return;
    clearDropTarget();
  });

  sidebar.addEventListener("drop", (event) => {
    const link = event.target.closest("[data-sidebar-drop]");
    if (!(link instanceof HTMLElement)) return;
    event.preventDefault();
    clearDropTarget();
    const bookmarkId = event.dataTransfer?.getData(DRAG_MIME) || event.dataTransfer?.getData("text/plain");
    const navId = link.dataset.sidebarDrop;
    if (!bookmarkId || !navId) return;
    void applyDrop(bookmarkId, navId);
  });
}
