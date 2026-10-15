import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab experiment "detailStableHero": opening Details drew the hero three times
// on the TV: the preview with the Home card's art, the full render with the
// addon's logo, then TMDB enrichment with a different logo (or none, which
// turns the logo into a text title). Once a logo or backdrop is on screen for
// a title, later renders keep it; an empty slot may still fill in. Only the
// copy being drawn changes, never the screen's meta.
const text = (value) => String(value || "").trim();

export function pinDetailHeroArt(
  meta,
  pin,
  key,
  seed = {},
  resolveBackdrop = (m) => text(m?.background)
) {
  if (!meta || !labFixEnabled("detailStableHero")) {
    return { meta, pin };
  }
  const previous =
    pin?.key === key ? pin : { logo: text(seed.logo), background: text(seed.background) };
  const next = {
    key,
    logo: previous.logo || text(meta.logo),
    background: previous.background || resolveBackdrop(meta)
  };
  if (next.logo === text(meta.logo) && next.background === resolveBackdrop(meta)) {
    return { meta, pin: next };
  }
  return {
    meta: { ...meta, logo: next.logo || meta.logo, background: next.background || meta.background },
    pin: next
  };
}
