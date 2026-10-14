// SYNTHETIC: time getAll + isWatched (one details open) with a large fake Trakt history.
//   SHOWS=150 EPISODES=60 MOVIES=500 node lab/checks/watched-getall.bench.mjs
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  }
};
globalThis.window = globalThis;
const { watchedItemsRepository: repo } =
  await import("../../js/data/repository/watchedItemsRepository.js");
const { TraktAuthService } = await import("../../js/data/repository/traktAuthService.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../../js/data/local/traktSettingsStore.js");
const S = +(process.env.SHOWS || 150),
  E = +(process.env.EPISODES || 60),
  M = +(process.env.MOVIES || 500);
const shows = Array.from({ length: S }, (_, s) => ({
  contentId: `tt1${String(s).padStart(6, "0")}`,
  title: "s",
  traktId: 1000 + s,
  tmdbId: 5000 + s,
  seasons: Array.from({ length: Math.ceil(E / 10) }, (_, n) => ({
    number: n + 1,
    episodes: Array.from({ length: 10 }, (_, e) => ({
      number: e + 1,
      plays: 1,
      lastWatchedAt: "2026-01-01T00:00:00Z"
    }))
  }))
}));
const movies = Array.from({ length: M }, (_, m) => ({
  contentId: `tt2${String(m).padStart(6, "0")}`,
  contentType: "movie",
  traktId: 9000 + m,
  tmdbId: 7000 + m,
  watchedAt: m
}));
TraktAuthService.isAuthenticated = () => true;
TraktAuthService.fetchWatchedMovies = async () => movies;
TraktAuthService.fetchWatchedShows = async () => shows;
const realGet = TraktSettingsStore.get.bind(TraktSettingsStore);
TraktSettingsStore.get = () => ({ ...realGet(), watchProgressSource: WatchProgressSource.TRAKT });
await repo.getAll(); // warm network caches and JIT
const times = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  await Promise.all([repo.getAll(), repo.isWatched("tt2000001")]);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    shows: S,
    episodesPerShow: E,
    movies: M,
    medianMsPerOpen: +times[10].toFixed(2),
    minMs: +times[0].toFixed(2)
  })
);
process.exit(0);
