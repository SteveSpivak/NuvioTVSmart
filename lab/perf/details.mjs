// Details-open timing: press OK on a Home card, record when the details screen appears and settles,
// then press Back once. Compares "cold" (OK right after focusing a new card) with "dwell" (OK after
// waiting DWELL_MS, so the Home hero has already fetched the title's metadata in the background).
//   node details.mjs [order]      order default "CDDCCD" (C = cold, D = dwell), one new card per trial
// Safety: OK is only pressed on a card with data-action="openDetail" outside Continue Watching, so it
// can never start playback. Back is pressed once per trial; the run stops if Home does not return.
//
// E0 (request waterfall) and E1 (CPU stacks), measurement only:
//   Every trial records a redacted request waterfall from the DevTools Network domain: provider, path
//   template, resource type, start/end, outcome, HTTP-cache evidence and the initiating call path.
//   Full URLs, query strings, hosts of unknown servers, ids, titles, headers and bodies are never kept.
//   PROFILE=0|1|alt   CPU profile none, every trial, or every other trial (default 0). Compare profiled
//                     and unprofiled medians before trusting a stack: profiling changes timing.
//   STACKS=async|sync async adds Debugger.setAsyncCallStackDepth so a request is traced past `await`
//                     to the Details method that started it (default async).
//   SAMPLE_US         profiler sampling interval in microseconds (default 1000)
//   SAVE_PROFILE=1    also write each raw profile with script URLs reduced to file names
//   THROTTLE          emulator only: CPU slow-down set on this script's own DevTools session. Newer Chrome
//                     drops lab/emu/start.mjs's rate when that script disconnects. Never set it on the TV.
// Markers come from the app's own render path (metaDetailsScreenMethods-02-mount.js renders
// .detail-loading-shell; render(meta) in -03-load-detail.js replaces it with .detail-hero-section
// in the same tick that sets isLoadingDetail = false):
//   metaRenderedMs  new hero with a title or logo, a description and a visible Play (playDefault) button
//   usableMs        metaRenderedMs plus a readable title: text title, or the logo image decoded
// settledMs is still the last DOM change. It is not usable Details and not full enrichment.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, sleep, KEYS, DEVICE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACK = ["GoBack", 461];
export const ANCHOR_NAME = "__nuvioLabProfileAnchor";
const ANCHOR_MS = 8;
const MAX_FRAMES = 5;
const OWNER_SCAN_FRAMES = 40;

// One hash function used both in the page and here, so CDP requests can be matched to resource-timing
// entries without either side keeping the URL. The hash itself is dropped before anything is saved.
export const FNV_SRC =
  "function(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h.toString(16)}";
export const fnv1a = new Function(`return ${FNV_SRC}`)();
const urlKey = (url) => String(url || "").split("#")[0];

// ---------- redaction ----------

const PROVIDERS = [
  [/(^|\.)api\.themoviedb\.org$/, "tmdb"],
  [/(^|\.)image\.tmdb\.org$/, "tmdb-image"],
  [/(^|\.)api\.trakt\.tv$/, "trakt"],
  [/(^|\.)(walter\.trakt\.tv|media\.trakt\.tv|walter-r2\.trakt\.tv)$/, "trakt-image"],
  [/(^|\.)api\.simkl\.com$/, "simkl"],
  [/cinemeta/, "cinemeta"],
  [/(^|\.)catalog\.nuvio\.tv$/, "nuvio-catalog"],
  [/(^|\.)supabase\.co$/, "nuvio-sync"],
  [/(^|\.)mdblist\.com$/, "mdblist"],
  [/(^|\.)metahub\.space$/, "metahub-image"],
  [/(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)$/, "youtube"],
  [/^(127\.0\.0\.1|localhost|\[::1\])$/, "local"]
];
// Path segments that are API vocabulary, never user data. Anything else becomes {x}.
const VOCAB = new Set(
  (
    "movie movies series anime channel tv show shows season seasons episode episodes credits aggregate_credits images videos " +
    "recommendations similar collection collections external_ids find keywords release_dates content_ratings " +
    "translations watch providers progress watched sync history playback ratings comments related people " +
    "person users lists list items watchlist search meta catalog stream subtitles manifest addon_catalog " +
    "scrobble start pause stop all sort recent likes stats calendars trending popular anticipated " +
    "configuration genre genres account rest auth token oauth img poster backdrop app api"
  ).split(" ")
);
const STREMIO_RESOURCES = new Set([
  "manifest",
  "catalog",
  "meta",
  "stream",
  "subtitles",
  "addon_catalog"
]);

export function templatePath(pathname) {
  const parts = String(pathname || "")
    .split("/")
    .filter(Boolean);
  const out = [];
  parts.forEach((raw, i) => {
    let seg = raw;
    try {
      seg = decodeURIComponent(raw);
    } catch (e) {}
    seg = seg.toLowerCase();
    if (i === parts.length - 1) seg = seg.replace(/\.(json|jpe?g|png|webp|avif|svg|js|css)$/, "");
    const keep = VOCAB.has(seg) || (i === 0 && /^v?\d{1,2}$/.test(seg));
    const value = keep ? seg : "{x}";
    if (value === "{x}" && out[out.length - 1] === "{x}") return;
    out.push(value);
  });
  return "/" + out.join("/");
}

