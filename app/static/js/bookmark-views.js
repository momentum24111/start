/** Lesezeichen-Darstellung: Listen- und Kartenansicht. */

import { t } from "./i18n.js";
import { formatBookmarkDomain, getBookmarkDisplayCategoryLabels, isBookmarkInFavorites } from "./bookmarks.js";
import { VIEW_LIST, VIEW_CARDS, VIEW_MODE_OPTIONS } from "./navigation.js";

export { VIEW_LIST, VIEW_CARDS, VIEW_MODE_OPTIONS };

export function normalizeBookmarkView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VIEW_MODE_OPTIONS.includes(normalized) ? normalized : VIEW_LIST;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function getBookmarkCategoryLabels(config, bookmark) {
  const categoryById = new Map((config.categories || []).map((category) => [category.id, category]));
  return (bookmark.categoryIds || [])
    .map((id) => categoryById.get(id))
    .filter(Boolean)
    .map((category) => category.name);
}

export function bookmarksContainerClass(view) {
  const normalized = normalizeBookmarkView(view);
  return `bookmarks bookmarks--${normalized}`;
}

function renderCategoryChips(labels) {
  if (!labels.length) return "";
  return labels
    .map((label) => `<span class="bookmark-category-chip">${escapeHtml(label)}</span>`)
    .join("");
}

function renderThumbnail(bookmark, deps, variant = "") {
  const src = deps.bookmarkStoredImageSrc(bookmark);
  const variantClass = variant ? ` bookmark-thumb--${variant}` : "";
  return `
    <div class="bookmark-thumb${variantClass}">
      <img
        class="bookmark-thumb__img"
        src="${escapeHtml(src)}"
        alt=""
        loading="lazy"
        decoding="async"
        data-bookmark-thumb
      />
      <span class="bookmark-thumb__placeholder" aria-hidden="true">${deps.mdiIcon("bookmark-outline", "bookmark-thumb__placeholder-icon")}</span>
    </div>
  `;
}

function renderReorderActions(options, deps) {
  const { canMoveLeft, canMoveRight } = options;
  return `
    <div class="bookmark-reorder">
      ${deps.button({
        label: t("ui.moveUp"),
        icon: deps.iconSvg(deps.icons.arrowUp, "inline-icon"),
        dataAttr: `data-move-bookmark-left ${canMoveLeft ? "" : "disabled"}`,
        variant: "btn--ghost",
        className: "btn--compact btn--bookmark-reorder",
        iconOnly: true
      })}
      ${deps.button({
        label: t("ui.moveDown"),
        icon: deps.iconSvg(deps.icons.arrowDown, "inline-icon"),
        dataAttr: `data-move-bookmark-right ${canMoveRight ? "" : "disabled"}`,
        variant: "btn--ghost",
        className: "btn--compact btn--bookmark-reorder",
        iconOnly: true
      })}
    </div>
  `;
}

function renderActionButtons(options, deps, { compact = false, editOnly = false } = {}) {
  const compactClass = compact ? " btn--compact" : "";
  return `
    ${editOnly ? "" : deps.button({
      label: t("ui.open"),
      icon: deps.iconSvg(deps.icons.open, "inline-icon"),
      dataAttr: "data-bookmark-open-action",
      variant: "btn--ghost",
      className: `btn--bookmark-action${compactClass}`,
      iconOnly: true
    })}
    ${deps.button({
      label: t("ui.edit"),
      icon: deps.iconSvg(deps.icons.edit, "inline-icon"),
      dataAttr: "data-edit-bookmark",
      variant: "btn--ghost",
      className: `btn--bookmark-action${compactClass}`,
      iconOnly: true
    })}
    ${deps.button({
      label: t("ui.delete"),
      icon: deps.iconSvg(deps.icons.trash, "inline-icon"),
      dataAttr: "data-delete-bookmark",
      variant: "btn--ghost",
      className: `btn--bookmark-action${compactClass}`,
      iconOnly: true
    })}
  `;
}

