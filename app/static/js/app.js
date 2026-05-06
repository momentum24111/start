import { api } from "./api.js";
import { showModal, showStatusModal } from "./modal.js";
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
  arrowLeft: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  arrowRight: "m8.59 16.59 1.41 1.41L16 12 10 6 8.59 7.41 13.17 12z",
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
  updateDocumentLanguage();
  updateAppTitleUI();
  elements.undo.innerHTML = iconSvg(ICONS.undo, "inline-icon");
  elements.edit.innerHTML = iconSvg(ICONS.edit, "inline-icon");
  elements.settings.innerHTML = iconSvg(ICONS.settings, "inline-icon");
  updateTopbarActionTexts();
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
}

function updateDocumentLanguage() {
  document.documentElement.lang = state.settings.language || "en";
}

function updateAppTitleUI() {
  const title = state.settings.appTitle || "Start";
  document.title = title;
  elements.title.textContent = title;
}

function updateTopbarActionTexts() {
  elements.undo.title = t("ui.undo");
  elements.edit.title = t("ui.edit");
  elements.settings.title = t("ui.settings");
  elements.undo.setAttribute("aria-label", t("ui.undo"));
  elements.edit.setAttribute("aria-label", t("ui.edit"));
  elements.settings.setAttribute("aria-label", t("ui.settings"));
}

function refreshStaticLocalizedTexts() {
  updateDocumentLanguage();
  updateTopbarActionTexts();
  document.querySelectorAll("[data-add-service] .service-name").forEach((entry) => {
    entry.textContent = t("ui.addService");
  });
  document.querySelectorAll("[data-add-category] .btn__label").forEach((entry) => {
    entry.textContent = t("ui.addCategory");
  });
}

function refreshSettingsModalTexts(form) {
  if (!form) return;
  const modalTitle = form.closest(".modal")?.querySelector("h2");
  if (modalTitle) modalTitle.textContent = t("ui.settings");
  form.querySelector("[data-settings-name-label]")?.replaceChildren(t("ui.name"));
  form.querySelector("[data-settings-theme-label]")?.replaceChildren(t("ui.theme"));
  form.querySelector("[data-settings-language-label]")?.replaceChildren(t("ui.language"));
  form.querySelector("[data-settings-accent-label]")?.replaceChildren(t("ui.categoryAccentStrength"));
  form.querySelector("[data-settings-actions-label]")?.replaceChildren(t("ui.actions"));
  form.querySelector("[data-settings-restart-label]")?.replaceChildren(t("ui.restartApp"));
  form.closest(".modal")?.querySelector("[data-cancel] .btn__label")?.replaceChildren(t("ui.close"));
}

