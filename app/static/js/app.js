import { api } from "./api.js";
import { showModal, showStatusModal } from "./modal.js";
import { setupDragDrop } from "./dragdrop.js";
import { initI18n, t } from "./i18n.js";
import { applyTheme } from "./themes.js";

const state = {
  config: { categories: [] },
  settings: { appTitle: "Start", theme: "dark", language: "en", categoryAccentStrength: 15 },
  editMode: false,
  editModeCollapsedSnapshot: null,
  undoStack: [],
  themes: [],
  languages: [],
  faviconLoading: false
};

const elements = {
  title: document.getElementById("app-title"),
  categories: document.getElementById("categories"),
  addCategory: document.getElementById("add-category-btn"),
  undo: document.getElementById("undo-btn"),
  edit: document.getElementById("edit-btn"),
  settings: document.getElementById("settings-btn")
};

const ICONS = {
  undo: "M12 5v4L7 4l5-5v4c5.5 0 10 4.5 10 10a10 10 0 0 1-10 10H7v-2h5a8 8 0 1 0 0-16z",
  edit: "M4 16.25V20h3.75L18.81 8.94l-3.75-3.75L4 16.25zm15.71-9.04a1 1 0 0 0 0-1.41l-1.51-1.51a1 1 0 0 0-1.41 0l-1.12 1.12 3.75 3.75 1.29-1.95z",
  done: "M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z",
  settings: "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a6.9 6.9 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z",
  trash: "M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z",
  plus: "M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z",
  chevron: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  grip: "M8 7h2v2H8V7zm0 4h2v2H8v-2zm0 4h2v2H8v-2zm6-8h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z",
  restart: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
};

const MDI_ICONS = [
  "server", "folder", "home", "wrench", "monitor", "database", "network", "shield", "cloud", "web"
];
const COLOR_OPTIONS = ["primary", "teal", "blue", "violet", "amber", "pink", "indigo", "emerald", "orange", "slate"];

const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  const randomPart = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}${randomPart}`.slice(0, 8);
};
const deepClone = (v) => JSON.parse(JSON.stringify(v));

/** Same-origin icon paths must not be document-relative (e.g. under /photos/), or the browser resolves them against the page path. */
function resolveServiceIconDisplaySrc(raw) {
  const t = String(raw ?? "").trim();
  if (!t) {
    return new URL("/static/assets/icons/default.svg", window.location.origin).href;
  }
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  if (t.startsWith("//")) {
    return `${window.location.protocol}${t}`;
  }
  const path = t.startsWith("/") ? t : `/${t}`;
  return new URL(path, window.location.origin).href;
}

/** Normalize app-internal cache path from API or config (always root-absolute, never document-relative). */
function normalizeAppIconPath(raw) {
  const t = String(raw ?? "").trim();
  if (!t || /^https?:\/\//i.test(t) || t.startsWith("//")) {
    return t;
  }
  return t.startsWith("/") ? t : `/${t}`;
}

function isProbablyExternalIconHref(raw) {
  const t = String(raw ?? "").trim();
  return /^https?:\/\//i.test(t) || t.startsWith("//");
}

/** Never use cross-origin http(s) as <img src> (CORP / NotSameOrigin). Same-origin paths or default only. */
function resolveIconSrcForImgTag(raw) {
  if (isProbablyExternalIconHref(raw)) {
    return resolveServiceIconDisplaySrc("");
  }
  return resolveServiceIconDisplaySrc(raw);
}

function serviceStoredIconSrcForDisplay(service) {
  if (!service) return resolveIconSrcForImgTag("");
  const c = service.cachedIcon ? normalizeAppIconPath(String(service.cachedIcon)) : "";
  const u = service.iconUrl ? String(service.iconUrl).trim() : "";
  let rawForImg = "";
  if (u && !isProbablyExternalIconHref(u)) rawForImg = normalizeAppIconPath(u);
  else if (c && !isProbablyExternalIconHref(c)) rawForImg = c;
  return resolveIconSrcForImgTag(rawForImg);
}

const RESTART_POLL_MS = 2000;
const RESTART_WAIT_MS = 120_000;
const RESTART_OK_WITHOUT_DOWN_MS = 12_000;
const DEFAULT_CATEGORY_ACCENT_STRENGTH = 15;

function normalizeCategoryAccentStrength(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CATEGORY_ACCENT_STRENGTH;
  const clamped = Math.min(100, Math.max(0, parsed));
  return Math.round(clamped / 5) * 5;
}

function applyCategoryAccentStrength(strength) {
  const normalized = normalizeCategoryAccentStrength(strength);
  document.body.style.setProperty("--category-accent-strength", `${normalized}%`);
}

async function waitForAppReadyAfterRestart() {
  const started = Date.now();
  let sawDown = false;
  while (Date.now() - started < RESTART_WAIT_MS) {
    await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
    let ok = false;
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      ok = res.ok;
    } catch {
      sawDown = true;
      continue;
    }
    if (!ok) {
      sawDown = true;
      continue;
    }
    if (sawDown || Date.now() - started >= RESTART_OK_WITHOUT_DOWN_MS) {
      location.reload();
      return;
    }
  }
  throw new Error("restart wait timeout");
}

function restartStatusContent() {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="restart-status">
      <span class="spinner" aria-hidden="true"></span>
      <p>${t("ui.restartingAppMessage")}</p>
    </div>
  `;
  return body;
}