function renderOverflowMenu(deps, { nav = false } = {}) {
  const menuItems = nav
    ? `
        <button type="button" class="bookmark-menu__item" data-edit-bookmark role="menuitem">${escapeHtml(t("ui.edit"))}</button>
        <button type="button" class="bookmark-menu__item" data-reload-bookmark-metadata role="menuitem">${escapeHtml(t("ui.reloadBookmarkMetadata"))}</button>
        <button type="button" class="bookmark-menu__item bookmark-menu__item--danger" data-delete-bookmark role="menuitem">${escapeHtml(t("ui.delete"))}</button>
      `
    : `
        <button type="button" class="bookmark-menu__item" data-bookmark-open-action role="menuitem">${escapeHtml(t("ui.open"))}</button>
        <button type="button" class="bookmark-menu__item" data-edit-bookmark role="menuitem">${escapeHtml(t("ui.edit"))}</button>
        <button type="button" class="bookmark-menu__item bookmark-menu__item--danger" data-delete-bookmark role="menuitem">${escapeHtml(t("ui.delete"))}</button>
      `;
  return `
    <div class="bookmark-menu${nav ? " bookmark-menu--nav" : ""}">
      <button
        type="button"
        class="btn btn--ghost btn--icon btn--bookmark-menu-trigger"
        data-bookmark-menu-trigger
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="${escapeHtml(t("ui.actions"))}"
      >
        <span class="btn__icon">${deps.iconSvg(deps.icons.dotsVertical, "inline-icon")}</span>
      </button>
      <div class="bookmark-menu__panel bookmark-menu__panel--source hidden" data-bookmark-menu-panel role="menu" aria-hidden="true">
        ${menuItems}
      </div>
    </div>
  `;
}

function bookmarkLinkTarget(bookmark) {
  return bookmark.openMode === "current-tab" ? "_self" : "_blank";
}

function bookmarkShowsFavorite(bookmark) {
  return isBookmarkInFavorites(bookmark);
}

