import { api } from "./api.js";
import { showModal } from "./modal.js";
import { setupDragDrop } from "./dragdrop.js";
import { initI18n, t } from "./i18n.js";
import { applyTheme } from "./themes.js";

const state = {
  config: { categories: [] },
  settings: { appTitle: "Start", theme: "dark", language: "en" },
  editMode: false,
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
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-9.04c.39-.39.39-1.02 0-1.41l-2.5-2.5a.996.996 0 1 0-1.41 1.41l2.5 2.5c.39.39 1.03.39 1.42 0z",
  done: "M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z",
  settings: "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a6.9 6.9 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z",
  trash: "M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z",
  plus: "M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z",
  chevron: "M9.29 6.71 13.58 11 9.29 15.29 10.71 16.71 16.41 11 10.71 5.29z",
  external: "M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"
};

const MDI_ICONS = [
  "server", "folder", "home", "wrench", "monitor", "database", "network", "shield", "cloud", "web"
];

const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  const randomPart = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}${randomPart}`.slice(0, 8);
};
const deepClone = (v) => JSON.parse(JSON.stringify(v));
const mdiPath = (name) => `/static/assets/icons/mdi/${name}.svg`;

function iconSvg(path, extraClass = "") {
  return `<svg class="${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"></path></svg>`;
}

function mdiIcon(name, extraClass = "") {
  return `<img class="${extraClass}" loading="lazy" src="${mdiPath(name)}" alt="" onerror="this.src='/static/assets/icons/default.svg';this.onerror=null;">`;
}

function button({ label, icon, dataAttr = "", variant = "", className = "" }) {
  return `<button type="button" class="btn ${variant} ${className}" ${dataAttr}>${icon ? `<span class="btn__icon">${icon}</span>` : ""}<span class="btn__label">${label}</span></button>`;
}

async function bootstrap() {
  const [config, settings, themes, languages] = await Promise.all([
    api.getConfig(),
    api.getSettings(),
    api.getThemes(),
    api.getLanguages()
  ]);
  state.config = config;
  state.settings = settings;
  state.themes = themes.themes;
  state.languages = languages.languages;
  await initI18n(state.settings.language);
  applyTheme(state.settings.theme);
  wireEvents();
  render();
}

function wireEvents() {
  elements.edit.addEventListener("click", () => {
    state.editMode = !state.editMode;
    render();
  });
  elements.undo.addEventListener("click", undo);
  elements.settings.addEventListener("click", openSettingsModal);
  elements.addCategory.addEventListener("click", () => openCategoryModal());
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
}

async function persistSettings() {
  await api.saveSettings(state.settings);
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
  document.documentElement.lang = state.settings.language || "en";
  document.title = state.settings.appTitle || "Start";
  elements.title.textContent = state.settings.appTitle || "Start";
  elements.undo.innerHTML = `${iconSvg(ICONS.undo, "inline-icon")}<span class="btn__label">${t("ui.undo")}</span>`;
  elements.edit.innerHTML = `${iconSvg(state.editMode ? ICONS.done : ICONS.edit, "inline-icon")}<span class="btn__label">${state.editMode ? t("ui.done") : t("ui.edit")}</span>`;
  elements.settings.innerHTML = `${iconSvg(ICONS.settings, "inline-icon")}<span class="btn__label">${t("ui.settings")}</span>`;
  elements.undo.classList.toggle("hidden", state.undoStack.length === 0);
  elements.addCategory.classList.toggle("hidden", !state.editMode);
  elements.addCategory.title = t("ui.addCategory");
  elements.addCategory.innerHTML = `${iconSvg(ICONS.plus, "inline-icon")}<span class="btn__label">${t("ui.addCategory")}</span>`;
  elements.categories.innerHTML = "";

  for (const category of state.config.categories) {
    elements.categories.append(renderCategory(category));
  }

  setupDragDrop({
    root: elements.categories,
    enabled: state.editMode,
    onMove: moveService
  });
}

function renderCategory(category) {
  const card = document.createElement("article");
  card.className = "category";
  card.innerHTML = `
    <div class="category-header">
      <div class="category-title">
        ${mdiIcon(category.icon || "folder", "category-icon")}
        ${button({ label: category.name, icon: iconSvg(ICONS.chevron, "inline-icon"), dataAttr: "data-toggle-collapse", variant: "btn--ghost" })}
      </div>
      <div class="category-actions ${state.editMode ? "" : "hidden"}">
        ${button({ label: t("ui.edit"), icon: iconSvg(ICONS.edit, "inline-icon"), dataAttr: "data-edit-category", variant: "btn--ghost" })}
        ${button({ label: t("ui.delete"), icon: iconSvg(ICONS.trash, "inline-icon"), dataAttr: "data-delete-category", variant: "btn--ghost" })}
      </div>
    </div>
    <div data-services-container data-category-id="${category.id}" class="services ${category.collapsed ? "hidden" : ""}"></div>
    ${button({ label: t("ui.addService"), icon: iconSvg(ICONS.plus, "inline-icon"), dataAttr: "data-add-service", className: `add-service-btn ${state.editMode ? "" : "hidden"}` })}
  `;

  const servicesRoot = card.querySelector("[data-services-container]");
  for (const service of category.services || []) servicesRoot.append(renderService(category, service));

  card.querySelector("[data-toggle-collapse]").addEventListener("click", async () => {
    category.collapsed = !category.collapsed;
    await persistConfig();
    render();
  });
  card.querySelector("[data-add-service]").addEventListener("click", () => openServiceModal(category.id));
  card.querySelector("[data-edit-category]").addEventListener("click", () => openCategoryModal(category));
  card.querySelector("[data-delete-category]").addEventListener("click", async () => {
    pushUndo();
    state.config.categories = state.config.categories.filter((c) => c.id !== category.id);
    await persistConfig();
    render();
  });
  return card;
}

function renderService(category, service) {
  const item = document.createElement("div");
  item.className = "service";
  item.dataset.categoryId = category.id;
  item.dataset.serviceId = service.id;

  const target = service.openMode === "current-tab" ? "_self" : "_blank";
  const iconPath = service.cachedIcon || service.iconUrl || "/static/assets/icons/default.svg";
  item.innerHTML = `
    <a class="service-left" href="${service.url}" target="${target}" rel="noreferrer">
      <img loading="lazy" src="${iconPath}" alt="" />
      <span class="service-name">${service.name}</span>
      <span class="btn__icon">${iconSvg(ICONS.external, "inline-icon")}</span>
    </a>
    <div class="service-actions ${state.editMode ? "" : "hidden"}">
      ${button({ label: t("ui.edit"), icon: iconSvg(ICONS.edit, "inline-icon"), dataAttr: "data-edit-service", variant: "btn--ghost" })}
      ${button({ label: t("ui.delete"), icon: iconSvg(ICONS.trash, "inline-icon"), dataAttr: "data-delete-service", variant: "btn--ghost" })}
    </div>
  `;

  item.querySelector("[data-edit-service]").addEventListener("click", () => openServiceModal(category.id, service));
  item.querySelector("[data-delete-service]").addEventListener("click", async () => {
    pushUndo();
    category.services = category.services.filter((s) => s.id !== service.id);
    await persistConfig();
    render();
  });
  return item;
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
      <label>${t("ui.collapsed")}</label>
      <select name="collapsed">
        <option value="false">false</option>
        <option value="true" ${category?.collapsed ? "selected" : ""}>true</option>
      </select>
    </div>
  `;

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.category")}` : t("ui.addCategory"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      pushUndo();
      if (isEdit) {
        category.name = fd.get("name");
        category.icon = fd.get("icon");
        category.collapsed = fd.get("collapsed") === "true";
      } else {
        state.config.categories.push({
          id: uid(),
          name: fd.get("name"),
          icon: fd.get("icon"),
          color: "primary",
          collapsed: fd.get("collapsed") === "true",
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
  renderIconResults();
}

function openServiceModal(categoryId, service = null) {
  const category = state.config.categories.find((c) => c.id === categoryId);
  if (!category) return;
  const isEdit = Boolean(service);
  const form = document.createElement("form");
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
        <input name="iconUrl" type="url" value="${service?.iconUrl || ""}" />
        <div class="favicon-row">
          <span id="favicon-spinner" class="spinner hidden"></span>
          <img id="favicon-preview" class="icon-preview" src="${service?.cachedIcon || service?.iconUrl || "/static/assets/icons/default.svg"}" alt="" />
          <small id="favicon-status"></small>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>${t("ui.openMode")}</label>
      <select name="openMode">
        <option value="new-tab" ${service?.openMode !== "current-tab" ? "selected" : ""}>${t("ui.newTab")}</option>
        <option value="current-tab" ${service?.openMode === "current-tab" ? "selected" : ""}>${t("ui.currentTab")}</option>
      </select>
    </div>
  `;

  showModal({
    title: isEdit ? `${t("ui.edit")} ${t("ui.service")}` : t("ui.addService"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      const iconUrl = String(fd.get("iconUrl") || "");
      const cachedIcon = form.dataset.cachedIcon || service?.cachedIcon || "";

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
  const status = form.querySelector("#favicon-status");
  const spinner = form.querySelector("#favicon-spinner");
  const preview = form.querySelector("#favicon-preview");
  let faviconTimer = 0;

  const triggerFaviconLoad = async () => {
    const value = String(iconUrlInput.value || "").trim();
    if (!value) return;
    state.faviconLoading = true;
    spinner.classList.remove("hidden");
    status.textContent = t("ui.fetchingIcon");
    try {
      const result = await api.cacheFavicon(value);
      form.dataset.cachedIcon = result.path;
      preview.src = result.path;
      status.textContent = "";
    } catch (_) {
      status.textContent = t("ui.faviconFailed");
    } finally {
      state.faviconLoading = false;
      spinner.classList.add("hidden");
    }
  };

  iconUrlInput.addEventListener("input", () => {
    window.clearTimeout(faviconTimer);
    faviconTimer = window.setTimeout(() => {
      triggerFaviconLoad();
    }, 350);
  });
}

function openSettingsModal() {
  const form = document.createElement("form");
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
      <div class="theme-options">${themeButtons}</div>
      <input name="theme" value="${state.settings.theme}" hidden />
    </div>
    <div class="form-row">
      <label>${t("ui.language")}</label>
      <select name="language">${languageOptions}</select>
    </div>
  `;
  form.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      form.querySelector("input[name='theme']").value = button.dataset.theme;
      form.querySelectorAll("[data-theme]").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
    });
  });

  showModal({
    title: t("ui.settings"),
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      if (!form.reportValidity()) return false;
      const fd = new FormData(form);
      pushUndo();
      state.settings.appTitle = fd.get("appTitle");
      state.settings.theme = fd.get("theme");
      state.settings.language = fd.get("language");
      await persistSettings();
      applyTheme(state.settings.theme);
      await initI18n(state.settings.language);
      render();
    }
  });
}

async function moveService(fromCategoryId, serviceId, toCategoryId, beforeServiceId) {
  if (!state.editMode) return;
  if (fromCategoryId === toCategoryId && !beforeServiceId) return;
  const source = state.config.categories.find((c) => c.id === fromCategoryId);
  const target = state.config.categories.find((c) => c.id === toCategoryId);
  if (!source || !target) return;
  const index = source.services.findIndex((s) => s.id === serviceId);
  if (index < 0) return;
  const [entry] = source.services.splice(index, 1);
  const insertAt = beforeServiceId ? target.services.findIndex((s) => s.id === beforeServiceId) : -1;
  target.services.splice(insertAt >= 0 ? insertAt : target.services.length, 0, entry);
  await persistConfig();
  render();
}

bootstrap().catch((error) => {
  document.body.innerHTML = `<pre>${error.message}</pre>`;
});