function restartErrorContent(message) {
  const body = document.createElement("div");
  body.innerHTML = `<p>${message}</p><button type="button" class="btn">${t("ui.reloadPage")}</button>`;
  body.querySelector("button").addEventListener("click", () => location.reload());
  return body;
}

async function runAppRestartFromSettings() {
  showStatusModal({ content: restartStatusContent() });
  try {
    await api.restartApp();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    showStatusModal({
      content: restartErrorContent(`${t("ui.restartAppFailed")} ${detail}`)
    });
    return;
  }
  try {
    await waitForAppReadyAfterRestart();
  } catch {
    showStatusModal({
      content: restartErrorContent(t("ui.restartAppTimeout"))
    });
  }
}
const mdiPath = (name) => `/static/assets/icons/mdi/${name}.svg`;

function iconSvg(path, extraClass = "") {
  return `<svg class="${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"></path></svg>`;
}

function mdiIcon(name, extraClass = "") {
  return `<img class="${extraClass}" loading="lazy" src="${mdiPath(name)}" alt="" onerror="this.src='/static/assets/icons/default.svg';this.onerror=null;">`;
}

function button({ label = "", icon, dataAttr = "", variant = "", className = "", iconOnly = false }) {
  return `<button type="button" class="btn ${variant} ${className} ${iconOnly ? "btn--icon" : ""}" ${dataAttr}>${icon ? `<span class="btn__icon">${icon}</span>` : ""}${iconOnly ? "" : `<span class="btn__label">${label}</span>`}</button>`;
}

async function bootstrap() {
  const [config, settings, themes, languages] = await Promise.all([
    api.getConfig(),
    api.getSettings(),
    api.getThemes(),
    api.getLanguages()
  ]);
  state.config = config;
  state.settings = {
    ...state.settings,
    ...settings,
    categoryAccentStrength: normalizeCategoryAccentStrength(settings?.categoryAccentStrength)
  };
  state.themes = themes.themes;
  state.languages = languages.languages;
  await initI18n(state.settings.language);
  applyTheme(state.settings.theme);
  applyCategoryAccentStrength(state.settings.categoryAccentStrength);
  wireEvents();
  render();
}

