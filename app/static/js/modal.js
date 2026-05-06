let activeModal = null;
let isClosing = false;
const CANCEL_ICON = "M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z";
const SAVE_ICON = "M9 16.2l-3.5-3.5L4 14.2 9 19l12-12-1.5-1.5z";
const DELETE_ICON = "M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z";

function icon(path) {
  return `<span class="btn__icon"><svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"></path></svg></span>`;
}

function keyHandler(event) {
  if (!activeModal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    activeModal.close("cancel");
  }
  if (activeModal.submitOnEnter === false) return;
  if (event.key === "Enter" && !event.shiftKey) {
    const target = event.target;
    if (target && (target.tagName === "TEXTAREA" || target.dataset.enterSubmit === "false")) return;
    event.preventDefault();
    activeModal.save();
  }
}

export function dismissActiveModalListeners() {
  if (activeModal) {
    document.removeEventListener("keydown", keyHandler);
    activeModal = null;
  }
  isClosing = false;
}

/** Modal ohne Aktionsleiste; kein Schließen per Esc oder Klick aufs Overlay. */
export function showStatusModal({ title = "", content }) {
  dismissActiveModalListeners();
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  const titleMarkup = title ? `<h2>${title}</h2>` : "";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-busy="true" tabindex="-1">
      ${titleMarkup}
      <div class="modal-content"></div>
    </section>
  `;
  const modal = overlay.querySelector(".modal");
  overlay.querySelector(".modal-content").append(content);
  root.innerHTML = "";
  root.append(overlay);
  modal.focus();
}

async function closeModal(reason = "cancel") {
  if (!activeModal || isClosing) return;
  isClosing = true;
  const { overlay, modal, onCancel, resolve } = activeModal;
  if (reason === "cancel") onCancel?.();
  overlay.classList.add("is-closing");
  modal.classList.add("is-closing");
  await new Promise((r) => window.setTimeout(r, 140));
  overlay.remove();
  document.removeEventListener("keydown", keyHandler);
  activeModal = null;
  isClosing = false;
  resolve?.();
}

export function showModal({
  title,
  content,
  onSave,
  onCancel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  leadingActions = [],
  showSave = true,
  showCancel = true,
  cancelVariant = "btn--ghost",
  submitOnEnter = true,
  modalClass = ""
}) {
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  const leadingButtons = leadingActions
    .map((action, index) => `<button type="button" class="btn btn--ghost" data-leading-action="${index}">${icon(action.icon || DELETE_ICON)}<span class="btn__label">${action.label}</span></button>`)
    .join("");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <h2>${title}</h2>
      <div class="modal-content"></div>
      <div class="modal-actions">
        <div class="modal-actions-leading">${leadingButtons}</div>
        <div class="modal-actions-trailing">
          ${showCancel ? `<button type="button" class="btn ${cancelVariant}" data-cancel>${icon(CANCEL_ICON)}<span class="btn__label">${cancelLabel}</span></button>` : ""}
          ${showSave ? `<button type="button" class="btn" data-save>${icon(SAVE_ICON)}<span class="btn__label">${saveLabel}</span></button>` : ""}
        </div>
      </div>
    </section>
  `;
  const modal = overlay.querySelector(".modal");
  if (modalClass) modal.classList.add(modalClass);
  overlay.querySelector(".modal-content").append(content);

  let overlayPointerDown = false;
  overlay.addEventListener("pointerdown", (event) => {
    overlayPointerDown = event.target === overlay;
  });
  overlay.addEventListener("pointerup", (event) => {
    if (overlayPointerDown && event.target === overlay) {
      closeModal("cancel");
    }
    overlayPointerDown = false;
  });

  const save = async () => {
    if (!activeModal || isClosing) return;
    const result = await onSave?.();
    if (result !== false) {
      closeModal("save");
    }
  };

  overlay.querySelector("[data-cancel]")?.addEventListener("click", () => {
    closeModal("cancel");
  });
  overlay.querySelector("[data-save]")?.addEventListener("click", () => {
    save();
  });
  overlay.querySelectorAll("[data-leading-action]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", async () => {
      const idx = Number(buttonEl.getAttribute("data-leading-action"));
      const action = leadingActions[idx];
      if (!action || isClosing) return;
      const result = await action.onClick?.();
      if (result !== false) {
        closeModal(action.closeReason || "save");
      }
    });
  });

  root.innerHTML = "";
  root.append(overlay);
  modal.focus();
  document.addEventListener("keydown", keyHandler);
  activeModal = {
    overlay,
    modal,
    onCancel,
    save,
    close: closeModal,
    submitOnEnter
  };
  return new Promise((resolve) => {
    activeModal.resolve = resolve;
  });
}