export function classifyRequest(url, resourceType = "") {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return { provider: "invalid", category: "invalid" };
  }
  if (u.protocol === "data:" || u.protocol === "blob:")
    return { provider: "inline", category: "inline" };
  if (!/^https?:$/.test(u.protocol)) return { provider: "other", category: "other" };
  const host = u.hostname.toLowerCase();
  let provider = (PROVIDERS.find(([re]) => re.test(host)) || [null, null])[1];
  const template = templatePath(u.pathname);
  if (!provider) {
    const segs = template.split("/");
    provider = segs.some((s) => STREMIO_RESOURCES.has(s)) ? "addon" : "other";
  }
  if (/^image$/i.test(resourceType)) return { provider, category: "image" };
  if (provider === "other") return { provider, category: "other" };
  return { provider, category: template };
}

export function scriptName(url) {
  const s = String(url || "");
  if (!s) return "(eval)";
  if (/^(data|blob):/.test(s)) return "(inline)";
  try {
    const base = new URL(s).pathname.split("/").pop() || "";
    // A plugin URL can carry a key in its file name. Keep only short names without long id-like runs.
    return /^[\w.-]{1,48}\.m?js$/.test(base) && !/[A-Za-z0-9]{24,}/.test(base) ? base : "(script)";
  } catch (e) {
    return "(script)";
  }
}

// Browser built-ins (focus, JSON.parse, ...) have no URL and line -1. Code from Runtime.evaluate,
// which is this script's recorder, has no URL and a real line.
const isNative = (cf) => !cf?.url && Number(cf?.lineNumber) < 0;
const isEvalCode = (cf) => !cf?.url && !isNative(cf);
const frameLabel = (cf) =>
  isNative(cf)
    ? `${cf?.functionName || "(anonymous)"}@(native)`
    : `${cf?.functionName || "(anonymous)"}@${scriptName(cf?.url)}:${Number(cf?.lineNumber) || 0}:${Number(cf?.columnNumber) || 0}`;

// Details-screen methods that start requests, read in metaDetailsScreenMethods-03-load-detail.js.
// "before-render" calls are awaited by Promise.all before render(meta); "after-render" calls are not.
// Method names survive minification in the shipped bundle (checked on dist/app.bundle.js).
export const OWNERS = {
  resolveCanonicalDetailItemId: "before-render",
  getMetaFromAllAddons: "before-render",
  getMeta: "before-render",
  getResumeByContentId: "before-render",
  getResumeByContentIds: "before-render",
  refreshLibraryMembership: "after-render",
  refreshTrailerSource: "after-render",
  loadTraktComments: "after-render",
  fetchMoreLikeThis: "after-render",
  enrichMeta: "after-render",
  fetchEnrichment: "after-render",
  fetchTmdbCastFallback: "after-render",
  loadMdbListRatings: "after-render",
  fetchSeriesRatingsBySeason: "after-render",
  enrichSeriesWatchedState: "after-render",
  fetchMovieCollection: "after-render",
  enrichCurrentHeroAsync: "home",
  fetchModernHeroTmdbEnrichment: "home"
};

// The outermost known owner decides the phase: getMetaFromAllAddons called from fetchMoreLikeThis
// runs after render even though getMetaFromAllAddons alone is a before-render call.
export function sanitizeInitiator(initiator) {
  if (!initiator || typeof initiator !== "object")
    return { type: "unknown", frames: [], owners: [], owner: null, phase: "unattributed" };
  const all = [];
  let stack = initiator.stack;
  for (let depth = 0; stack && depth < 16 && all.length < OWNER_SCAN_FRAMES; depth++) {
    for (const cf of Array.isArray(stack.callFrames) ? stack.callFrames : []) all.push(cf);
    stack = stack.parent;
  }
  const owners = [];
  for (const cf of all) {
    const name = cf?.functionName;
    if (name && Object.prototype.hasOwnProperty.call(OWNERS, name) && !owners.includes(name))
      owners.push(name);
  }
  const owner = owners.length ? owners[owners.length - 1] : null;
  return {
    type: String(initiator.type || "unknown"),
    frames: all.slice(0, MAX_FRAMES).map(frameLabel),
    owners,
    owner,
    phase: owner ? OWNERS[owner] : "unattributed"
  };
}

const NET_ERROR = /^net::[A-Z_]+$/;
const HANDLED = new Set([
  "Network.requestWillBeSent",
  "Network.requestServedFromCache",
  "Network.responseReceived",
  "Network.loadingFinished",
  "Network.loadingFailed"
]);

// ---------- network waterfall ----------

