import { ProfileManager } from "../../../js/core/profile/profileManager.js";
import { LocalStore } from "../../../js/core/storage/localStore.js";
import { TraktAuthStore } from "../../../js/data/local/traktAuthStore.js";
import { SimklAuthStore } from "../../../js/data/local/simklAuthStore.js";
import {
  TraktLibrarySourceMode,
  TraktSettingsStore
} from "../../../js/data/local/traktSettingsStore.js";
import {
  libraryRepository,
  readRemoteState,
  resolveRemoteStoreKey,
  REMOTE_STORE_KEY
} from "../../../js/data/repository/libraryRepository.js";

export async function waitUntil(predicate, { timeoutMs = 2000, message = "timed out" } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(message);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const headerMap = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headerMap[String(name).toLowerCase()] ?? null;
      }
    },
    async text() {
      if (body == null) return "";
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

export function paginationHeaders({
  page = 1,
  limit = 100,
  pageCount = 1,
  itemCount = 0,
  omitPageCount = false,
  omitLimit = false
} = {}) {
  const headers = {
    "X-Pagination-Page": String(page)
  };
  if (!omitLimit) headers["X-Pagination-Limit"] = String(limit);
  if (!omitPageCount) headers["X-Pagination-Page-Count"] = String(pageCount);
  if (itemCount != null) headers["X-Pagination-Item-Count"] = String(itemCount);
  return headers;
}

export function traktMovieEntry(index, extra = {}) {
  const id = Number(index);
  return {
    listed_at: extra.listedAt || "2026-01-01T00:00:00.000Z",
    type: extra.type || "movie",
    movie: {
      title: extra.title || `Movie ${id}`,
      year: extra.year || 2020,
      ids: {
        imdb: extra.imdbId || `tt${String(id).padStart(7, "0")}`,
        tmdb: extra.tmdbId ?? id,
        trakt: extra.traktId ?? id
      }
    }
  };
}

export function traktShowEntry(index, extra = {}) {
  const id = Number(index);
  return {
    listed_at: extra.listedAt || "2026-01-01T00:00:00.000Z",
    type: extra.type || "show",
    show: {
      title: extra.title || `Show ${id}`,
      year: extra.year || 2021,
      ids: {
        imdb: extra.imdbId || `tt${String(id).padStart(7, "0")}`,
        tmdb: extra.tmdbId ?? id,
        trakt: extra.traktId ?? id
      }
    }
  };
}

export function traktSeasonEntry(index, extra = {}) {
  const id = Number(index);
  return {
    listed_at: extra.listedAt || "2026-01-01T00:00:00.000Z",
    type: "season",
    season: {
      number: extra.seasonNumber || 1,
      ids: { trakt: extra.seasonTraktId ?? id + 1000 }
    },
    show: {
      title: extra.title || `Show ${id}`,
      year: extra.year || 2021,
      ids: {
        imdb: extra.imdbId || `tt${String(id).padStart(7, "0")}`,
        tmdb: extra.tmdbId ?? id,
        trakt: extra.traktId ?? id
      }
    }
  };
}

export function watchlistIds(state) {
  return (state?.watchlist || []).map((item) =>
    String(item.contentId || item.itemId || item.id || "")
  );
}

export function watchlistItemTypes(state) {
  return (state?.watchlist || []).map((item) =>
    String(item.contentType || item.itemType || item.type || "")
  );
}

export async function readCachedRemoteState() {
  return readRemoteState();
}

export async function readCachedWatchlistIds() {
  return watchlistIds(await readRemoteState());
}

export async function remoteStoreKeyFor(profileId = ProfileManager.getActiveProfileId()) {
  return `${REMOTE_STORE_KEY}:guest:${profileId}`;
}

export function connectTrakt({
  username = "alice",
  userSlug = "alice",
  accessToken = "trakt-access",
  profileId
} = {}) {
  const token = {
    access_token: accessToken,
    refresh_token: `${accessToken}-refresh`,
    created_at: Math.floor(Date.now() / 1000),
    expires_in: 604800
  };
  if (profileId == null) {
    TraktAuthStore.saveToken(token);
    TraktAuthStore.saveUser({ username, userSlug });
    TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.TRAKT);
    return;
  }
  TraktAuthStore.saveToken(token, String(profileId));
  TraktAuthStore.saveUser({ username, userSlug }, String(profileId));
  TraktSettingsStore.setForProfile(String(profileId), {
    librarySourceMode: TraktLibrarySourceMode.TRAKT
  });
}

export function connectSimkl({ accessToken = "simkl-access" } = {}) {
  SimklAuthStore.saveToken(accessToken);
  TraktSettingsStore.setLibrarySourceMode(TraktLibrarySourceMode.SIMKL);
}

export async function seedRemoteWatchlist(items, extra = {}) {
  const key = extra.storeKey || (await resolveRemoteStoreKey());
  LocalStore.set(key, {
    nextListId: 1,
    syncedAt: extra.syncedAt ?? Date.now(),
    authRevision: extra.authRevision ?? Number(TraktAuthStore.get().authRevision || 0),
    traktUserId:
      extra.traktUserId ?? (TraktAuthStore.get().userSlug || TraktAuthStore.get().username),
    watchlist: items,
    lists: extra.lists || [],
    listItems: extra.listItems || {}
  });
}

export async function resetWatchlistHarness() {
  localStorage.clear();
  libraryRepository.traktRefreshPromise = null;
  await ProfileManager.replaceProfiles([
    { id: "1", profileIndex: 1, name: "Profile 1" },
    { id: "2", profileIndex: 2, name: "Profile 2" }
  ]);
  await ProfileManager.setActiveProfile("1");
}