function renderHomepageCardBookmark(options, deps) {
  const { bookmark, editMode } = options;
  const title = escapeHtml(bookmark.title || "");
  const url = escapeHtml(bookmark.url || "");

  return `
    <article
      class="bookmark-item bookmark-item--homepage-card service ${editMode ? "is-edit-mode" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      <a
        class="bookmark-card__link"
        href="${url}"
        target="${bookmarkLinkTarget(bookmark)}"
        rel="noreferrer"
        data-bookmark-open
        aria-label="${title}"
      ></a>
      ${renderThumbnail(bookmark, deps, "homepage-card")}
      <div class="bookmark-homepage-card__body">
        <h3 class="bookmark-item__title">${title}</h3>
      </div>
      ${editMode ? `
        <div class="bookmark-item__edit-actions bookmark-item__edit-actions--homepage-card">
          ${renderActionButtons(options, deps, { editOnly: true })}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
    </article>
  `;
}

function renderHomepageBookmark(options, deps) {
  const { bookmark, editMode } = options;
  const title = escapeHtml(bookmark.title || "");
  const url = escapeHtml(bookmark.url || "");

  return `
    <article
      class="bookmark-item bookmark-item--homepage service ${editMode ? "is-edit-mode" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      <a
        class="bookmark-homepage__main"
        href="${url}"
        target="${bookmarkLinkTarget(bookmark)}"
        rel="noreferrer"
        data-bookmark-open
      >
        ${renderThumbnail(bookmark, deps, "homepage")}
        <h3 class="bookmark-item__title">${title}</h3>
      </a>
      ${editMode ? `
        <div class="bookmark-item__edit-actions bookmark-item__edit-actions--homepage">
          ${renderActionButtons(options, deps, { editOnly: true })}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
    </article>
  `;
}

function renderNavListBookmark(options, deps) {
  const { bookmark, editMode } = options;
  const title = escapeHtml(bookmark.title || "");
  const description = escapeHtml(bookmark.description || "");
  const url = String(bookmark.url || "").trim();
  const urlAttr = escapeHtml(url);
  const domain = escapeHtml(formatBookmarkDomain(url));
  const categoryLabels = getBookmarkDisplayCategoryLabels(options.config, bookmark, t("ui.navFavorites"));
  const categoryChips = renderCategoryChips(categoryLabels);

  return `
    <article
      class="bookmark-item bookmark-item--list bookmark-item--nav service ${editMode ? "is-edit-mode" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      <a
        class="bookmark-item__nav-link"
        href="${urlAttr}"
        target="${bookmarkLinkTarget(bookmark)}"
        rel="noreferrer"
        data-bookmark-open
      >
        ${renderThumbnail(bookmark, deps, "list")}
        <div class="bookmark-item__main">
          <h3 class="bookmark-item__title">${title}</h3>
          ${description ? `<p class="bookmark-item__description">${description}</p>` : `<p class="bookmark-item__description bookmark-item__description--empty" aria-hidden="true"></p>`}
          ${domain ? `<span class="bookmark-item__domain" title="${urlAttr}">${domain}</span>` : ""}
          ${categoryChips ? `<div class="bookmark-item__categories">${categoryChips}</div>` : ""}
        </div>
      </a>
      ${editMode ? "" : renderOverflowMenu(deps, { nav: true })}
      ${editMode ? `
        <div class="bookmark-item__edit-actions bookmark-item__edit-actions--nav">
          ${renderActionButtons(options, deps, { editOnly: true })}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
      <div class="bookmark-item__loading hidden" data-bookmark-loading aria-hidden="true">
        <span class="spinner" aria-hidden="true"></span>
      </div>
    </article>
  `;
}

function renderNavCardBookmark(options, deps) {
  const { bookmark, editMode } = options;
  const title = escapeHtml(bookmark.title || "");
  const description = escapeHtml(bookmark.description || "");
  const url = escapeHtml(bookmark.url || "");
  const categoryLabels = getBookmarkDisplayCategoryLabels(options.config, bookmark, t("ui.navFavorites"));
  const categoryChips = renderCategoryChips(categoryLabels);

  return `
    <article
      class="bookmark-item bookmark-item--card bookmark-item--nav service ${editMode ? "is-edit-mode" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      <a
        class="bookmark-card__link"
        href="${url}"
        target="${bookmarkLinkTarget(bookmark)}"
        rel="noreferrer"
        data-bookmark-open
        aria-label="${title}"
      ></a>
      ${renderThumbnail(bookmark, deps, "card")}
      <div class="bookmark-card__body">
        <h3 class="bookmark-item__title">${title}</h3>
        ${description ? `<p class="bookmark-item__description">${description}</p>` : `<p class="bookmark-item__description bookmark-item__description--empty" aria-hidden="true"></p>`}
        ${categoryChips ? `<div class="bookmark-item__categories">${categoryChips}</div>` : ""}
      </div>
      ${editMode ? "" : renderOverflowMenu(deps, { nav: true })}
      ${editMode ? `
        <div class="bookmark-item__edit-actions bookmark-item__edit-actions--card">
          ${renderActionButtons(options, deps, { editOnly: true })}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
      <div class="bookmark-item__loading hidden" data-bookmark-loading aria-hidden="true">
        <span class="spinner" aria-hidden="true"></span>
      </div>
    </article>
  `;
}

function renderListBookmark(options, deps) {
  const { bookmark, editMode, hasShortcut } = options;
  const title = escapeHtml(bookmark.title || "");
  const description = escapeHtml(bookmark.description || "");
  const url = escapeHtml(bookmark.url || "");
  const categoryChips = renderCategoryChips(getBookmarkCategoryLabels(options.config, bookmark));
  const shortcutMarkup = !editMode && hasShortcut
    ? `<div class="bookmark-shortcut">${deps.renderShortcutChips(bookmark.shortcut)}</div>`
    : "";

  return `
    <article
      class="bookmark-item bookmark-item--list service ${editMode ? "is-edit-mode" : ""} ${hasShortcut ? "has-shortcut" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      ${renderThumbnail(bookmark, deps, "list")}
      <div class="bookmark-item__main">
        <div class="bookmark-item__head">
          <a
            class="bookmark-item__open"
            href="${url}"
            target="${bookmarkLinkTarget(bookmark)}"
            rel="noreferrer"
            data-bookmark-open
          >
            <h3 class="bookmark-item__title">${title}</h3>
          </a>
          ${shortcutMarkup}
          ${editMode ? "" : `<div class="bookmark-item__hover-actions">${renderActionButtons(options, deps, { compact: true })}</div>`}
          ${editMode ? "" : renderOverflowMenu(deps)}
        </div>
        ${description ? `<p class="bookmark-item__description">${description}</p>` : `<p class="bookmark-item__description bookmark-item__description--empty" aria-hidden="true"></p>`}
        ${url ? `<span class="bookmark-item__url">${url}</span>` : ""}
        ${categoryChips ? `<div class="bookmark-item__categories">${categoryChips}</div>` : ""}
      </div>
      ${editMode ? `
        <div class="bookmark-item__edit-actions">
          ${renderActionButtons(options, deps)}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
    </article>
  `;
}

function renderCardBookmark(options, deps) {
  const { bookmark, editMode } = options;
  const title = escapeHtml(bookmark.title || "");
  const description = escapeHtml(bookmark.description || "");
  const url = escapeHtml(bookmark.url || "");
  const categoryChips = renderCategoryChips(getBookmarkCategoryLabels(options.config, bookmark));

  return `
    <article
      class="bookmark-item bookmark-item--card service ${editMode ? "is-edit-mode" : ""} ${bookmarkShowsFavorite(bookmark) ? "is-favorite" : ""}"
      data-bookmark-id="${escapeHtml(bookmark.id)}"
      data-category-id="${escapeHtml(options.category.id)}"
    >
      <a
        class="bookmark-card__link"
        href="${url}"
        target="${bookmarkLinkTarget(bookmark)}"
        rel="noreferrer"
        data-bookmark-open
        aria-label="${title}"
      ></a>
      ${renderThumbnail(bookmark, deps, "card")}
      <div class="bookmark-card__body">
        <h3 class="bookmark-item__title">${title}</h3>
        ${description ? `<p class="bookmark-item__description">${description}</p>` : `<p class="bookmark-item__description bookmark-item__description--empty" aria-hidden="true"></p>`}
        ${categoryChips ? `<div class="bookmark-item__categories">${categoryChips}</div>` : ""}
      </div>
      ${editMode ? "" : `<div class="bookmark-card__hover-actions">${renderActionButtons(options, deps, { compact: true })}</div>`}
      ${editMode ? "" : renderOverflowMenu(deps)}
      ${editMode ? `
        <div class="bookmark-item__edit-actions bookmark-item__edit-actions--card">
          ${renderActionButtons(options, deps)}
          ${renderReorderActions(options, deps)}
        </div>
      ` : ""}
    </article>
  `;
}

export function renderBookmarkMarkup(options, deps) {
  if (options.homepage) {
    const view = normalizeBookmarkView(options.view);
    if (view === "cards") return renderHomepageCardBookmark(options, deps);
    return renderHomepageBookmark(options, deps);
  }
  const view = normalizeBookmarkView(options.view);
  if (options.navList) {
    if (view === "cards") return renderNavCardBookmark(options, deps);
    return renderNavListBookmark(options, deps);
  }
  if (view === "cards") return renderCardBookmark(options, deps);
  return renderListBookmark(options, deps);
}

let activeBookmarkMenu = null;
let bookmarkMenuOverlay = null;
let bookmarkMenuDismissBound = false;

function getBookmarkMenuOverlay() {
  if (bookmarkMenuOverlay instanceof HTMLElement) return bookmarkMenuOverlay;
  const overlay = document.createElement("div");
  overlay.id = "bookmark-menu-overlay";
  overlay.className = "bookmark-menu-overlay hidden";
  overlay.innerHTML = `<div class="bookmark-menu__panel" data-bookmark-menu-panel role="menu"></div>`;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeBookmarkMenu();
  });
  document.body.append(overlay);
  bookmarkMenuOverlay = overlay;
  return overlay;
}

function positionBookmarkMenuPanel(panel, trigger) {
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

function bindOverlayMenuActions(panel, actions) {
  panel.querySelector("[data-bookmark-open-action]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBookmarkMenu();
    actions.onOpen?.();
  });
  panel.querySelector("[data-edit-bookmark]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBookmarkMenu();
    actions.onEdit?.();
  });
  panel.querySelector("[data-reload-bookmark-metadata]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBookmarkMenu();
    actions.onReloadMetadata?.();
  });
  panel.querySelector("[data-delete-bookmark]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBookmarkMenu();
    actions.onDelete?.();
  });
}

function onBookmarkMenuViewportChange() {
  if (activeBookmarkMenu) closeBookmarkMenu();
}

export function closeBookmarkMenu() {
  const overlay = bookmarkMenuOverlay;
  const panel = overlay?.querySelector("[data-bookmark-menu-panel]");
  if (panel) panel.innerHTML = "";
  overlay?.classList.add("hidden");
  overlay?.classList.remove("is-open");
  if (activeBookmarkMenu?.trigger) {
    activeBookmarkMenu.trigger.setAttribute("aria-expanded", "false");
  }
  activeBookmarkMenu?.menuRoot?.classList.remove("is-open");
  activeBookmarkMenu = null;
}

function openBookmarkMenu(menuRoot, actions) {
  const trigger = menuRoot?.querySelector("[data-bookmark-menu-trigger]");
  const sourcePanel = menuRoot?.querySelector("[data-bookmark-menu-panel]");
  if (!(trigger instanceof HTMLElement) || !(sourcePanel instanceof HTMLElement)) return;

  if (activeBookmarkMenu?.menuRoot === menuRoot) {
    closeBookmarkMenu();
    return;
  }

  closeBookmarkMenu();

  const overlay = getBookmarkMenuOverlay();
  const panel = overlay.querySelector("[data-bookmark-menu-panel]");
  if (!(panel instanceof HTMLElement)) return;

  panel.innerHTML = sourcePanel.innerHTML;
  bindOverlayMenuActions(panel, actions);

  overlay.classList.remove("hidden");
  overlay.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  menuRoot.classList.add("is-open");
  activeBookmarkMenu = { menuRoot, trigger };

  requestAnimationFrame(() => {
    if (activeBookmarkMenu?.menuRoot !== menuRoot) return;
    positionBookmarkMenuPanel(panel, trigger);
  });
}

function bindThumbnailFallback(item, deps) {
  const image = item.querySelector("[data-bookmark-thumb]");
  if (!(image instanceof HTMLImageElement)) return;
  const markLoaded = () => {
    image.classList.add("is-loaded");
    image.classList.remove("is-error");
  };
  const markError = () => {
    image.classList.add("is-error");
    image.classList.remove("is-loaded");
    if (!String(image.getAttribute("src") || "").trim()) {
      image.removeAttribute("src");
    }
  };
  image.addEventListener("load", markLoaded);
  image.addEventListener("error", markError);
  if (image.complete) {
    if (image.naturalWidth > 0) markLoaded();
    else markError();
  }
}

export function createBookmarkElement(options, deps) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderBookmarkMarkup(options, deps).trim();
  const item = wrapper.firstElementChild;
  if (!(item instanceof HTMLElement)) return wrapper;

  bindThumbnailFallback(item, deps);

  const openLink = () => {
    const link = item.querySelector("[data-bookmark-open]");
    if (link instanceof HTMLAnchorElement) link.click();
  };

  item.querySelectorAll("[data-bookmark-open-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLink();
    });
  });

  const menuActions = {
    onOpen: openLink,
    onEdit: () => deps.onEdit?.(),
    onDelete: () => deps.onDelete?.(),
    onReloadMetadata: () => deps.onReloadMetadata?.(item)
  };

  const menuRoot = item.querySelector(".bookmark-menu");
  const menuTrigger = item.querySelector("[data-bookmark-menu-trigger]");
  menuTrigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!(menuRoot instanceof HTMLElement)) return;
    openBookmarkMenu(menuRoot, menuActions);
  });

  item.querySelector("[data-move-bookmark-left]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    deps.onMoveLeft?.();
  });
  item.querySelector("[data-move-bookmark-right]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    deps.onMoveRight?.();
  });

  return item;
}

export function ensureBookmarkMenuDismiss() {
  if (bookmarkMenuDismissBound) return;
  bookmarkMenuDismissBound = true;
  getBookmarkMenuOverlay();
  document.addEventListener("click", (event) => {
    if (!activeBookmarkMenu) return;
    const target = event.target;
    if (target instanceof Element && (
      target.closest("#bookmark-menu-overlay") ||
      target.closest("[data-bookmark-menu-trigger]")
    )) return;
    closeBookmarkMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeBookmarkMenu) return;
    closeBookmarkMenu();
  });
  window.addEventListener("scroll", onBookmarkMenuViewportChange, true);
  window.addEventListener("resize", onBookmarkMenuViewportChange);
}
