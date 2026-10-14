// node lab/checks/detail-cast-eager.test.mjs
// Lab switch "castEager": lazy cast photos below the Details fold are promoted to eager after a short delay,
// so they load without the user scrolling to them. Off via localStorage "nuvioLabOff".
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { CAST_EAGER_DELAY_MS, promoteCastImages, scheduleCastEager } = await import(
  "../../js/ui/screens/detail/detailCastEager.js"
);

function fakeContainer(count) {
  const images = Array.from({ length: count }, () => ({ loading: "lazy" }));
  return { images, querySelectorAll: (selector) => (selector === ".movie-cast-avatar-image" ? images : []) };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Promotes every lazy cast image once; a second pass changes nothing.
const direct = fakeContainer(3);
assert.equal(promoteCastImages(direct), 3);
assert.deepEqual(direct.images.map((image) => image.loading), ["eager", "eager", "eager"]);
assert.equal(promoteCastImages(direct), 0);
assert.equal(promoteCastImages(null), 0);

// Delayed: still lazy right after render, eager after the delay.
const delayed = fakeContainer(2);
const timer = scheduleCastEager(delayed, null);
assert.ok(timer);
assert.equal(delayed.images[0].loading, "lazy");
await sleep(CAST_EAGER_DELAY_MS + 50);
assert.equal(delayed.images[0].loading, "eager");

// A re-render before the delay replaces the pending timer instead of stacking a second one.
const first = fakeContainer(1);
const second = fakeContainer(1);
const pending = scheduleCastEager(first, null);
scheduleCastEager(second, pending);
await sleep(CAST_EAGER_DELAY_MS + 50);
assert.equal(first.images[0].loading, "lazy");
assert.equal(second.images[0].loading, "eager");

// Switch off: nothing is scheduled and images stay lazy.
storage.set("nuvioLabOff", "castEager");
const off = fakeContainer(2);
assert.equal(scheduleCastEager(off, null), null);
await sleep(CAST_EAGER_DELAY_MS + 50);
assert.equal(off.images[0].loading, "lazy");

console.log("detail-cast-eager: ok");
