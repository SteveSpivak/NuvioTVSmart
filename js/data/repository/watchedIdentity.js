function addIdentityValue(set, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return;
  }
  set.add(normalized);
  set.add(normalized.toLowerCase());
}

function addPrefixedIdentityValue(set, prefix, value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(new RegExp(`^${prefix}:`, "i"), "");
  if (!normalized) {
    return;
  }
  addIdentityValue(set, `${prefix}:${normalized}`);
}

/**
 * Returns every stable catalog identity carried by a watched item or a catalog item.
 * The tracker payload and the catalog are allowed to choose different primary IDs;
 * callers must therefore compare this set instead of comparing only contentId.
 */
export function watchedItemIdentityValues(item = {}) {
  const values = new Set();
  const ids = item.ids || item.externalIds || item.external_ids || {};
  addIdentityValue(values, item.contentId);
  addIdentityValue(values, item.id);

  const imdbId = String(item.imdbId ?? "")
    .trim()
    .replace(/^imdb:/i, "");
  addIdentityValue(values, imdbId || item.imdb_id || ids.imdb);
  addPrefixedIdentityValue(values, "tmdb", item.tmdbId ?? item.tmdb_id ?? ids.tmdb);
  addPrefixedIdentityValue(values, "trakt", item.traktId ?? item.trakt_id ?? ids.trakt);
  addIdentityValue(values, item.slug || item.ids?.slug || ids.slug);
  return values;
}

export function watchedItemsShareIdentity(left = {}, right = {}) {
  const rightIds = watchedItemIdentityValues(right);
  return Array.from(watchedItemIdentityValues(left)).some((id) => rightIds.has(id));
}

/**
 * Union of the identities of many items. Matching an item against this set gives the same
 * answer as calling watchedItemsShareIdentity against each of them, in one pass.
 */
export function watchedIdentityIndex(items = []) {
  const index = new Set();
  (Array.isArray(items) ? items : []).forEach((item) =>
    watchedItemIdentityValues(item).forEach((id) => index.add(id))
  );
  return index;
}

export function watchedItemHasIdentityIn(item = {}, identities = new Set()) {
  if (!identities.size) {
    return false;
  }
  for (const id of watchedItemIdentityValues(item)) {
    if (identities.has(id)) {
      return true;
    }
  }
  return false;
}
