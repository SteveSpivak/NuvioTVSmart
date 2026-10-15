// node lab/checks/back-store-signature.test.mjs
// Lab switch "backStoreSig": on every Back, buildHomeRouteInputSignature read the collections and Home catalog
// stores (parse, normalize, two deep clones each) and re-serialized them. With a 264 KB collections store that is
// ~230-310 ms inside the Back long task on the TV (MEASURED, CPU profile after Back). The signature only needs to
// detect change, so compare the raw stored text plus the active profile instead.
import assert from "node:assert/strict";
import fs from "node:fs";
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { homeRouteStoreSignatureParts } = await import("../../js/ui/screens/home/homeRouteStoreSignature.js");
let reads = 0;
const readStores = () => { reads += 1; return ["decoded"]; };
const sig = (profileId = "1") => JSON.stringify(homeRouteStoreSignatureParts(profileId, readStores));

storage.set("collectionsState", '{"profiles":{"1":{"collections":[{"id":"a"}]}}}');
storage.set("homeCatalogPrefs", '{"profiles":{"1":{"order":["x"]}}}');
const base = sig();
// Same stored text: same signature, and the stores are never decoded.
assert.equal(sig(), base);
assert.equal(reads, 0);
// Any change to either store, or a different active profile, changes the signature.
storage.set("collectionsState", '{"profiles":{"1":{"collections":[{"id":"b"}]}}}');
assert.notEqual(sig(), base);
storage.set("collectionsState", '{"profiles":{"1":{"collections":[{"id":"a"}]}}}');
assert.equal(sig(), base);
storage.set("homeCatalogPrefs", '{"profiles":{"1":{"order":["y"]}}}');
assert.notEqual(sig(), base);
storage.set("homeCatalogPrefs", '{"profiles":{"1":{"order":["x"]}}}');
assert.notEqual(sig("2"), base);
// A missing store is a stable value, not an error.
storage.delete("collectionsState");
assert.equal(sig(), sig());
// Switch off restores the old decoded-store signature.
localStorage.setItem("nuvioLabOff", "backStoreSig");
assert.deepEqual(homeRouteStoreSignatureParts("1", readStores), ["decoded"]);
assert.equal(reads, 1);
localStorage.removeItem("nuvioLabOff");
// Wiring: the route signature uses the helper instead of decoding both stores inline.
const src = fs.readFileSync(new URL("../../js/ui/screens/home/homeScreenMethods-04-get-hero-focus-delay.js", import.meta.url), "utf8");
assert.match(src, /\.\.\.homeRouteStoreSignatureParts\(ProfileManager\.getActiveProfileId\(\), \(\) => \[HomeCatalogStore\.get\(\), CollectionsStore\.get\(\)\]\)/);
console.log("back store signature: 6 cases passed");
