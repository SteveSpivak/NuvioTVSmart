// node lab/checks/detail-preview.test.mjs
// Lab switch "detailPreview": Details opens on the Home card's artwork instead of the grey skeleton, without the
// markers (.series-detail-shell, #detailHeroSection) that other Details code reads as "fully rendered".
import assert from "node:assert/strict";
import fs from "node:fs";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { detailPreviewEnabled, renderDetailPreview } = await import("../../js/ui/screens/detail/detailPreview.js");

// Logo and backdrop from the card, with escaping.
const full = renderDetailPreview({
  fallbackTitle: `A "B" <i>`,
  fallbackLogo: "https://example.test/logo.png",
  fallbackBackground: "https://example.test/it's.jpg"
});
assert.match(full, /class="detail-preview-shell"/);
assert.match(full, /<img src="https:\/\/example\.test\/logo\.png" class="series-detail-logo" alt="A &quot;B&quot; &lt;i&gt;"/);
assert.match(full, /background-image:url\('https:\/\/example\.test\/it%27s\.jpg'\)/);
assert.doesNotMatch(full, /series-detail-shell|detailHeroSection|detail-loading-shell|<i>/);

// A quote in the backdrop URL cannot close the style attribute.
const quoted = renderDetailPreview({ fallbackTitle: "T", fallbackBackground: 'https://example.test/a".jpg' });
assert.match(quoted, /url\('https:\/\/example\.test\/a&quot;\.jpg'\)/);
assert.doesNotMatch(quoted, /a"\.jpg/);

// No logo or backdrop: title text, no image, no inline background.
const bare = renderDetailPreview({ fallbackTitle: "Title" });
assert.match(bare, /<h1 class="series-detail-title">Title<\/h1>/);
assert.doesNotMatch(bare, /<img|background-image/);

// Switch: on by default, off via nuvioLabOff.
assert.equal(detailPreviewEnabled(), true);
localStorage.setItem("nuvioLabOff", "trailerLoader,detailPreview");
assert.equal(detailPreviewEnabled(), false);

// Wiring: mount keeps the skeleton for the switch-off path, and Home passes the card logo.
const mount = fs.readFileSync(new URL("../../js/ui/screens/detail/metaDetailsScreenMethods-02-mount.js", import.meta.url), "utf8");
assert.match(mount, /detailPreviewEnabled\(\)\s*\?\s*renderDetailPreview\(params\)\s*:\s*`\s*<div class="detail-loading-shell"/);
const home = fs.readFileSync(new URL("../../js/ui/screens/home/homeScreenMethods-27-enrich-continue-watching.js", import.meta.url), "utf8");
assert.match(home, /fallbackLogo: node\.dataset\.logoSrc \|\| ""/);

console.log("detail preview: 4 cases passed");
