function getServiceElement(target) {
  return target.closest("[data-service-id]");
}

export function setupDragDrop({ root, enabled, onMove }) {
  if (!enabled) return;

  let dragged = null;
  let touchTimer = null;

  root.querySelectorAll("[data-service-id]").forEach((item) => {
    item.draggable = true;
    item.addEventListener("dragstart", () => {
      dragged = item;
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      dragged = null;
    });
    item.addEventListener("touchstart", () => {
      touchTimer = window.setTimeout(() => {
        dragged = item;
        item.classList.add("dragging");
      }, 350);
    }, { passive: true });
    item.addEventListener("touchend", () => {
      window.clearTimeout(touchTimer);
      item.classList.remove("dragging");
      dragged = null;
    });
  });

  root.querySelectorAll("[data-services-container]").forEach((container) => {
    container.addEventListener("dragover", (event) => event.preventDefault());
    container.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = getServiceElement(event.target);
      if (!dragged) return;
      onMove(dragged.dataset.categoryId, dragged.dataset.serviceId, container.dataset.categoryId, target?.dataset.serviceId || null);
    });
    container.addEventListener("touchmove", (event) => {
      if (!dragged) return;
      const touch = event.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const service = getServiceElement(target || container);
      onMove(dragged.dataset.categoryId, dragged.dataset.serviceId, container.dataset.categoryId, service?.dataset.serviceId || null);
      dragged.classList.remove("dragging");
      dragged = null;
    }, { passive: true });
  });
}
