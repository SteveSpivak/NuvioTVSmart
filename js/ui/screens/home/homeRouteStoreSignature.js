import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab experiment "backStoreSig": the Home route signature, rebuilt on every Back, decoded the
// Home catalog and collections stores (parse, normalize, two deep clones each) only to
// re-serialize them. On the TV the 264 KB collections store made that ~230-310 ms of the
// Back long task. The signature only detects change, so the raw stored text is enough: the
// same text decodes to the same value. A difference that does not change the decoded value
// (another profile, a normalization rewrite) only triggers the background refresh that a
// changed signature already causes.
const STORE_KEYS = ["homeCatalogPrefs", "collectionsState"];

export function homeRouteStoreSignatureParts(activeProfileId, readStores) {
  if (!labFixEnabled("backStoreSig")) {
    return readStores();
  }
  return [String(activeProfileId ?? ""), ...STORE_KEYS.map(readRawStore)];
}

function readRawStore(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch (_) {
    return null;
  }
}