export function createNetworkRecorder() {
  const byId = new Map();
  const stats = { orphans: 0, malformed: 0 };
  let armed = false;
  const valid = (p) => p && typeof p.requestId === "string" && Number.isFinite(p.timestamp);
  return {
    arm() {
      byId.clear();
      stats.orphans = 0;
      stats.malformed = 0;
      armed = true;
    },
    disarm() {
      armed = false;
    },
    handle(msg) {
      if (!armed || !msg || typeof msg.method !== "string" || !msg.method.startsWith("Network."))
        return;
      // ExtraInfo, dataReceived and other events carry nothing this recorder uses.
      if (!HANDLED.has(msg.method)) return;
      const p = msg.params;
      if (!valid(p)) {
        stats.malformed++;
        return;
      }
      if (msg.method === "Network.requestWillBeSent") {
        const existing = byId.get(p.requestId);
        if (existing && p.redirectResponse) {
          existing.redirects++;
          return;
        }
        const url = p.request?.url;
        if (typeof url !== "string") {
          stats.malformed++;
          return;
        }
        const { provider, category } = classifyRequest(url, p.type);
        const init = sanitizeInitiator(p.initiator);
        byId.set(p.requestId, {
          provider,
          category,
          resourceType: String(p.type || "Other"),
          method: String(p.request?.method || "GET"),
          start: p.timestamp,
          wallTime: Number.isFinite(p.wallTime) ? p.wallTime : null,
          urlHash: fnv1a(urlKey(url)),
          initiatorType: init.type,
          owner: init.owner,
          owners: init.owners,
          phase: init.phase,
          frames: init.frames,
          status: null,
          cache: {
            memory: false,
            disk: false,
            serviceWorker: false,
            prefetch: false,
            revalidated: false
          },
          redirects: 0,
          end: null,
          outcome: "pending",
          errorText: null,
          encodedBytes: null
        });
        return;
      }
      const rec = byId.get(p.requestId);
      if (!rec) {
        stats.orphans++;
        return;
      }
      if (msg.method === "Network.requestServedFromCache") rec.cache.memory = true;
      else if (msg.method === "Network.responseReceived") {
        const r = p.response || {};
        rec.status = Number.isFinite(r.status) ? r.status : null;
        rec.cache.disk = !!r.fromDiskCache;
        rec.cache.serviceWorker = !!r.fromServiceWorker;
        rec.cache.prefetch = !!r.fromPrefetchCache;
        rec.cache.revalidated = r.status === 304;
      } else if (msg.method === "Network.loadingFinished") {
        rec.end = p.timestamp;
        rec.outcome = "finished";
        rec.encodedBytes = Number.isFinite(p.encodedDataLength) ? p.encodedDataLength : null;
      } else if (msg.method === "Network.loadingFailed") {
        rec.end = p.timestamp;
        rec.outcome = p.canceled ? "canceled" : "failed";
        rec.errorText = NET_ERROR.test(String(p.errorText || "")) ? p.errorText : "other";
      }
    },
    snapshot() {
      armed = false;
      const records = [...byId.values()].map((r) => ({
        ...r,
        outcome: r.outcome === "pending" ? "incomplete" : r.outcome,
        cache: { ...r.cache },
        frames: [...r.frames],
        owners: [...r.owners]
      }));
      return { records, orphans: stats.orphans, malformed: stats.malformed };
    }
  };
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Maps CDP monotonic seconds onto the trial clock (ms since the recorder armed). Preferred: match
// requests to resource-timing entries by URL hash. Fallback: CDP wall time against performance.timeOrigin.
export function alignNetwork(records, pageRes, { t0, timeOrigin } = {}) {
  const starts = new Map();
  for (const entry of Array.isArray(pageRes) ? pageRes : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Number.isFinite(entry[2]))
      continue;
    if (!starts.has(entry[0])) starts.set(entry[0], []);
    starts.get(entry[0]).push(entry[2]);
  }
  const diffs = [];
  for (const r of records) {
    const list = starts.get(r.urlHash);
    if (list && list.length && Number.isFinite(r.start)) diffs.push(list.shift() - r.start * 1000);
  }
  if (diffs.length)
    return {
      method: "resource-timing",
      matches: diffs.length,
      spreadMs: Math.round(Math.max(...diffs) - Math.min(...diffs)),
      offsetMs: median(diffs)
    };
  const wall = records
    .filter((r) => Number.isFinite(r.wallTime) && Number.isFinite(r.start))
    .map((r) => r.wallTime * 1000 - timeOrigin - t0 - r.start * 1000);
  if (wall.length && Number.isFinite(timeOrigin) && Number.isFinite(t0))
    return {
      method: "wallclock",
      matches: wall.length,
      spreadMs: Math.round(Math.max(...wall) - Math.min(...wall)),
      offsetMs: median(wall)
    };
  return { method: "unaligned", matches: 0, spreadMs: null, offsetMs: null };
}

