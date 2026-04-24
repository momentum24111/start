let onClose = null;

function closeModal() {
  const root = document.getElementById("modal-root");
  root.innerHTML = "";
  document.removeEventListener("keydown", keyHandler);
  onClose?.();
  onClose = null;
}

function keyHandler(event) {
  if (event.key === "Escape") {
    closeModal();
  }
}

export function showModal({ title, content, onSave, onCancel, saveLabel = "Save", cancelLabel = "Cancel" }) {
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true">
      <h2>${title}</h2>
      <div class="modal-content"></div>
      <div class="modal-actions">
        <button type="button" data-cancel>${cancelLabel}</button>
        <button type="button" data-save>${saveLabel}</button>
      </div>
    </section>
  `;
  overlay.querySelector(".modal-content").append(content);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.querySelector("[data-cancel]").addEventListener("click", () => {
    onCancel?.();
    closeModal();
  });
  overlay.querySelector("[data-save]").addEventListener("click", async () => {
    const result = await onSave?.();
    if (result !== false) closeModal();
  });
  root.innerHTML = "";
  root.append(overlay);
  document.addEventListener("keydown", keyHandler);
  onClose = onCancel;
}