function wireEvents() {
  elements.edit.addEventListener("click", () => {
    const nextEditMode = !state.editMode;
    if (nextEditMode && !state.editModeCollapsedSnapshot) {
      state.editModeCollapsedSnapshot = Object.fromEntries(
        (state.config.categories || []).map((category) => [category.id, Boolean(category.collapsed)])
      );
    }
    if (!nextEditMode && state.editModeCollapsedSnapshot) {
      for (const category of state.config.categories || []) {
        if (Object.hasOwn(state.editModeCollapsedSnapshot, category.id)) {
          category.collapsed = Boolean(state.editModeCollapsedSnapshot[category.id]);
        }
      }
      state.editModeCollapsedSnapshot = null;
    }
    state.editMode = nextEditMode;
    render();
  });
  elements.undo.addEventListener("click", undo);
  elements.settings.addEventListener("click", openSettingsModal);
  elements.addCategory?.addEventListener("click", () => openCategoryModal());
}

function pushUndo() {
  state.undoStack.push({
    config: deepClone(state.config),
    settings: deepClone(state.settings)
  });
  if (state.undoStack.length > 50) state.undoStack.shift();
}

async function persistConfig() {
  await api.saveConfig(state.config);
  state.config = await api.getConfig();
}

async function persistSettings() {
  await api.saveSettings(state.settings);
  state.settings = await api.getSettings();
}

async function undo() {
  const last = state.undoStack.pop();
  if (!last) return;
  state.config = last.config;
  state.settings = last.settings;
  await Promise.all([persistConfig(), persistSettings()]);
  await initI18n(state.settings.language);
  applyTheme(state.settings.theme);
  render();
}

function render() {
  applyCategoryAccentStrength(state.settings.categoryAccentStrength);
  document.documentElement.lang = state.settings.language || "en";
  document.title = state.settings.appTitle || "Start";
  elements.title.textContent = state.settings.appTitle || "Start";
  elements.undo.innerHTML = iconSvg(ICONS.undo, "inline-icon");
  elements.edit.innerHTML = iconSvg(ICONS.edit, "inline-icon");
  elements.settings.innerHTML = iconSvg(ICONS.settings, "inline-icon");
  elements.undo.title = t("ui.undo");
  elements.edit.title = t("ui.edit");
  elements.settings.title = t("ui.settings");
  elements.undo.setAttribute("aria-label", t("ui.undo"));
  elements.edit.setAttribute("aria-label", t("ui.edit"));
  elements.settings.setAttribute("aria-label", t("ui.settings"));
  elements.edit.classList.toggle("is-active", state.editMode);
  elements.undo.classList.toggle("hidden", !state.editMode || state.undoStack.length === 0);
  elements.addCategory.classList.add("hidden");
  elements.categories.innerHTML = "";

  for (const category of state.config.categories) {
    elements.categories.append(renderCategory(category));
  }
  if (state.editMode) {
    elements.categories.append(renderAddCategoryCard());
  }

  setupDragDrop({
    root: elements.categories,
    enabled: state.editMode,
    onMoveService: moveService,
    onMoveCategory: moveCategory
  });
}

