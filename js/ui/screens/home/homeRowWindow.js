// Home row window. Idea only, from Stremio's visible-catalog window
// (https://github.com/Stremio/stremio-web/blob/development/src/common/useVisibleCatalogs.ts):
// keep a band of rows mounted and leave the rest as same-height placeholders.
// Catalog objects stay in this.rows. Only the row DOM is removed and rebuilt.
import { registerHomeDomNodes } from "./homeDomUpdate.js";
import {
  LAB_ROW_WINDOW_RADIUS,
  buildModernCatalogPlaceholderMarkup,
  buildModernCatalogSectionMarkup,
  buildModernRowKey
} from "./modernHomeLayout.js";

let switchRead = false;
let switchEnabled = false;

export function isLabRowWindowEnabled() {
  if (!switchRead) {
    switchRead = true;
    try {
      switchEnabled = globalThis.localStorage?.getItem("labRowWindow") === "1";
    } catch (_error) {
      switchEnabled = false;
    }
  }
  return switchEnabled;
}

function catalogRowItems(rowData) {
  const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
  return items.length ? items : rowData?.loadingItems || [];
}

function rowKeyOf(rowData) {
  return String(rowData?.homeCatalogKey || buildModernRowKey(rowData || {}));
}

function scrollMemory(screen) {
  if (!screen.labRowWindowScrollLeft) {
    screen.labRowWindowScrollLeft = new Map();
  }
  return screen.labRowWindowScrollLeft;
}

function replaceSection(section, html) {
  const template = section.ownerDocument.createElement("template");
  template.innerHTML = String(html || "").trim();
  const next = template.content.firstElementChild;
  if (!next) {
    return section;
  }
  section.replaceWith(next);
  registerHomeDomNodes([next]);
  return next;
}

export function stampLabRowWindowSlot(screen) {
  if (!isLabRowWindowEnabled() || !screen?.container) {
    return 0;
  }
  const catalogs = screen.container.querySelector(".home-modern-catalogs");
  if (!catalogs) {
    return 0;
  }
  const sample = catalogs.querySelector(".home-modern-row:not([data-window-placeholder='1'])");
  const height = Math.round(sample?.offsetHeight || 0);
  if (height <= 0) {
    return Number(screen.labRowWindowSlotHeight || 0);
  }
  screen.labRowWindowSlotHeight = height;
  catalogs.style.setProperty("--home-row-window-slot", `${height}px`);
  catalogs.querySelectorAll("[data-window-placeholder='1']").forEach((node) => {
    node.style.height = `${height}px`;
  });
  return height;
}

function collapseSection(screen, section) {
  const ctx = screen.labRowWindowContext;
  if (!ctx?.escapeHtml) {
    return section;
  }
  const rowKey = String(section.dataset.rowKey || "");
  const track = section.querySelector(".home-track");
  if (rowKey && track) {
    scrollMemory(screen).set(rowKey, Number(track.scrollLeft || 0));
  }
  const height = Math.round(section.offsetHeight || screen.labRowWindowSlotHeight || 0);
  const title = section.querySelector(".home-row-title")?.textContent || "";
  return replaceSection(
    section,
    buildModernCatalogPlaceholderMarkup({
      rowKey,
      rowIndex: section.dataset.rowIndex || 0,
      rowTitle: title,
      heightPx: height,
      escapeHtml: ctx.escapeHtml
    })
  );
}

function expandSection(screen, section, { eagerImages = false } = {}) {
  const ctx = screen.labRowWindowContext;
  if (!ctx?.createPosterCardMarkup || !ctx.escapeHtml) {
    return section;
  }
  const rowIndex = Number(section.dataset.rowIndex);
  const rowData = Number.isFinite(rowIndex) ? screen.rows?.[rowIndex] || null : null;
  if (!rowData || !catalogRowItems(rowData).length) {
    return section;
  }
  const rowKey = rowKeyOf(rowData);
  const storedIndex = Number(screen.lastFocusedItemIndexByRowKey?.[rowKey]);
  const next = replaceSection(
    section,
    buildModernCatalogSectionMarkup(rowData, rowIndex, {
      ...ctx,
      focusedRowKey: eagerImages ? rowKey : "",
      focusedItemIndex: Number.isFinite(storedIndex) ? storedIndex : -1,
      expandFocusedPoster: false,
      rowWindowEnabled: false
    })
  );
  const track = next.querySelector(".home-track");
  const scrollLeft = scrollMemory(screen).get(rowKey);
  if (track && Number.isFinite(scrollLeft)) {
    track.scrollLeft = scrollLeft;
  }
  return next;
}

export function ensureLabRowWindowForMove(screen, current, delta) {
  if (!isLabRowWindowEnabled() || screen?.layoutMode !== "modern" || !screen.container) {
    return false;
  }
  const catalogs = screen.container.querySelector(".home-modern-catalogs");
  if (!catalogs) {
    return false;
  }
  const sections = Array.from(catalogs.querySelectorAll(":scope > .home-modern-row"));
  const section = current?.closest?.(".home-modern-row");
  if (!section || !catalogs.contains(section)) {
    return false;
  }
  const currentPos = sections.indexOf(section);
  if (currentPos < 0) {
    return false;
  }
  const destPos = currentPos + Number(delta || 0);
  if (destPos < 0 || destPos >= sections.length) {
    return false;
  }
  const start = Math.max(0, destPos - LAB_ROW_WINDOW_RADIUS);
  const end = Math.min(sections.length - 1, destPos + LAB_ROW_WINDOW_RADIUS);
  stampLabRowWindowSlot(screen);
  let changed = false;
  for (let index = 0; index < sections.length; index += 1) {
    const inside = index >= start && index <= end;
    const node = sections[index];
    const isPlaceholder = node.dataset.windowPlaceholder === "1";
    if (inside && isPlaceholder) {
      sections[index] = expandSection(screen, node, { eagerImages: index === destPos });
      changed = true;
    } else if (!inside && !isPlaceholder && index !== currentPos) {
      sections[index] = collapseSection(screen, node);
      changed = true;
    }
  }
  if (!changed) {
    return false;
  }
  screen.invalidateNavigationModel?.();
  screen.buildNavigationModel?.();
  screen.setupModernTrackScrollPagination?.();
  return true;
}
