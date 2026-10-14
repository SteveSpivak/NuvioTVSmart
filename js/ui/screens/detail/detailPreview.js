import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab experiment "detailPreview": open Details on the artwork the Home card already
// has (backdrop plus logo or title) instead of the grey loading skeleton, then let
// the full render replace it once metadata arrives. The preview deliberately does
// not use .series-detail-shell or #detailHeroSection, which other Details code
// treats as "fully rendered".
function escapeMarkup(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function detailPreviewEnabled() {
  return labFixEnabled("detailPreview");
}

export function renderDetailPreview(params = {}) {
  const title = String(params?.fallbackTitle || "").trim();
  const logo = String(params?.fallbackLogo || "").trim();
  const backdrop = String(params?.fallbackBackground || "").trim();
  const brand = logo
    ? `<img src="${escapeMarkup(logo)}" class="series-detail-logo" alt="${escapeMarkup(title || "logo")}" decoding="async" fetchpriority="high" />`
    : `<h1 class="series-detail-title">${escapeMarkup(title)}</h1>`;
  return `
          <div class="detail-preview-shell" aria-label="Loading detail" aria-busy="true">
            <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${escapeMarkup(backdrop.replace(/'/g, "%27"))}')"` : ""}></div>
            <div class="series-detail-vignette"></div>
            <div class="detail-bottom-shadow"></div>
            <div class="series-detail-content">
              <section class="detail-hero-section">
                <div class="detail-hero-brand">${brand}</div>
                <div class="detail-preview-body" aria-hidden="true"></div>
              </section>
            </div>
          </div>
        `;
}
