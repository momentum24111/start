function closestService(node) {
  return node?.closest?.("[data-service-id]") || null;
}

function closestCategory(node) {
  return node?.closest?.("[data-category-id]") || null;
}

export function setupDragDrop({ root, enabled, onMoveService, onMoveCategory }) {
  if (!enabled) return;

  const state = {
    kind: null,
    dragEl: null,
    fromCategoryId: null,
    dragId: null,
    targetCategoryId: null,
    targetContainer: null,
    touchTimer: 0,
    placeholder: null
  };

  const setActiveContainer = (container) => {
    root.querySelectorAll(".drop-zone-active").forEach((el) => el.classList.remove("drop-zone-active"));
    if (container) container.classList.add("drop-zone-active");
  };

  const createPlaceholder = (kind) => {
    const placeholder = document.createElement("div");
    placeholder.className = `drag-placeholder drag-placeholder--${kind}`;
    return placeholder;
  };

  const placePlaceholder = (target, container) => {
    if (!state.placeholder) return;
    if (!container) return;
    setActiveContainer(container);
    if (target && target !== state.dragEl && target.parentElement === container) {
      container.insertBefore(state.placeholder, target);
      return;
    }
    container.append(state.placeholder);
  };

  const clearState = () => {
    if (state.dragEl) state.dragEl.classList.remove("dragging");
    state.placeholder?.remove();
    root.querySelectorAll(".drop-zone-active").forEach((el) => el.classList.remove("drop-zone-active"));
    state.kind = null;
    state.dragEl = null;
    state.fromCategoryId = null;
    state.dragId = null;
    state.targetCategoryId = null;
    state.targetContainer = null;
    state.placeholder = null;
  };

  const beginDrag = (kind, handle) => {
    const dragEl = kind === "service" ? handle.closest("[data-service-id]") : handle.closest("[data-category-id]");
    if (!dragEl) return;
    state.kind = kind;
    state.dragEl = dragEl;
    state.dragId = kind === "service" ? dragEl.dataset.serviceId : dragEl.dataset.categoryId;
    state.fromCategoryId = dragEl.dataset.categoryId || null;
    dragEl.classList.add("dragging");
    state.placeholder = createPlaceholder(kind);
  };

  const finishDrag = async () => {
    if (!state.dragEl || !state.kind) return clearState();
    const beforeNode = state.placeholder?.nextElementSibling;
    const beforeId = state.kind === "service"
      ? beforeNode?.dataset?.serviceId || null
      : beforeNode?.dataset?.categoryId || null;
    if (state.kind === "service") {
      await onMoveService(state.fromCategoryId, state.dragId, state.targetCategoryId || state.fromCategoryId, beforeId);
    } else {
      await onMoveCategory(state.dragId, beforeId);
    }
    clearState();
  };

  const handleTouchMove = (event) => {
    if (!state.kind || !state.dragEl) return;
    const touch = event.touches[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (state.kind === "service") {
      const container = target?.closest?.("[data-services-container]");
      if (!container) return;
      const serviceTarget = closestService(target);
      state.targetCategoryId = container.dataset.categoryId;
      state.targetContainer = container;
      placePlaceholder(serviceTarget, container);
    } else {
      const categoryTarget = closestCategory(target);
      const container = root;
      state.targetContainer = container;
      placePlaceholder(categoryTarget, container);
    }
  };

  const handleTouchEnd = async () => {
    window.clearTimeout(state.touchTimer);
    if (!state.kind) return;
    await finishDrag();
  };

  root.querySelectorAll("[data-drag-service]").forEach((handle) => {
    const service = handle.closest("[data-service-id]");
    if (!service) return;
    service.draggable = true;
    handle.addEventListener("mousedown", () => beginDrag("service", handle));
    handle.addEventListener("touchstart", () => {
      state.touchTimer = window.setTimeout(() => beginDrag("service", handle), 280);
    }, { passive: true });
    handle.addEventListener("touchend", () => window.clearTimeout(state.touchTimer));
    handle.addEventListener("touchcancel", () => window.clearTimeout(state.touchTimer));
    handle.addEventListener("click", (event) => event.stopPropagation());

    service.addEventListener("dragstart", (event) => {
      if (!state.dragEl || state.dragEl !== service) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
    });
    service.addEventListener("dragend", clearState);
  });

  root.querySelectorAll("[data-drag-category]").forEach((handle) => {
    const category = handle.closest("[data-category-id]");
    if (!category) return;
    category.draggable = true;
    handle.addEventListener("mousedown", () => beginDrag("category", handle));
    handle.addEventListener("touchstart", () => {
      state.touchTimer = window.setTimeout(() => beginDrag("category", handle), 280);
    }, { passive: true });
    handle.addEventListener("touchend", () => window.clearTimeout(state.touchTimer));
    handle.addEventListener("touchcancel", () => window.clearTimeout(state.touchTimer));
    handle.addEventListener("click", (event) => event.stopPropagation());

    category.addEventListener("dragstart", (event) => {
      if (!state.dragEl || state.dragEl !== category) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
    });
    category.addEventListener("dragend", clearState);
  });

  root.querySelectorAll("[data-services-container]").forEach((container) => {
    container.addEventListener("dragover", (event) => {
      if (state.kind !== "service") return;
      event.preventDefault();
      const target = closestService(event.target);
      state.targetCategoryId = container.dataset.categoryId;
      state.targetContainer = container;
      placePlaceholder(target, container);
    });
    container.addEventListener("drop", async (event) => {
      if (state.kind !== "service") return;
      event.preventDefault();
      await finishDrag();
    });
  });

  root.addEventListener("dragover", (event) => {
    if (state.kind !== "category") return;
    event.preventDefault();
    const target = closestCategory(event.target);
    state.targetContainer = root;
    placePlaceholder(target, root);
  });

  root.addEventListener("drop", async (event) => {
    if (!state.kind) return;
    event.preventDefault();
    await finishDrag();
  });

  root.addEventListener("touchmove", handleTouchMove, { passive: true });
  root.addEventListener("touchend", handleTouchEnd, { passive: true });
  root.addEventListener("touchcancel", handleTouchEnd, { passive: true });
}
