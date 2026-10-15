// node lab/checks/detail-stable-hero.test.mjs
// Lab switch "detailStableHero": opening Details drew the hero three times (MEASURED, observer on the TV): the
// preview with the Home card's art, the full render with the addon's logo, then TMDB enrichment with a different
// logo (or no logo, which turns the logo into a text title). The title art visibly changed up to twice.
// Once a logo or backdrop is on screen for a title, later renders keep it; an empty slot may still fill in.
import assert from "node:assert/strict";
import fs from "node:fs";
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { pinDetailHeroArt } = await import("../../js/ui/screens/detail/detailStableHero.js");

const addon = { name: "A", logo: "https://addon/logo.png", background: "https://addon/bg.jpg", description: "short" };
const tmdb = { ...addon, logo: "https://tmdb/logo.png", background: "https://tmdb/bg.jpg", description: "long" };

// Preview showed the card's art: the full render and the enrichment keep it.
let step = pinDetailHeroArt(addon, null, "movie:tt1", { logo: "https://card/logo.png", background: "https://card/bg.jpg" });
assert.equal(step.meta.logo, "https://card/logo.png");
assert.equal(step.meta.background, "https://card/bg.jpg");
step = pinDetailHeroArt(tmdb, step.pin, "movie:tt1");
assert.equal(step.meta.logo, "https://card/logo.png");
assert.equal(step.meta.background, "https://card/bg.jpg");
// Other enriched fields still update, and the caller's meta is not modified.
assert.equal(step.meta.description, "long");
assert.equal(tmdb.logo, "https://tmdb/logo.png");

// No preview art: the first render's art is kept, TMDB returning no logo does not turn it into a text title.
step = pinDetailHeroArt(addon, null, "series:tt2");
assert.equal(step.meta, addon);
step = pinDetailHeroArt({ ...tmdb, logo: null }, step.pin, "series:tt2");
assert.equal(step.meta.logo, "https://addon/logo.png");
assert.equal(step.meta.background, "https://addon/bg.jpg");

// An empty slot fills in once, then stays.
step = pinDetailHeroArt({ name: "B" }, null, "movie:tt3", { background: "https://card/bg3.jpg" });
assert.equal(step.meta.logo, undefined);
step = pinDetailHeroArt(addon, step.pin, "movie:tt3");
assert.equal(step.meta.logo, "https://addon/logo.png");
step = pinDetailHeroArt(tmdb, step.pin, "movie:tt3");
assert.equal(step.meta.logo, "https://addon/logo.png");
assert.equal(step.meta.background, "https://card/bg3.jpg");

// A different title starts a new pin.
step = pinDetailHeroArt(tmdb, step.pin, "movie:tt4");
assert.equal(step.meta, tmdb);
assert.equal(step.pin.key, "movie:tt4");

// Switch off: meta passes through unchanged.
localStorage.setItem("nuvioLabOff", "detailStableHero");
step = pinDetailHeroArt(tmdb, { key: "movie:tt1", logo: "https://card/logo.png", background: "x" }, "movie:tt1");
assert.equal(step.meta, tmdb);
localStorage.removeItem("nuvioLabOff");

// Wiring: both hero draw paths (full render and section update) use the pinned art.
const dir = new URL("../../js/ui/screens/detail/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, dir), "utf8");
assert.match(read("metaDetailsScreenMethods-07-merge-stream-items.js"), /render\(meta, focusRestore = undefined\) \{\n\s+meta = this\.stableHeroMeta\(meta\);/);
assert.match(read("metaDetailsScreenMethods-08-render-external-ratings-row.js"), /_renderDetailSectionsNow\(meta, focusRestoreOverride = null\) \{\n(.*\n){0,3}\s+meta = this\.stableHeroMeta\(meta\);/);
console.log("detail stable hero: 9 cases passed");