function renderCategory(category) {
  const isCollapsed = state.editMode ? false : Boolean(category.collapsed);
  const card = document.createElement("article");
  card.className = `category ${state.editMode ? "is-edit-mode" : ""}`;
  card.dataset.color = category.color || "primary";
  card.classList.toggle("is-collapsed", isCollapsed);
  card.innerHTML = `
    <div class="category-header">
      <button type="button" class="category-header-main" data-toggle-collapse>
        ${iconSvg(ICONS.chevron, `inline-icon collapse-arrow ${isCollapsed ? "is-collapsed" : ""}`)}
        ${mdiIcon(category.icon || "folder", "category-icon")}
        <span class="category-name">${category.name}</span>
      </button>
      <div class="category-actions ${state.editMode ? "" : "hidden"}">
        ${button({ label: t("ui.edit"), icon: iconSvg(ICONS.edit, "inline-icon"), dataAttr: "data-edit-category", variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
        ${button({ label: t("ui.reorder"), icon: iconSvg(ICONS.grip, "inline-icon"), dataAttr: "data-drag-category", variant: "btn--ghost", className: "btn--compact drag-handle", iconOnly: true })}
      </div>
    </div>
    <div class="category-content ${isCollapsed ? "is-collapsed" : ""}">
      <div data-services-container data-category-id="${category.id}" class="services"></div>
    </div>
    ${state.editMode ? renderAddServiceTile() : ""}
  `;
  card.dataset.categoryId = category.id;

  const servicesRoot = card.querySelector("[data-services-container]");
  const content = card.querySelector(".category-content");
  const arrow = card.querySelector(".collapse-arrow");
  for (const service of category.services || []) servicesRoot.append(renderService(category, service));
  syncCategoryContentHeight(content, isCollapsed);

  const toggleCollapse = async () => {
    if (state.editMode) return;
    const nextCollapsed = !category.collapsed;
    animateCategoryCollapse(content, arrow, nextCollapsed);
    category.collapsed = nextCollapsed;
    card.classList.toggle("is-collapsed", nextCollapsed);
    await persistConfig();
  };
  card.querySelector("[data-toggle-collapse]").addEventListener("click", async (event) => {
    event.stopPropagation();
    await toggleCollapse();
  });
  card.addEventListener("click", async (event) => {
    if (!category.collapsed || state.editMode) return;
    const interactive = event.target.closest("button, a, input, select, textarea, .service, .category-actions");
    if (interactive) return;
    await toggleCollapse();
  });
  card.querySelector("[data-add-service]")?.addEventListener("click", () => openServiceModal(category.id));
  card.querySelector("[data-edit-category]")?.addEventListener("click", () => openCategoryModal(category));
  return card;
}

function syncCategoryContentHeight(content, collapsed) {
  if (!content) return;
  content.dataset.collapsed = collapsed ? "true" : "false";
  content.classList.toggle("is-collapsed", collapsed);
  if (collapsed) {
    content.style.maxHeight = "0px";
  } else {
    content.style.maxHeight = "none";
  }
}

function animateCategoryCollapse(content, arrow, collapsed) {
  if (!content || !arrow) return;
  content.classList.add("is-animating");
  content.dataset.collapsed = collapsed ? "true" : "false";
  content.classList.toggle("is-collapsed", collapsed);
  arrow.classList.toggle("is-collapsed", collapsed);

  if (collapsed) {
    const fullHeight = content.scrollHeight;
    content.style.maxHeight = `${fullHeight}px`;
    // Force layout so the browser picks up the start height before animating.
    content.getBoundingClientRect();
    content.style.maxHeight = "0px";
  } else {
    content.style.maxHeight = "0px";
    // Force layout so opening always starts from collapsed state.
    content.getBoundingClientRect();
    const fullHeight = content.scrollHeight;
    content.style.maxHeight = `${fullHeight}px`;
  }

  const onTransitionEnd = (event) => {
    if (event.propertyName !== "max-height") return;
    content.classList.remove("is-animating");
    if (!collapsed) {
      // Keep expanded cards flexible for later content changes/responsive wrap.
      content.style.maxHeight = "none";
    }
    content.removeEventListener("transitionend", onTransitionEnd);
  };

  content.addEventListener("transitionend", onTransitionEnd);
}

function renderService(category, service) {
  const item = document.createElement("div");
  item.className = `service ${state.editMode ? "is-edit-mode" : ""}`;
  item.dataset.categoryId = category.id;
  item.dataset.serviceId = service.id;

  const target = service.openMode === "current-tab" ? "_self" : "_blank";
  const iconPath = serviceStoredIconSrcForDisplay(service);
  item.innerHTML = `
    <a class="service-left" href="${service.url}" target="${target}" rel="noreferrer">
      <img loading="lazy" src="${iconPath}" alt="" />
      <span class="service-name">${service.name}</span>
    </a>
    <div class="service-actions ${state.editMode ? "" : "hidden"}">
      ${button({ label: t("ui.edit"), icon: iconSvg(ICONS.edit, "inline-icon"), dataAttr: "data-edit-service", variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
      ${button({ label: t("ui.reorder"), icon: iconSvg(ICONS.grip, "inline-icon"), dataAttr: "data-drag-service", variant: "btn--ghost", className: "btn--compact drag-handle", iconOnly: true })}
    </div>
  `;

  item.querySelector("[data-edit-service]").addEventListener("click", () => openServiceModal(category.id, service));
  return item;
}

