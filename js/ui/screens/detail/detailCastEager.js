import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab switch "castEager": cast and creator photos are rendered with loading="lazy", but they sit
// below the fold inside the Details scroll box, so the browser never starts them until the user
// scrolls there. Promote them to eager shortly after each render, once the hero has had its turn.
export const CAST_EAGER_DELAY_MS = 600;

export function castEagerEnabled() {
  return labFixEnabled("castEager");
}

export function promoteCastImages(root) {
  if (!root?.querySelectorAll) {
    return 0;
  }
  let promoted = 0;
  root.querySelectorAll(".movie-cast-avatar-image").forEach((image) => {
    if (image.loading !== "eager") {
      image.loading = "eager";
      promoted += 1;
    }
  });
  return promoted;
}

// Returns the new timer handle; the caller keeps it and passes it back on the next call.
export function scheduleCastEager(container, previousTimer) {
  if (previousTimer) {
    clearTimeout(previousTimer);
  }
  if (!container || !castEagerEnabled()) {
    return null;
  }
  return setTimeout(() => promoteCastImages(container), CAST_EAGER_DELAY_MS);
}