export function shapeRequests(records, alignment) {
  const at = (s) =>
    Number.isFinite(s) && alignment?.offsetMs != null
      ? Math.round(s * 1000 + alignment.offsetMs)
      : null;
  return records
    .map((r) => {
      const startMs = at(r.start);
      const endMs = at(r.end);
      return {
        provider: r.provider,
        category: r.category,
        resourceType: r.resourceType,
        method: r.method,
        startMs,
        endMs,
        durMs:
          Number.isFinite(r.start) && Number.isFinite(r.end)
            ? Math.round((r.end - r.start) * 1000)
            : null,
        outcome: r.outcome,
        status: r.status,
        errorText: r.errorText,
        cache: r.cache,
        redirects: r.redirects,
        encodedBytes: r.encodedBytes,
        initiatorType: r.initiatorType,
        owner: r.owner,
        owners: r.owners,
        phase: r.phase,
        frames: r.frames
      };
    })
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
}

const isCacheHit = (r) =>
  r.cache.memory ||
  r.cache.disk ||
  r.cache.serviceWorker ||
  r.cache.prefetch ||
  r.cache.revalidated;

export function categoryTable(requests) {
  const table = {};
  for (const r of requests) {
    if (r.resourceType === "Image") continue;
    const key = `${r.provider} ${r.category}`;
    const row = (table[key] ||= {
      count: 0,
      finished: 0,
      failed: 0,
      canceled: 0,
      incomplete: 0,
      httpCacheHits: 0,
      phases: [],
      owners: [],
      durs: []
    });
    row.count++;
    row[r.outcome] = (row[r.outcome] || 0) + 1;
    if (isCacheHit(r)) row.httpCacheHits++;
    if (!row.phases.includes(r.phase)) row.phases.push(r.phase);
    if (r.owner && !row.owners.includes(r.owner)) row.owners.push(r.owner);
    if (r.durMs != null) row.durs.push(r.durMs);
  }
  for (const row of Object.values(table)) {
    row.medianDurMs = median(row.durs);
    row.repeated = row.count > 1;
    delete row.durs;
  }
  return table;
}

// ---------- markers ----------

// Sample: [ms, visible, textLength, elementCount, imagesLoaded, flags]
export const FLAG = {
  hero: 1,
  titleText: 2,
  logo: 4,
  logoLoaded: 8,
  description: 16,
  play: 32,
  loading: 64
};

export function summarizeMarkers(samples) {
  const rows = Array.isArray(samples)
    ? samples.filter((s) => Array.isArray(s) && s.length >= 4)
    : [];
  const first = (f) => (rows.find(f) || [null])[0];
  const has = (s, bit) => ((s[5] | 0) & bit) === bit;
  const metaRendered = (s) =>
    s[1] === 1 &&
    has(s, FLAG.hero) &&
    (has(s, FLAG.titleText) || has(s, FLAG.logo)) &&
    has(s, FLAG.description) &&
    has(s, FLAG.play);
  const maxText = Math.max(0, ...rows.map((s) => s[2]));
  let settledMs = null;
  for (let i = 1; i < rows.length; i++)
    if (rows[i][2] !== rows[i - 1][2] || rows[i][3] !== rows[i - 1][3]) settledMs = rows[i][0];
  return {
    visibleMs: first((s) => s[1] === 1),
    loadingShellMs: first((s) => s[1] === 1 && has(s, FLAG.loading)),
    metaRenderedMs: first(metaRendered),
    usableMs: first((s) => metaRendered(s) && (has(s, FLAG.titleText) || has(s, FLAG.logoLoaded))),
    contentMs: first((s) => s[2] >= maxText * 0.9 && s[2] > 0),
    settledMs,
    samples: rows.length
  };
}

// ---------- long tasks and CPU profile ----------

export function longTaskStats(longtasks) {
  const entries = (Array.isArray(longtasks) ? longtasks : [])
    .filter((l) => Array.isArray(l) && Number.isFinite(l[0]) && Number.isFinite(l[1]) && l[1] >= 0)
    .sort((a, b) => a[0] - b[0]);
  let unionMs = 0;
  let curStart = null;
  let curEnd = null;
  let maxOverlap = 0;
  for (const [s, d] of entries) {
    const overlapping = entries.filter(([s2, d2]) => s2 < s + d && s < s2 + d2).length;
    maxOverlap = Math.max(maxOverlap, overlapping);
    if (curEnd == null || s > curEnd) {
      if (curEnd != null) unionMs += curEnd - curStart;
      curStart = s;
      curEnd = s + d;
    } else curEnd = Math.max(curEnd, s + d);
  }
  if (curEnd != null) unionMs += curEnd - curStart;
  return {
    count: entries.length,
    sumMs: entries.reduce((a, l) => a + l[1], 0),
    unionMs,
    maxOverlap,
    worstMs: Math.max(0, ...entries.map((l) => l[1])),
    entries
  };
}

const SPECIAL = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"]);