export class WatchlistHttpMock {
  constructor() {
    this.calls = [];
    this.originalFetch = globalThis.fetch;
    this.watchlistItems = [];
    this.appliedLimit = null;
    this.omitPageCount = false;
    this.omitLimitHeader = false;
    this.watchlistErrorStatus = null;
    this.watchlistErrorPage = null;
    this.repeatSamePage = false;
    this.watchlistHolds = [];
    this.personalLists = [];
    this.personalItems = [];
    this.personalOmitPageCount = false;
    this.simklErrorStatus = null;
    this.simklEntries = { shows: [], movies: [], anime: [] };
  }

  install() {
    globalThis.fetch = (...args) => this.fetch(...args);
    return this;
  }

  restore() {
    globalThis.fetch = this.originalFetch;
  }

  holdWatchlistGets(count = 1) {
    const holds = Array.from({ length: count }, () => createDeferred());
    this.watchlistHolds.push(...holds);
    return holds;
  }

  requestCount(predicate = () => true) {
    return this.calls.filter(predicate).length;
  }

  watchlistGetCount() {
    return this.calls.filter((call) => call.method === "GET" && call.path === "/sync/watchlist")
      .length;
  }

  async fetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const parsed = new URL(String(url), "https://api.trakt.tv");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const page = Number(parsed.searchParams.get("page") || 1);
    const requestedLimit = Number(parsed.searchParams.get("limit") || 0);
    this.calls.push({ method, path, page, requestedLimit, url: String(url) });

    if (path.startsWith("/sync/") && parsed.hostname.includes("simkl")) {
      return this.simklResponse(path);
    }
    if (parsed.hostname.includes("simkl")) {
      return this.simklResponse(path);
    }

    if (method === "GET" && path === "/sync/watchlist") {
      return this.watchlistPage(page, requestedLimit);
    }
    if (method === "POST" && path === "/sync/watchlist") {
      return jsonResponse({ added: { movies: 1, shows: 0 } }, { status: 201 });
    }
    if (method === "POST" && path === "/sync/watchlist/remove") {
      return jsonResponse({ deleted: { movies: 1, shows: 0 } });
    }
    if (method === "GET" && path === "/users/me/lists") {
      return jsonResponse(this.personalLists);
    }
    const listItems = path.match(/^\/users\/me\/lists\/([^/]+)\/items\/(movie|show)$/);
    if (method === "GET" && listItems) {
      const type = listItems[2];
      const items = type === "movie" ? this.personalItems : [];
      return this.pagedItems(items, page, requestedLimit || 100, {
        omitPageCount: this.personalOmitPageCount
      });
    }
    if (method === "POST" && path === "/oauth/revoke") {
      return jsonResponse({}, { status: 200 });
    }

    throw new Error(`Unexpected fetch ${method} ${path}`);
  }

  async watchlistPage(page, requestedLimit) {
    if (this.watchlistHolds.length) {
      const hold = this.watchlistHolds.shift();
      const override = await hold.promise;
      if (Array.isArray(override)) {
        return jsonResponse(override, {
          headers: paginationHeaders({
            page: 1,
            limit: override.length || 100,
            pageCount: 1,
            itemCount: override.length
          })
        });
      }
    }
    if (this.watchlistErrorStatus && (this.watchlistErrorPage || 1) === page) {
      return jsonResponse({ error: "failed" }, { status: this.watchlistErrorStatus });
    }
    const appliedLimit = this.appliedLimit || requestedLimit || 100;
    if (this.repeatSamePage) {
      const slice = this.watchlistItems.slice(0, appliedLimit);
      return jsonResponse(slice, {
        headers: paginationHeaders({
          page,
          limit: appliedLimit,
          pageCount: 0,
          itemCount: this.watchlistItems.length,
          omitPageCount: true,
          omitLimit: this.omitLimitHeader
        })
      });
    }
    return this.pagedItems(this.watchlistItems, page, appliedLimit, {
      omitPageCount: this.omitPageCount,
      omitLimit: this.omitLimitHeader,
      appliedLimit
    });
  }

  pagedItems(items, page, limit, { omitPageCount = false, omitLimit = false, appliedLimit } = {}) {
    const size = appliedLimit || limit || 100;
    const pageCount = Math.max(1, Math.ceil(items.length / size) || 1);
    const slice = items.slice((page - 1) * size, page * size);
    return jsonResponse(slice, {
      headers: paginationHeaders({
        page,
        limit: size,
        pageCount,
        itemCount: items.length,
        omitPageCount,
        omitLimit
      })
    });
  }

  simklResponse(path) {
    if (this.simklErrorStatus) {
      return jsonResponse({ error: "failed" }, { status: this.simklErrorStatus });
    }
    if (path.startsWith("/sync/activities")) {
      return jsonResponse({ all: "2026-01-01T00:00:00Z" });
    }
    if (path.startsWith("/sync/playback")) {
      return jsonResponse([]);
    }
    if (path.startsWith("/sync/all-items/movies")) {
      return jsonResponse({ movies: this.simklEntries.movies });
    }
    if (path.startsWith("/sync/all-items/shows")) {
      return jsonResponse({ shows: this.simklEntries.shows });
    }
    if (path.startsWith("/sync/all-items/anime")) {
      return jsonResponse({ anime: this.simklEntries.anime });
    }
    if (path.startsWith("/sync/all-items")) {
      return jsonResponse(this.simklEntries);
    }
    return jsonResponse({});
  }
}

export { libraryRepository, LocalStore, ProfileManager, TraktAuthStore, REMOTE_STORE_KEY };
