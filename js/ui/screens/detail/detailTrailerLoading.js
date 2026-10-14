import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab experiment "trailerLoader": while a manually started trailer loads, show the
// same identity screen the player uses before playback (backdrop, gradient and a
// fading, pulsing title logo) instead of a bare ring on black. The ring stays for
// ambient trailers, where the Details content remains visible.
function escapeMarkup(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTrailerLoadingIdentity(meta = {}, backdropUrl = "") {
  const logoUrl = String(meta?.logo || "").trim();
  const title = String(meta?.name || "").trim();
  const backdrop = String(backdropUrl || "").trim();
  return `
              <div class="detail-trailer-loading-identity-layer">
                <div class="player-loading-backdrop"${backdrop ? ` style="background-image:url('${escapeMarkup(backdrop.replace(/'/g, "%27"))}')"` : ""}></div>
                <div class="player-loading-gradient"></div>
                <div class="player-loading-center">
                  <div class="player-loading-identity${logoUrl ? " has-logo" : ""}">
                    ${logoUrl ? `<img class="player-loading-logo" src="${escapeMarkup(logoUrl)}" alt="" />` : ""}
                    <div class="player-loading-title">${escapeMarkup(title)}</div>
                  </div>
                </div>
              </div>`;
}

export function renderDetailTrailerLoading(meta = {}, backdropUrl = "") {
  const ring = renderLoadingIndicator({ className: "player-loading-spinner-ring" });
  if (!labFixEnabled("trailerLoader")) {
    return `<div class="detail-trailer-loading-spinner" aria-hidden="true">${ring}</div>`;
  }
  return `<div class="detail-trailer-loading-spinner has-identity" aria-hidden="true">
              <div class="detail-trailer-loading-ring">${ring}</div>${renderTrailerLoadingIdentity(meta, backdropUrl)}
            </div>`;
}
