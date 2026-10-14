// node lab/checks/detail-trailer-loading.test.mjs
// Lab switch "trailerLoader": manual trailers load behind the player identity screen; switch off keeps the ring.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { renderDetailTrailerLoading } = await import("../../js/ui/screens/detail/detailTrailerLoading.js");

const meta = { name: `Tom & "Jerry" <b>`, logo: "https://example.test/logo.png" };
const backdrop = "https://example.test/back'drop.jpg";

// Default (switch on): ring plus the player's identity screen with escaped values.
const on = renderDetailTrailerLoading(meta, backdrop);
assert.match(on, /class="detail-trailer-loading-spinner has-identity"/);
assert.match(on, /class="detail-trailer-loading-ring"/);
assert.match(on, /player-loading-spinner-ring/);
assert.match(on, /class="player-loading-identity has-logo"/);
assert.match(on, /<img class="player-loading-logo" src="https:\/\/example\.test\/logo\.png"/);
assert.match(on, /Tom &amp; &quot;Jerry&quot; &lt;b&gt;/);
assert.match(on, /back%27drop\.jpg/);
assert.doesNotMatch(on, /<b>/);

// No logo: title only, no has-logo class (so the title is not hidden by CSS).
const noLogo = renderDetailTrailerLoading({ name: "Title" }, "");
assert.match(noLogo, /class="player-loading-identity"/);
assert.doesNotMatch(noLogo, /<img/);
assert.doesNotMatch(noLogo, /background-image/);

// Switch off: exactly the previous ring-only markup.
localStorage.setItem("nuvioLabOff", "trailerWarm,trailerLoader");
const off = renderDetailTrailerLoading(meta, backdrop);
assert.match(off, /^<div class="detail-trailer-loading-spinner" aria-hidden="true">/);
assert.doesNotMatch(off, /has-identity|player-loading-identity|detail-trailer-loading-ring/);

console.log("detail trailer loading: 3 cases passed");