function renderAddCategoryCard() {
  const card = document.createElement("article");
  card.className = "category category--add";
  card.innerHTML = `
    <button type="button" class="btn btn--ghost category-add-card" data-add-category>
      <span class="btn__icon">${iconSvg(ICONS.plus, "inline-icon")}</span>
      <span class="btn__label">${t("ui.addCategory")}</span>
    </button>
  `;
  card.querySelector("[data-add-category]").addEventListener("click", () => openCategoryModal());
  return card;
}

function renderAddServiceTile() {
  return `
    <button type="button" class="service service--add" data-add-service>
      <span class="service-left">
        <span class="btn__icon">${iconSvg(ICONS.plus, "inline-icon")}</span>
        <span class="service-name">${t("ui.addService")}</span>
      </span>
    </button>
  `;
}

function openCategoryModal(category = null) {
  const isEdit = Boolean(category);
  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.name")}</label>
      <input name="name" value="${category?.name || ""}" required />
    </div>
    <div class="form-row icon-search">
      <label>${t("ui.icon")}</label>
      <div>
        <input name="icon" value="${category?.icon || "folder"}" autocomplete="off" />
        <div class="icon-search-results" data-icon-results></div>
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.categoryColor")}</label>
      <div>
        <div class="color-options">
          ${COLOR_OPTIONS.map((color) => `<button type="button" class="color-dot ${(category?.color || "primary") === color ? "is-active" : ""}" data-color="${color}" data-color-pick="${color}"></button>`).join("")}
        </div>
        <input type="hidden" name="color" value="${category?.color || "primary"}" />
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.collapsed")}</label>
      <label class="toggle-switch">
        <input name="collapsed" type="checkbox" ${category?.collapsed ? "checked" : ""} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
  `;

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.category")}` : t("ui.addCategory"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    leadingActions: isEdit ? [{
      label: t("ui.delete"),
      icon: ICONS.trash,
      onClick: async () => {
        pushUndo();
        state.config.categories = state.config.categories.filter((c) => c.id !== category.id);
        await persistConfig();
        render();
      }
    }] : [],
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      pushUndo();
      if (isEdit) {
        category.name = fd.get("name");
        category.icon = fd.get("icon");
        category.color = fd.get("color");
        category.collapsed = form.querySelector("input[name='collapsed']").checked;
      } else {
        state.config.categories.push({
          id: uid(),
          name: fd.get("name"),
          icon: fd.get("icon"),
          color: fd.get("color"),
          collapsed: form.querySelector("input[name='collapsed']").checked,
          services: []
        });
      }
      await persistConfig();
      render();
    }
  });

  const input = form.querySelector("input[name='icon']");
  const results = form.querySelector("[data-icon-results]");
  const renderIconResults = () => {
    const query = String(input.value || "").toLowerCase();
    const filtered = MDI_ICONS.filter((name) => name.includes(query)).slice(0, 8);
    results.innerHTML = filtered
      .map((name) => `<button type="button" class="icon-search-item" data-icon-pick="${name}">${mdiIcon(name, "icon-preview")}<span>${name}</span></button>`)
      .join("");
    results.querySelectorAll("[data-icon-pick]").forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        input.value = buttonEl.dataset.iconPick;
        renderIconResults();
      });
    });
  };
  input.addEventListener("input", renderIconResults);
  form.querySelectorAll("[data-color-pick]").forEach((colorButton) => {
    colorButton.addEventListener("click", () => {
      form.querySelector("input[name='color']").value = colorButton.dataset.color;
      form.querySelectorAll("[data-color-pick]").forEach((entry) => entry.classList.remove("is-active"));
      colorButton.classList.add("is-active");
    });
  });
  renderIconResults();
}

