/** Zentrale Toast-Benachrichtigungen (oben rechts). */

const toasts = new Map();

function ensureToastRoot() {
  let root = document.getElementById("toast-root");
  if (!(root instanceof HTMLElement)) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-stack";
    document.body.append(root);
  }
  return root;
}

function applyToastContent(element, { title = "", description = "", detail = "", showCancel = false, cancelLabel = "" }) {
  const titleEl = element.querySelector("[data-toast-title]");
  const descriptionEl = element.querySelector("[data-toast-description]");
  const detailEl = element.querySelector("[data-toast-detail]");
  const actionsEl = element.querySelector(".toast__actions");
  const cancelButton = element.querySelector("[data-toast-cancel]");

  if (titleEl) titleEl.textContent = title;
  if (descriptionEl) descriptionEl.textContent = description;
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.classList.toggle("hidden", !String(detail || "").trim());
  }
  actionsEl?.classList.toggle("hidden", !showCancel);
  if (cancelButton instanceof HTMLButtonElement) {
    cancelButton.textContent = cancelLabel;
    cancelButton.disabled = !showCancel;
  }
}

function createToastElement(id) {
  const element = document.createElement("article");
  element.className = "toast";
  element.dataset.toastId = id;
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.innerHTML = `
    <div class="toast__body">
      <h3 class="toast__title" data-toast-title></h3>
      <p class="toast__description" data-toast-description></p>
      <p class="toast__detail hidden" data-toast-detail></p>
    </div>
    <div class="toast__actions hidden">
      <button type="button" class="btn btn--ghost btn--compact" data-toast-cancel></button>
    </div>
  `;
  element.querySelector("[data-toast-cancel]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toasts.get(id)?.onCancel?.();
  });
  return element;
}

export function showToast({
  id,
  title = "",
  description = "",
  detail = "",
  showCancel = false,
  cancelLabel = "",
  onCancel = null
}) {
  if (!id) return;

  let entry = toasts.get(id);
  if (!entry) {
    const element = createToastElement(id);
    ensureToastRoot().append(element);
    entry = { element, onCancel: null, hideTimer: null };
    toasts.set(id, entry);
    requestAnimationFrame(() => {
      element.classList.add("is-visible");
    });
  }

  if (entry.hideTimer) {
    window.clearTimeout(entry.hideTimer);
    entry.hideTimer = null;
  }

  entry.onCancel = onCancel;
  entry.element.classList.remove("is-leaving");
  applyToastContent(entry.element, { title, description, detail, showCancel, cancelLabel });
}

export function updateToast(id, options = {}) {
  const entry = toasts.get(id);
  if (!entry) {
    showToast({ id, ...options });
    return;
  }
  if (Object.hasOwn(options, "onCancel")) {
    entry.onCancel = options.onCancel;
  }
  applyToastContent(entry.element, {
    title: options.title ?? entry.element.querySelector("[data-toast-title]")?.textContent ?? "",
    description: options.description ?? entry.element.querySelector("[data-toast-description]")?.textContent ?? "",
    detail: options.detail ?? entry.element.querySelector("[data-toast-detail]")?.textContent ?? "",
    showCancel: options.showCancel ?? !entry.element.querySelector(".toast__actions")?.classList.contains("hidden"),
    cancelLabel: options.cancelLabel ?? entry.element.querySelector("[data-toast-cancel]")?.textContent ?? ""
  });
}

export function closeToast(id, { delayMs = 0 } = {}) {
  const entry = toasts.get(id);
  if (!entry) return;

  if (entry.hideTimer) {
    window.clearTimeout(entry.hideTimer);
    entry.hideTimer = null;
  }

  const hide = () => {
    entry.element.classList.remove("is-visible");
    entry.element.classList.add("is-leaving");
    window.setTimeout(() => {
      entry.element.remove();
      toasts.delete(id);
      if (!ensureToastRoot().children.length) {
        ensureToastRoot().replaceChildren();
      }
    }, 280);
  };

  if (delayMs > 0) {
    entry.hideTimer = window.setTimeout(hide, delayMs);
    return;
  }
  hide();
}