export function attributeProfile(profile, { anchorAt, windows = [] } = {}) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples))
    return { status: "malformed", reason: "missing nodes or samples" };
  if (!Array.isArray(profile.timeDeltas) || profile.timeDeltas.length !== profile.samples.length)
    return { status: "malformed", reason: "timeDeltas length differs from samples" };
  if (!Number.isFinite(profile.startTime)) return { status: "malformed", reason: "no startTime" };
  if (!profile.samples.length) return { status: "empty", reason: "no samples" };
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const stackOf = (id) => {
    const out = [];
    for (
      let cur = id, guard = 0;
      cur != null && nodes.has(cur) && guard < 512;
      cur = parent.get(cur), guard++
    )
      out.push(nodes.get(cur).callFrame || {});
    return out; // leaf first
  };
  const times = [];
  let t = profile.startTime;
  for (const d of profile.timeDeltas) times.push((t += Number(d) || 0));
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  const typical = median(gaps) ?? 0;
  const weight = (i) => Math.max(0, i + 1 < times.length ? times[i + 1] - times[i] : typical);
  const anchorIdx = profile.samples.findIndex((id) =>
    stackOf(id).some((cf) => cf.functionName === ANCHOR_NAME)
  );
  if (anchorIdx < 0 || !Number.isFinite(anchorAt))
    return {
      status: "unaligned",
      reason: "anchor function was not sampled",
      samples: profile.samples.length
    };
  const pageMs = (i) => (times[i] - times[anchorIdx]) / 1000 + anchorAt;
  const key = (cf) => (SPECIAL.has(cf.functionName) ? cf.functionName : frameLabel(cf));
  const summarizeRange = (from, to) => {
    const self = new Map();
    const incl = new Map();
    const owners = new Map();
    let sampledUs = 0;
    let recorderUs = 0;
    let heaviest = null;
    for (let i = 0; i < profile.samples.length; i++) {
      const ms = pageMs(i);
      if (ms < from || ms >= to) continue;
      const w = weight(i);
      sampledUs += w;
      const stack = stackOf(profile.samples[i]);
      // This script's own polling runs from Runtime.evaluate code, which has no script URL.
      const outer = stack.filter((cf) => cf.functionName !== "(root)").pop();
      const recorder = !!outer && isEvalCode(outer) && !SPECIAL.has(outer.functionName);
      if (recorder) recorderUs += w;
      const leaf = key(stack[0] || {});
      self.set(leaf, (self.get(leaf) || 0) + w);
      const seen = new Set();
      for (const cf of stack) {
        const k = key(cf);
        if (k === "(root)" || seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + w);
        if (Object.prototype.hasOwnProperty.call(OWNERS, cf.functionName))
          owners.set(cf.functionName, (owners.get(cf.functionName) || 0) + w);
      }
      if (
        !recorder &&
        !SPECIAL.has(leaf) &&
        (!heaviest || self.get(leaf) > self.get(heaviest.leaf))
      )
        heaviest = {
          leaf,
          path: stack
            .map(key)
            .filter((k) => k !== "(root)")
            .reverse()
            .slice(-12)
        };
    }
    const top = (m) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([fn, us]) => [fn, Math.round(us / 100) / 10]);
    return {
      sampledMs: Math.round(sampledUs / 100) / 10,
      recorderMs: Math.round(recorderUs / 100) / 10,
      self: top(self),
      inclusive: top(incl),
      owners: top(owners),
      heaviestPath: heaviest ? heaviest.path : []
    };
  };
  return {
    status: "ok",
    samples: profile.samples.length,
    intervalUs: Math.round(typical),
    whole: summarizeRange(-Infinity, Infinity),
    windows: windows.map(([start, dur]) => ({ start, dur, ...summarizeRange(start, start + dur) }))
  };
}

export function sanitizeProfile(profile) {
  return {
    ...profile,
    nodes: (profile?.nodes || []).map((n) => ({
      ...n,
      callFrame: { ...(n.callFrame || {}), url: scriptName(n.callFrame?.url) }
    }))
  };
}

// ---------- trial summary, timeline, redaction check ----------

export function buildTimeline(markers, requests, longtasks) {
  const ev = [];
  for (const [name, ms] of Object.entries(markers))
    if (name.endsWith("Ms") && ms != null) ev.push([ms, "marker", name.slice(0, -2)]);
  for (const r of requests) {
    if (r.resourceType === "Image") continue;
    if (r.startMs != null)
      ev.push([r.startMs, "request", `${r.provider} ${r.category} ${r.phase}`]);
    if (r.endMs != null)
      ev.push([
        r.endMs,
        "response",
        `${r.provider} ${r.category} ${r.outcome}${r.status ? " " + r.status : ""}`
      ]);
  }
  for (const [s, d] of longtasks) ev.push([s, "longtask", `${d} ms`]);
  return ev.sort((a, b) => a[0] - b[0]);
}