function openServiceModal(categoryId, service = null) {
  const category = state.config.categories.find((c) => c.id === categoryId);
  if (!category) return;
  const isEdit = Boolean(service);
  const form = document.createElement("form");
  const previewImgSrc = service ? serviceStoredIconSrcForDisplay(service) : resolveIconSrcForImgTag("");
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.name")}</label>
      <input name="name" value="${service?.name || ""}" required />
    </div>
    <div class="form-row">
      <label>${t("ui.url")}</label>
      <input name="url" type="url" value="${service?.url || ""}" required />
    </div>
    <div class="form-row">
      <label>${t("ui.iconUrl")}</label>
      <div>
        <div class="icon-url-controls">
          <input name="iconUrl" value="${service?.iconUrl || ""}" />
          <div class="icon-preview-box">
            <span id="favicon-spinner" class="spinner hidden" aria-hidden="true"></span>
            <img id="favicon-preview" class="icon-preview" src="${previewImgSrc}" alt="" />
          </div>
          <button type="button" class="btn btn--ghost btn--compact" data-fetch-favicon>${t("ui.fetchFavicon")}</button>
        </div>
        <small id="favicon-status"></small>
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.openMode")}</label>
      <select name="openMode">
        <option value="current-tab" ${service?.openMode !== "new-tab" ? "selected" : ""}>${t("ui.currentTab")}</option>
        <option value="new-tab" ${service?.openMode === "new-tab" ? "selected" : ""}>${t("ui.newTab")}</option>
      </select>
    </div>
  `;

  if (service?.cachedIcon) {
    form.dataset.cachedIcon = normalizeAppIconPath(service.cachedIcon);
  }

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.service")}` : t("ui.addService"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    leadingActions: isEdit ? [{
      label: t("ui.delete"),
      icon: ICONS.trash,
      onClick: async () => {
        pushUndo();
        category.services = category.services.filter((s) => s.id !== service.id);
        await persistConfig();
        render();
      }
    }] : [],
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      const iconUrl = String(fd.get("iconUrl") || "").trim();
      let cachedIcon = form.dataset.cachedIcon ? normalizeAppIconPath(String(form.dataset.cachedIcon)) : "";
      if (iconUrl.startsWith("/static/assets/favicon-cache/")) {
        cachedIcon = "";
      }

      pushUndo();
      if (isEdit) {
        service.name = fd.get("name");
        service.url = fd.get("url");
        service.iconUrl = iconUrl;
        service.cachedIcon = cachedIcon;
        service.openMode = fd.get("openMode");
      } else {
        category.services.push({
          id: uid(),
          name: fd.get("name"),
          url: fd.get("url"),
          iconUrl,
          cachedIcon,
          openMode: fd.get("openMode")
        });
      }
      await persistConfig();
      render();
    }
  });

  const iconUrlInput = form.querySelector("input[name='iconUrl']");
  const urlInput = form.querySelector("input[name='url']");
  const fetchFaviconButton = form.querySelector("[data-fetch-favicon]");
  const status = form.querySelector("#favicon-status");
  const spinner = form.querySelector("#favicon-spinner");
  const preview = form.querySelector("#favicon-preview");

  const syncIconPreviewFromField = () => {
    const v = String(iconUrlInput.value || "").trim();
    const cached = form.dataset.cachedIcon ? normalizeAppIconPath(String(form.dataset.cachedIcon)) : "";
    const vOk = v && !isProbablyExternalIconHref(v);
    const cOk = cached && !isProbablyExternalIconHref(cached);
    const vExt = v && isProbablyExternalIconHref(v);

    let rawForImg = "";
    if (vOk) rawForImg = normalizeAppIconPath(v);
    else if (vExt && cOk) rawForImg = cached;
    else if (cOk) rawForImg = cached;

    preview.src = resolveIconSrcForImgTag(rawForImg);
  };

  iconUrlInput.addEventListener("input", () => {
    delete form.dataset.cachedIcon;
    syncIconPreviewFromField();
  });

  const triggerFaviconLoad = async () => {
    const value = String(urlInput.value || "").trim();
    if (!value) return;
    fetchFaviconButton.disabled = true;
    state.faviconLoading = true;
    spinner.classList.remove("hidden");
    status.textContent = t("ui.fetchingIcon");
    try {
      const result = await api.cacheFavicon(value);
      const path = normalizeAppIconPath(String(result.path || "").trim());
      if (!path.startsWith("/static/assets/favicon-cache/")) {
        throw new Error("Missing cache path");
      }
      iconUrlInput.value = path;
      delete form.dataset.cachedIcon;
      syncIconPreviewFromField();
      status.textContent = "";
    } catch (_) {
      status.textContent = t("ui.faviconFailed");
      preview.src = resolveServiceIconDisplaySrc("");
    } finally {
      fetchFaviconButton.disabled = false;
      state.faviconLoading = false;
      spinner.classList.add("hidden");
    }
  };

  fetchFaviconButton.addEventListener("click", triggerFaviconLoad);
  syncIconPreviewFromField();
}