function renderCategory(category) {
  const categoryIndex = state.config.categories.findIndex((entry) => entry.id === category.id);
  const canMoveLeft = categoryIndex > 0;
  const canMoveRight = categoryIndex >= 0 && categoryIndex < state.config.categories.length - 1;
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
        ${button({ label: t("ui.moveLeft"), icon: iconSvg(ICONS.arrowLeft, "inline-icon"), dataAttr: `data-move-category-left ${canMoveLeft ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
        ${button({ label: t("ui.moveRight"), icon: iconSvg(ICONS.arrowRight, "inline-icon"), dataAttr: `data-move-category-right ${canMoveRight ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
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
  card.querySelector("[data-move-category-left]")?.addEventListener("click", () => {
    void swapCategoryByStep(category.id, -1);
  });
  card.querySelector("[data-move-category-right]")?.addEventListener("click", () => {
    void swapCategoryByStep(category.id, 1);
  });
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
  const services = category.services || [];
  const serviceIndex = services.findIndex((entry) => entry.id === service.id);
  const canMoveLeft = serviceIndex > 0;
  const canMoveRight = serviceIndex >= 0 && serviceIndex < services.length - 1;
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
      ${button({ label: t("ui.moveLeft"), icon: iconSvg(ICONS.arrowLeft, "inline-icon"), dataAttr: `data-move-service-left ${canMoveLeft ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
      ${button({ label: t("ui.moveRight"), icon: iconSvg(ICONS.arrowRight, "inline-icon"), dataAttr: `data-move-service-right ${canMoveRight ? "" : "disabled"}`, variant: "btn--ghost", className: "btn--compact", iconOnly: true })}
    </div>
  `;

  item.querySelector("[data-edit-service]").addEventListener("click", () => openServiceModal(category.id, service));
  item.querySelector("[data-move-service-left]")?.addEventListener("click", () => {
    void swapServiceByStep(category.id, service.id, -1);
  });
  item.querySelector("[data-move-service-right]")?.addEventListener("click", () => {
    void swapServiceByStep(category.id, service.id, 1);
  });
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
    status.textContent = "";
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
      <label data-settings-name-label>${t("ui.name")}</label>
      <input name="appTitle" value="${state.settings.appTitle || "Start"}" />
    </div>
    <div class="form-row">
      <label data-settings-theme-label>${t("ui.theme")}</label>
      <div>
        <div class="theme-options theme-picker">${themeButtons}</div>
        <input name="theme" value="${state.settings.theme}" hidden />
      </div>
    </div>
    <div class="form-row">
      <label data-settings-language-label>${t("ui.language")}</label>
      <div class="select-wrap">
        <select name="language">${languageOptions}</select>
        <span class="select-chevron">${iconSvg(ICONS.chevron, "inline-icon")}</span>
      </div>
    </div>
    <div class="form-row form-row--range">
      <label data-settings-accent-label>${t("ui.categoryAccentStrength")}</label>
      <div class="range-control" style="--range-percent:${currentStrengthPercent}">
        <input name="categoryAccentStrength" type="range" min="0" max="100" step="5" value="${currentStrength}" />
        <small class="range-value" data-category-accent-strength-value style="left:${currentStrengthPercent}">${currentStrengthPercent}</small>
      </div>
    </div>
    <div class="form-row settings-actions-block" role="group" aria-labelledby="settings-actions-heading">
      <label id="settings-actions-heading" data-settings-actions-label for="restart-app-btn">${t("ui.actions")}</label>
      <div>
        <button type="button" class="btn btn--ghost" id="restart-app-btn" data-restart-app><span class="btn__icon">${iconSvg(ICONS.restart, "inline-icon")}</span><span class="btn__label" data-settings-restart-label>${t("ui.restartApp")}</span></button>
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
        })
        .catch(() => {});
    }, delayMs);
  };
  form.querySelector("input[name='appTitle']")?.addEventListener("input", (event) => {
    state.settings.appTitle = event.target.value || "Start";
    updateAppTitleUI();
    scheduleSettingsPersist();
  });
  form.querySelector("select[name='language']")?.addEventListener("change", async (event) => {
    state.settings.language = event.target.value;
    await initI18n(state.settings.language);
    refreshStaticLocalizedTexts();
    refreshSettingsModalTexts(form);
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
  const showRangeTooltip = () => categoryAccentStrengthValue.classList.add("is-visible");
  const hideRangeTooltip = () => categoryAccentStrengthValue.classList.remove("is-visible");
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
  categoryAccentStrengthInput?.addEventListener("pointerdown", showRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("pointerup", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("pointercancel", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("blur", hideRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("keydown", showRangeTooltip);
  categoryAccentStrengthInput?.addEventListener("keyup", hideRangeTooltip);

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

function captureElementPositions(selector, keyBuilder) {
  const map = new Map();
  document.querySelectorAll(selector).forEach((element) => {
    const key = keyBuilder(element);
    if (!key) return;
    map.set(key, element.getBoundingClientRect());
  });
  return map;
}

function animatePositionChanges(selector, keyBuilder) {
  const before = captureElementPositions(selector, keyBuilder);
  render();
  const after = captureElementPositions(selector, keyBuilder);
  const afterElements = new Map();
  document.querySelectorAll(selector).forEach((entry) => {
    const key = keyBuilder(entry);
    if (!key) return;
    afterElements.set(key, entry);
  });
  for (const [key, oldRect] of before) {
    const nextRect = after.get(key);
    if (!nextRect) continue;
    const element = afterElements.get(key);
    if (!element) continue;
    const deltaX = oldRect.left - nextRect.left;
    const deltaY = oldRect.top - nextRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
    element.classList.add("is-swap-animating");
    const keyframes = [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: "translate(0px, 0px)" }
    ];
    const timing = { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    if (typeof element.animate === "function") {
      const animation = element.animate(keyframes, timing);
      animation.addEventListener("finish", () => {
        element.classList.remove("is-swap-animating");
      });
      animation.addEventListener("cancel", () => {
        element.classList.remove("is-swap-animating");
      });
      continue;
    }
    element.style.transform = keyframes[0].transform;
    element.getBoundingClientRect();
    element.style.transform = keyframes[1].transform;
    window.setTimeout(() => {
      element.classList.remove("is-swap-animating");
      element.style.transform = "";
    }, timing.duration + 30);
  }
}

async function swapCategoryByStep(categoryId, step) {
  if (!state.editMode) return;
  const list = state.config.categories;
  const from = list.findIndex((entry) => entry.id === categoryId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;
  pushUndo();
  [list[from], list[to]] = [list[to], list[from]];
  await persistConfig();
  animatePositionChanges(".category[data-category-id]", (element) => `category-${element.dataset.categoryId}`);
}

async function swapServiceByStep(categoryId, serviceId, step) {
  if (!state.editMode) return;
  const category = state.config.categories.find((entry) => entry.id === categoryId);
  if (!category) return;
  const list = category.services || [];
  const from = list.findIndex((entry) => entry.id === serviceId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;
  pushUndo();
  [list[from], list[to]] = [list[to], list[from]];
  await persistConfig();
  animatePositionChanges(
    `.category[data-category-id="${categoryId}"] .service[data-service-id]`,
    (element) => `service-${categoryId}-${element.dataset.serviceId}`
  );
}

bootstrap().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});
