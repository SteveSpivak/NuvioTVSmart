// node lab/checks/watched-skip-render.test.mjs
// Lab switch "watchedSkipRender": returning to Home re-projects watched titles and used to request a full Home
// render even when the watched title set was unchanged. On the TV that render rebuilt ~594 KB of markup for
// ~1.3 s of main-thread work and then wrote nothing (MEASURED, CPU profile after Back). Skip it when unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { shouldRenderWatchedTitleChange } = await import("../../js/ui/screens/home/homeWatchedRenderSkip.js");

const a = new Set(["tt1", "tmdb:2"]);
// Same members, different order and a new Set instance: no render.
assert.equal(shouldRenderWatchedTitleChange(a, new Set(["tmdb:2", "tt1"])), false);
// Added, removed or swapped member: render.
assert.equal(shouldRenderWatchedTitleChange(a, new Set(["tt1", "tmdb:2", "tt3"])), true);
assert.equal(shouldRenderWatchedTitleChange(a, new Set(["tt1"])), true);
assert.equal(shouldRenderWatchedTitleChange(a, new Set(["tt1", "tmdb:9"])), true);
// No previous set (first projection): render.
assert.equal(shouldRenderWatchedTitleChange(null, new Set()), true);
assert.equal(shouldRenderWatchedTitleChange(undefined, a), true);

// Switch off restores the old behavior: always render.
localStorage.setItem("nuvioLabOff", "watchedSkipRender");
assert.equal(shouldRenderWatchedTitleChange(a, new Set(["tt1", "tmdb:2"])), true);
localStorage.removeItem("nuvioLabOff");

// Wiring: the comparison runs before watchedTitleIds is replaced, and gates the background render.
const mount = fs.readFileSync(new URL("../../js/ui/screens/home/homeScreenMethods-20-mount.js", import.meta.url), "utf8");
assert.match(
  mount,
  /const nextTitleIds = buildWatchedTitleIdSet\(this\.watchedItems\);\s*const titlesChanged = shouldRenderWatchedTitleChange\(this\.watchedTitleIds, nextTitleIds\);\s*this\.watchedTitleIds = nextTitleIds;\s*if \(titlesChanged\) \{\s*this\.requestBackgroundRender\(\);\s*\}/
);

console.log("watched skip render: 4 cases passed");