function openSettingsModal() {
  const form = document.createElement("form");
  form.className = "settings-form";
  const currentStrength = normalizeCategoryAccentStrength(state.settings.categoryAccentStrength);
  const currentStrengthPercent = `${currentStrength}%`;
  const themeButtons = state.themes
    .map((theme) => `<button type="button" class="theme-option ${state.settings.theme === theme ? "active" : ""}" data-theme="${theme}">${theme}</button>`)
    .join("");
  const languageOptions = state.languages
    .map((lang) => `<option value="${lang.code}" ${state.settings.language === lang.code ? "selected" : ""}>${lang.name}</option>`)
    .join("");
  form.innerHTML = `
    <div class="form-row">
      <label>${t("ui.name")}</label>
      <input name="appTitle" value="${state.settings.appTitle || "Start"}" />
    </div>
    <div class="form-row">
      <label>${t("ui.theme")}</label>
      <div>
        <div class="theme-options theme-picker">${themeButtons}</div>
        <input name="theme" value="${state.settings.theme}" hidden />
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.language")}</label>
      <div class="select-wrap">
        <select name="language">${languageOptions}</select>
        <span class="select-chevron">${iconSvg(ICONS.chevron, "inline-icon")}</span>
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.categoryAccentStrength")}</label>
      <div class="range-control" style="--range-percent:${currentStrengthPercent}">
        <input name="categoryAccentStrength" type="range" min="0" max="100" step="5" value="${currentStrength}" />
        <small class="range-value" data-category-accent-strength-value style="left:${currentStrengthPercent}">${currentStrengthPercent}</small>
      </div>
    </div>
    <div class="form-row settings-actions-block" role="group" aria-labelledby="settings-actions-heading">
      <label id="settings-actions-heading" for="restart-app-btn">${t("ui.actions")}</label>
      <div>
        <button type="button" class="btn btn--ghost" id="restart-app-btn" data-restart-app><span class="btn__icon">${iconSvg(ICONS.restart, "inline-icon")}</span><span class="btn__label">${t("ui.restartApp")}</span></button>
      </div>
    </div>
  `;
  form.querySelector("[data-restart-app]")?.addEventListener("click", () => {
    void runAppRestartFromSettings();
  });
  let persistTimer = null;
  let persistChain = Promise.resolve();
  const scheduleSettingsPersist = (delayMs = 250) => {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      const snapshot = deepClone(state.settings);
      persistChain = persistChain
        .then(async () => {
          await api.saveSettings(snapshot);
          const fresh = await api.getSettings();
          state.settings = {
            ...state.settings,
            ...fresh,
            categoryAccentStrength: normalizeCategoryAccentStrength(fresh?.categoryAccentStrength)
          };
          applyTheme(state.settings.theme);
          applyCategoryAccentStrength(state.settings.categoryAccentStrength);
          await initI18n(state.settings.language);
          render();
        })
        .catch(() => {});
    }, delayMs);
  };
  form.querySelector("input[name='appTitle']")?.addEventListener("input", (event) => {
    state.settings.appTitle = event.target.value || "Start";
    render();
    scheduleSettingsPersist();
  });
  form.querySelector("select[name='language']")?.addEventListener("change", (event) => {
    state.settings.language = event.target.value;
    scheduleSettingsPersist(0);
  });
  form.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      form.querySelector("input[name='theme']").value = button.dataset.theme;
      form.querySelectorAll("[data-theme]").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.settings.theme = button.dataset.theme;
      applyTheme(state.settings.theme);
      scheduleSettingsPersist(0);
    });
  });
  const categoryAccentStrengthInput = form.querySelector("input[name='categoryAccentStrength']");
  const categoryAccentStrengthValue = form.querySelector("[data-category-accent-strength-value]");
  categoryAccentStrengthInput?.addEventListener("input", () => {
    const normalized = normalizeCategoryAccentStrength(categoryAccentStrengthInput.value);
    const normalizedPercent = `${normalized}%`;
    const rangeControl = categoryAccentStrengthInput.closest(".range-control");
    categoryAccentStrengthInput.value = String(normalized);
    if (rangeControl) rangeControl.style.setProperty("--range-percent", normalizedPercent);
    categoryAccentStrengthValue.textContent = normalizedPercent;
    categoryAccentStrengthValue.style.left = normalizedPercent;
    state.settings.categoryAccentStrength = normalized;
    applyCategoryAccentStrength(normalized);
    scheduleSettingsPersist();
  });

  showModal({
    title: t("ui.settings"),
    content: form,
    cancelLabel: t("ui.close"),
    showSave: false,
    cancelVariant: "",
    submitOnEnter: false,
    modalClass: "modal--settings"
  });
}

