/**
 * Fixture credentials only. They let SimklAuthService pass its client-id guard
 * and TraktAuthService pass hasRequiredCredentials() so tests can reach mocked
 * HTTP. No live Trakt or Simkl request is made.
 */
globalThis.__NUVIO_ENV__ = {
  ...(globalThis.__NUVIO_ENV__ || {}),
  TRAKT_CLIENT_ID: "test-trakt-client-id",
  TRAKT_CLIENT_SECRET: "test-trakt-client-secret",
  SIMKL_CLIENT_ID: "test-simkl-client-id",
  SIMKL_APP_NAME: "nuvio-watchlist-test"
};

if (!globalThis.localStorage) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(String(key)) ? storage.get(String(key)) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    clear() {
      storage.clear();
    },
    key(index) {
      return [...storage.keys()][index] ?? null;
    },
    get length() {
      return storage.size;
    }
  };
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
