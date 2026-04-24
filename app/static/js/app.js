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
  languages: []
};

const elements = {
  title: document.getElementById("app-title"),
  categories: document.getElementById("categories"),
  addCategory: document.getElementById("add-category-btn"),
  undo: document.getElementById("undo-btn"),
  edit: document.getElementById("edit-btn"),
  settings: document.getElementById("settings-btn")
};

const uid = () => crypto.randomUUID().slice(0, 8);
const deepClone = (v) => JSON.parse(JSON.stringify(v));

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
  elements.undo.textContent = t("ui.undo");
  elements.edit.textContent = state.editMode ? t("ui.done") : t("ui.edit");
  elements.settings.textContent = t("ui.settings");
  elements.undo.classList.toggle("hidden", state.undoStack.length === 0);
  elements.addCategory.classList.toggle("hidden", !state.editMode);
  elements.addCategory.title = t("ui.addCategory");
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
        <span>${category.icon || "folder"}</span>
        <button type="button" class="ghost" data-toggle-collapse>${category.name}</button>
      </div>
      <div class="category-actions ${state.editMode ? "" : "hidden"}">
        <button type="button" data-edit-category>...</button>
        <button type="button" data-delete-category>${t("ui.delete")}</button>
      </div>
    </div>
    <div data-services-container data-category-id="${category.id}" class="services ${category.collapsed ? "hidden" : ""}"></div>
    <button type="button" data-add-service class="add-service-btn ${state.editMode ? "" : "hidden"}">${t("ui.addService")}</button>
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
    </a>
    <div class="service-actions ${state.editMode ? "" : "hidden"}">
      <button type="button" data-edit-service>...</button>
      <button type="button" data-delete-service>${t("ui.delete")}</button>
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
    <div class="form-row">
      <label>${t("ui.icon")}</label>
      <input name="icon" value="${category?.icon || "folder"}" />
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
    title: `${isEdit ? t("ui.edit") : t("ui.addCategory")} ${t("ui.category")}`,
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
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
      <input name="iconUrl" type="url" value="${service?.iconUrl || ""}" />
      <small id="favicon-status"></small>
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
    title: `${isEdit ? t("ui.edit") : t("ui.addService")} ${t("ui.service")}`,
    content: form,
    saveLabel: t("ui.save"),
    cancelLabel: t("ui.cancel"),
    onSave: async () => {
      const fd = new FormData(form);
      const iconUrl = String(fd.get("iconUrl") || "");
      let cachedIcon = service?.cachedIcon || "";
      const status = form.querySelector("#favicon-status");
      if (iconUrl) {
        status.textContent = t("ui.fetchingIcon");
        try {
          const result = await api.cacheFavicon(iconUrl);
          cachedIcon = result.path;
        } catch (_) {
          cachedIcon = service?.cachedIcon || "";
        }
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