async function moveService(fromCategoryId, serviceId, toCategoryId, beforeServiceId) {
  if (!state.editMode) return;
  const source = state.config.categories.find((c) => c.id === fromCategoryId);
  const target = state.config.categories.find((c) => c.id === toCategoryId);
  if (!source || !target) return;
  const index = source.services.findIndex((s) => s.id === serviceId);
  if (index < 0) return;
  if (fromCategoryId === toCategoryId) {
    const currentPos = index;
    const targetPos = beforeServiceId ? target.services.findIndex((s) => s.id === beforeServiceId) : target.services.length;
    if (targetPos < 0 || currentPos === targetPos || currentPos + 1 === targetPos) return;
  }
  pushUndo();
  const [entry] = source.services.splice(index, 1);
  const insertAt = beforeServiceId ? target.services.findIndex((s) => s.id === beforeServiceId) : -1;
  target.services.splice(insertAt >= 0 ? insertAt : target.services.length, 0, entry);
  await persistConfig();
  render();
}

async function moveCategory(categoryId, beforeCategoryId) {
  const list = state.config.categories;
  const from = list.findIndex((entry) => entry.id === categoryId);
  if (from < 0) return;
  const targetIndex = beforeCategoryId ? list.findIndex((entry) => entry.id === beforeCategoryId) : list.length;
  if (targetIndex < 0 || from === targetIndex || from + 1 === targetIndex) return;
  pushUndo();
  const [category] = list.splice(from, 1);
  const insertIndex = beforeCategoryId ? list.findIndex((entry) => entry.id === beforeCategoryId) : -1;
  list.splice(insertIndex >= 0 ? insertIndex : list.length, 0, category);
  await persistConfig();
  render();
}

bootstrap().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});