export function summarizeTrial({ page, net, profile, sampleUs }) {
  const markers = summarizeMarkers(page?.samples);
  const lt = longTaskStats(page?.longtasks);
  const res = Array.isArray(page?.res) ? page.res : [];
  const xhr = res.filter((r) => r[1] === "xmlhttprequest" || r[1] === "fetch");
  const out = {
    ...markers,
    staleHeroAtArm: page?.staleHero ?? null,
    // resource-timing view, comparable with the 2026-10-14 runs
    lastRequestEndMs: xhr.length ? Math.max(...xhr.map((r) => r[3])) : null,
    requests: xhr.length,
    images: res.filter((r) => r[1] === "img").length,
    longTasks: lt.count,
    longTaskMs: lt.sumMs,
    longTaskUnionMs: lt.unionMs,
    longTaskMaxOverlap: lt.maxOverlap,
    worstLongTaskMs: lt.worstMs,
    longTaskEntries: lt.entries
  };
  if (!net) out.network = { status: "NOT_AVAILABLE" };
  else {
    const alignment = alignNetwork(net.records, res, page || {});
    const requests = shapeRequests(net.records, alignment);
    const data = requests.filter((r) => r.resourceType !== "Image");
    const ended = (pred) => {
      const ends = data
        .filter(pred)
        .map((r) => r.endMs)
        .filter((x) => x != null);
      return ends.length ? Math.max(...ends) : null;
    };
    out.network = {
      status: "ok",
      alignment,
      orphans: net.orphans,
      malformed: net.malformed,
      incomplete: requests.filter((r) => r.outcome === "incomplete").length,
      unattributed: data.filter((r) => r.phase === "unattributed").length,
      lastBeforeRenderEndMs: ended((r) => r.phase === "before-render"),
      lastAfterRenderEndMs: ended((r) => r.phase === "after-render"),
      endedAfterUsable:
        markers.usableMs == null
          ? null
          : data.filter((r) => r.endMs != null && r.endMs > markers.usableMs).length,
      providers: data.reduce((a, r) => ((a[r.provider] = (a[r.provider] || 0) + 1), a), {}),
      categories: categoryTable(requests),
      requests
    };
  }
  if (profile === undefined) out.cpu = { status: "NOT_RUN" };
  else if (profile && profile.status) out.cpu = profile;
  else
    out.cpu = {
      sampleUs,
      ...attributeProfile(profile, { anchorAt: page?.anchorAt, windows: lt.entries })
    };
  out.timeline = buildTimeline(markers, out.network.requests || [], lt.entries);
  return out;
}

const LEAKS = [
  ["url", /\b(https?|wss?|file):\/\//i],
  ["imdb id", /\btt\d{5,}\b/],
  ["bearer", /bearer\s/i],
  ["token field", /(access|refresh)_?token|api_?key|client_?secret|authorization/i],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["query string", /\?[a-z0-9_]+=/i],
  ["long hex secret", /\b[a-f0-9]{32,}\b/i]
];

export function findLeaks(value) {
  const text = JSON.stringify(value);
  return LEAKS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${what} after ${ms} ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

// ---------- in-page recorder ----------

// Polls every 50 ms from just before OK until collected. The resource-timing buffer (250 entries) is full
// on a long-lived page; it is cleared here so new requests are recorded. Hero nodes that exist at arm
// time are remembered and ignored, so a stale screen cannot satisfy a marker.
const armScript = (anchor) => `(()=>{const d=document.getElementById("detail");
  performance.setResourceTimingBufferSize(2000);performance.clearResourceTimings();
  const prior=d?[...d.querySelectorAll(".detail-hero-section")]:[];
  ${
    anchor
      ? `const a0=performance.now();(function ${ANCHOR_NAME}(){const e=performance.now()+${ANCHOR_MS};while(performance.now()<e){}})();`
      : ""
  }
  window.__dt={t0:performance.now(),samples:[],longtasks:[],old:new WeakSet(prior),staleHero:prior.length,anchorAt:null};
  ${anchor ? "window.__dt.anchorAt=a0-window.__dt.t0;" : ""}
  try{window.__dtObs&&window.__dtObs.disconnect();window.__dtObs=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__dt.longtasks.push([Math.round(e.startTime-window.__dt.t0),Math.round(e.duration)])});window.__dtObs.observe({entryTypes:["longtask"]})}catch(e){window.__dt.noLongtask=true}
  const flags=()=>{if(!d)return 0;let f=0;if(d.querySelector(".detail-loading-shell"))f|=64;
    const hs=[...d.querySelectorAll(".detail-hero-section")].filter(h=>!window.__dt.old.has(h));const h=hs[hs.length-1];if(!h)return f;f|=1;
    const t=h.querySelector(".series-detail-title");if(t&&t.textContent.trim())f|=2;
    const l=h.querySelector("img.series-detail-logo");if(l){f|=4;if(l.complete&&l.naturalWidth>0)f|=8}
    const ds=h.querySelector(".series-detail-description");if(ds&&ds.textContent.trim())f|=16;
    const p=h.querySelector('[data-action="playDefault"]');if(p&&p.offsetWidth>0)f|=32;return f};
  clearInterval(window.__dtTimer);window.__dtTimer=setInterval(()=>{const vis=!!d&&d.offsetWidth>0&&getComputedStyle(d).display!=="none";
    const imgs=vis?[...d.querySelectorAll("img")]:[];
    window.__dt.samples.push([Math.round(performance.now()-window.__dt.t0),vis?1:0,vis?d.innerText.length:0,vis?d.getElementsByTagName("*").length:0,imgs.filter(i=>i.complete&&i.naturalWidth>0).length,vis?flags():0])},50);return true})()`;
const COLLECT = `(()=>{clearInterval(window.__dtTimer);try{window.__dtObs&&window.__dtObs.disconnect()}catch(e){}
  const H=${FNV_SRC};const t0=window.__dt.t0;
  const res=performance.getEntriesByType("resource").filter(e=>e.startTime>=t0).map(e=>[H(e.name.split("#")[0]),e.initiatorType,Math.round(e.startTime-t0),Math.round(e.responseEnd-t0)]);
  return JSON.stringify({t0,timeOrigin:performance.timeOrigin,anchorAt:window.__dt.anchorAt,staleHero:window.__dt.staleHero,noLongtask:!!window.__dt.noLongtask,samples:window.__dt.samples,longtasks:window.__dt.longtasks,res})})()`;

// ---------- run ----------

async function main() {
  const ORDER = (process.argv[2] || "CDDCCD").toUpperCase();
  const DWELL_MS = +(process.env.DWELL_MS || 5000);
  const WAIT_MS = +(process.env.WAIT_MS || 12000);
  const PROFILE = String(process.env.PROFILE || "0");
  const STACKS = process.env.STACKS === "sync" ? "sync" : "async";
  const SAMPLE_US = +(process.env.SAMPLE_US || 1000);
  const SAVE_PROFILE = process.env.SAVE_PROFILE === "1";
  const CALL_MS = 15000;
  const out = path.join(
    HERE,
    "../results",
    DEVICE,
    process.env.LABEL || `details_${new Date().toISOString().slice(0, 10)}`
  );
  const results = [];
  const run = {
    order: ORDER,
    dwellMs: DWELL_MS,
    waitMs: WAIT_MS,
    profile: PROFILE,
    stacks: STACKS,
    sampleUs: SAMPLE_US
  };
  let aborted = null;
  let saved = false;
  const save = () => {
    if (saved) return 0;
    saved = true;
    const doc = { schema: "nuvio-lab/details/2", device: DEVICE, ...run, aborted, results };
    const leaks = findLeaks(doc);
    if (leaks.length) {
      console.log("REDACTION_FAILED nothing written:", leaks.join(", "));
      return 4;
    }
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "details.json"), JSON.stringify(doc, null, 1));
    console.log("saved", out, aborted ? `(aborted: ${aborted})` : "");
    return 0;
  };
  process.on("SIGINT", () => {
    aborted = aborted || "SIGINT";
    process.exit(save() || 130);
  });

  const c = await connect();
  let disconnected = false;
  c.ws.addEventListener("close", () => {
    disconnected = true;
  });
  const call = async (method, params = {}) => {
    if (disconnected) throw new Error("disconnected");
    return withTimeout(c.send(method, params), CALL_MS, method);
  };
  const ev = (expr) => {
    if (disconnected) return Promise.reject(new Error("disconnected"));
    return withTimeout(c.ev(expr), CALL_MS + WAIT_MS, "Runtime.evaluate");
  };
  // Node's WebSocket drops sends on a closed socket without an error, so every key press is bounded too.
  const key = (k) => {
    if (disconnected) return Promise.reject(new Error("disconnected"));
    return withTimeout(c.key(k), CALL_MS, "Input.dispatchKeyEvent");
  };
  const net = createNetworkRecorder();
  const caps = { debuggerPausesResumed: 0 };
  c.onEvent((m) => {
    net.handle(m);
    // A `debugger;` statement can pause the app before breakpoints are switched off. Never leave it paused.
    if (m.method === "Debugger.paused") {
      caps.debuggerPausesResumed++;
      c.send("Debugger.resume").catch(() => {});
    }
  });
  try {
    caps.network = !(await call("Network.enable")).error;
    caps.asyncStacks = false;
    if (STACKS === "async") {
      const r = await call("Debugger.enable");
      if (!r.error) {
        await call("Debugger.setBreakpointsActive", { active: false });
        await call("Debugger.setPauseOnExceptions", { state: "none" });
        caps.asyncStacks = !(await call("Debugger.setAsyncCallStackDepth", { maxDepth: 32 })).error;
      }
    }
    caps.throttle = null;
    if (process.env.THROTTLE) {
      if (DEVICE === "tv") throw new Error("THROTTLE is for the emulator only");
      const rate = +process.env.THROTTLE;
      const r = await call("Emulation.setCPUThrottlingRate", { rate });
      caps.throttle = r.error ? "NOT_AVAILABLE" : rate;
    }
    caps.profiler = false;
    if (PROFILE !== "0") {
      caps.profiler = !(await call("Profiler.enable")).error;
      if (caps.profiler)
        caps.profiler = !(await call("Profiler.setSamplingInterval", { interval: SAMPLE_US }))
          .error;
    }
    run.capabilities = caps;
    console.log("capabilities", JSON.stringify(caps));

    const safeCard = () =>
      ev(`(()=>{const a=document.activeElement;if(!a||!a.closest(".home-row"))return "not_in_row";
    if(a.closest(".home-row-continue"))return "continue_row";
    return a.dataset.action==="openDetail"?"ok":"action:"+(a.dataset.action||"none")})()`);
    const onHome = async () =>
      (await ev(
        '(()=>{const h=document.getElementById("home"),a=document.activeElement;return !document.hidden&&!!h&&h.offsetWidth>0&&!!a&&!!a.closest(".home-row")})()'
      )) === true;

    for (const [i, kind] of [...ORDER].entries()) {
      if (!(await onHome())) {
        aborted = `not on Home before trial ${i + 1}`;
        break;
      }
      await key(KEYS.R); // new card each trial, so its details are not cached yet
      await sleep(kind === "D" ? DWELL_MS : 400);
      const safe = await safeCard();
      if (safe !== "ok") {
        console.log("SKIP trial", i + 1, "focused card is", safe);
        continue;
      }
      const profiled = caps.profiler && (PROFILE === "1" || (PROFILE === "alt" && i % 2 === 1));
      let profile;
      if (profiled) {
        const r = await call("Profiler.start");
        if (r.error) profile = { status: "NOT_AVAILABLE", reason: "Profiler.start failed" };
      }
      net.arm();
      await ev(armScript(profiled && profile === undefined));
      await key(KEYS.OK);
      await sleep(WAIT_MS);
      const page = JSON.parse(await ev(COLLECT));
      const snap = caps.network ? net.snapshot() : null;
      if (profiled && profile === undefined) {
        const r = await call("Profiler.stop").catch((e) => ({ error: { message: e.message } }));
        profile =
          r.error || !r.result?.profile
            ? { status: "INCOMPLETE", reason: "Profiler.stop returned no profile" }
            : r.result.profile;
        if (SAVE_PROFILE && !profile.status) {
          const clean = sanitizeProfile(profile);
          const leaks = findLeaks(clean);
          if (leaks.length) console.log("REDACTION_FAILED profile not written:", leaks.join(", "));
          else {
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, `trial${i + 1}.cpuprofile`), JSON.stringify(clean));
          }
        }
      }
      const s = summarizeTrial({ page, net: snap, profile, sampleUs: SAMPLE_US });
      const trial = {
        trial: i + 1,
        kind: kind === "D" ? "dwell" : "cold",
        profiled: !!profiled,
        noLongtask: page.noLongtask,
        ...s
      };
      results.push(trial);
      const nr = s.network;
      console.log(
        JSON.stringify({
          trial: i + 1,
          kind: trial.kind,
          profiled: trial.profiled,
          visibleMs: s.visibleMs,
          metaRenderedMs: s.metaRenderedMs,
          usableMs: s.usableMs,
          settledMs: s.settledMs,
          requests: nr.requests
            ? nr.requests.filter((r) => r.resourceType !== "Image").length
            : null,
          unattributed: nr.unattributed,
          alignment: nr.alignment?.method,
          longTaskUnionMs: s.longTaskUnionMs,
          cpu: s.cpu.status
        })
      );
      if (s.visibleMs == null) {
        aborted = "details screen never appeared; Back not pressed";
        break;
      }
      await key(BACK);
      await sleep(2500);
      if (!(await onHome())) {
        aborted = "Home did not return after one Back; stopped without more keys";
        break;
      }
    }
  } catch (e) {
    aborted = disconnected ? "DevTools connection closed" : String(e.message || e).slice(0, 120);
  }
  if (aborted) console.log("ABORT", aborted);
  for (const kind of ["cold", "dwell"])
    for (const profiled of [false, true]) {
      const g = results.filter((r) => r.kind === kind && r.profiled === profiled);
      if (!g.length) continue;
      const m = (f) => median(g.map((r) => r[f]));
      console.log(
        `median ${kind} ${profiled ? "profiled" : "unprofiled"} n=${g.length}: visible ${m("visibleMs")} metaRendered ${m("metaRenderedMs")} usable ${m("usableMs")} settled ${m("settledMs")}`
      );
    }
  try {
    if (caps.profiler) await call("Profiler.disable");
    if (caps.asyncStacks) await call("Debugger.disable");
  } catch (e) {}
  const code = save();
  c.close();
  process.exit(code || (aborted ? 3 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
