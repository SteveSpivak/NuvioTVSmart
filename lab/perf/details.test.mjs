// Deterministic fixtures for the E0/E1 instrumentation in details.mjs. No browser, no network.
//   node --test lab/perf/details.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANCHOR_NAME,
  FLAG,
  FNV_SRC,
  alignNetwork,
  attributeProfile,
  buildTimeline,
  classifyRequest,
  createNetworkRecorder,
  findLeaks,
  fnv1a,
  longTaskStats,
  sanitizeInitiator,
  sanitizeProfile,
  summarizeMarkers,
  summarizeTrial,
  templatePath,
  withTimeout
} from "./details.mjs";

const APP = "file:///media/developer/apps/usr/palm/applications/space.nuvio.lab/app.bundle.js";
const frame = (functionName, col = 1) => ({
  functionName,
  url: APP,
  lineNumber: 0,
  columnNumber: col
});

// ---------- redaction ----------

test("TMDB and Trakt paths keep vocabulary and drop ids, user names and query strings", () => {
  assert.deepEqual(
    classifyRequest("https://api.themoviedb.org/3/movie/603692?api_key=SECRET&language=en", "XHR"),
    { provider: "tmdb", category: "/3/movie/{x}" }
  );
  assert.deepEqual(
    classifyRequest("https://api.trakt.tv/users/some-person/history/movies/12345", "Fetch"),
    { provider: "trakt", category: "/users/{x}/history/movies/{x}" }
  );
  assert.deepEqual(
    classifyRequest("https://api.trakt.tv/shows/tt0903747/progress/watched", "Fetch"),
    {
      provider: "trakt",
      category: "/shows/{x}/progress/watched"
    }
  );
});

test("personalized addon URLs keep only the Stremio resource shape", () => {
  const url =
    "https://addon.example.net/eyJhbGciOiJIUzI1NiJ9.config-secret/meta/movie/tt1234567.json?debrid=KEY";
  const c = classifyRequest(url, "Fetch");
  assert.deepEqual(c, { provider: "addon", category: "/{x}/meta/movie/{x}" });
  assert.deepEqual(findLeaks(c), []);
  assert.deepEqual(classifyRequest("https://unknown.example.org/private/path", "XHR"), {
    provider: "other",
    category: "other"
  });
});

test("images, inline data, bad URLs and repeated unknown segments", () => {
  assert.deepEqual(classifyRequest("https://image.tmdb.org/t/p/w500/abc.jpg", "Image"), {
    provider: "tmdb-image",
    category: "image"
  });
  assert.equal(classifyRequest("data:image/png;base64,AAAA", "Image").provider, "inline");
  assert.equal(classifyRequest("not a url").provider, "invalid");
  assert.equal(templatePath("/a/b/c/meta/series/x%20y.json"), "/{x}/meta/series/{x}");
});

test("initiator: async parents are followed, the outermost Details owner sets the phase", () => {
  const init = {
    type: "script",
    stack: {
      callFrames: [frame("fetch"), frame("request"), frame("getMetaFromAllAddons")],
      parent: {
        description: "await",
        callFrames: [frame("fetchMoreLikeThis"), frame("")],
        parent: { description: "Promise.then", callFrames: [frame("loadDetail")] }
      }
    }
  };
  const s = sanitizeInitiator(init);
  assert.deepEqual(s.owners, ["getMetaFromAllAddons", "fetchMoreLikeThis"]);
  assert.equal(s.owner, "fetchMoreLikeThis");
  assert.equal(s.phase, "after-render");
  assert.equal(s.frames.length, 5);
  assert.equal(s.frames[0], "fetch@app.bundle.js:0:1");
  assert.equal(s.frames[4], "(anonymous)@app.bundle.js:0:1");
  assert.deepEqual(findLeaks(s), []);
});

test("initiator without a stack, or not an object, is unattributed", () => {
  assert.deepEqual(sanitizeInitiator({ type: "parser" }), {
    type: "parser",
    frames: [],
    owners: [],
    owner: null,
    phase: "unattributed"
  });
  assert.equal(sanitizeInitiator(null).phase, "unattributed");
  assert.equal(sanitizeInitiator("x").type, "unknown");
});

test("leak check catches URLs, ids, tokens and JWTs, and passes clean data", () => {
  assert.deepEqual(findLeaks({ a: "https://x.y/z" }), ["url"]);
  assert.ok(findLeaks({ a: "tt1234567" }).includes("imdb id"));
  assert.ok(findLeaks({ a: "Bearer abc" }).includes("bearer"));
  assert.ok(findLeaks({ access_token: 1 }).includes("token field"));
  assert.ok(findLeaks({ a: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x" }).includes("jwt"));
  assert.ok(findLeaks({ a: "/path?key=1" }).includes("query string"));
  assert.deepEqual(
    findLeaks({ provider: "tmdb", category: "/3/movie/{x}", frames: ["f@app.bundle.js:0:9"] }),
    []
  );
});

// ---------- network recorder ----------

const sent = (id, url, ts, extra = {}) => ({
  method: "Network.requestWillBeSent",
  params: {
    requestId: id,
    timestamp: ts,
    wallTime: 1000 + ts,
    type: "Fetch",
    request: { url, method: "GET" },
    ...extra
  }
});
const ev = (method, id, ts, extra = {}) => ({
  method,
  params: { requestId: id, timestamp: ts, ...extra }
});

test("recorder: lifecycle, cache evidence, failures, orphans, malformed and incomplete", () => {
  const r = createNetworkRecorder();
  r.handle(sent("before", "https://api.trakt.tv/sync/playback", 9)); // not armed: ignored
  r.arm();
  r.handle(
    sent("1", "https://api.themoviedb.org/3/movie/1", 10, {
      initiator: { type: "script", stack: { callFrames: [frame("enrichMeta")] } }
    })
  );
  r.handle(
    ev("Network.responseReceived", "1", 10.2, { response: { status: 200, fromDiskCache: true } })
  );
  r.handle(ev("Network.loadingFinished", "1", 10.3, { encodedDataLength: 512 }));
  r.handle(sent("2", "https://api.trakt.tv/movies/x/comments", 10.1));
  r.handle(
    ev("Network.loadingFailed", "2", 10.15, { canceled: true, errorText: "net::ERR_ABORTED" })
  );
  r.handle(sent("3", "https://v3-cinemeta.strem.io/meta/movie/tt1.json", 10.05));
  r.handle(ev("Network.requestServedFromCache", "3", 10.06));
  r.handle(ev("Network.responseReceived", "3", 10.07, { response: { status: 304 } }));
  r.handle(sent("4", "https://api.trakt.tv/a", 10.2));
  r.handle(sent("4", "https://api.trakt.tv/b", 10.21, { redirectResponse: { status: 302 } }));
  r.handle(ev("Network.loadingFailed", "5", 10.4, { errorText: "secret https://leak" }));
  r.handle({ method: "Network.loadingFinished", params: { requestId: 7 } });
  r.handle({ method: "Network.responseReceivedExtraInfo", params: { requestId: "1" } }); // ignored
  r.handle({ method: "Network.dataReceived", params: { requestId: "zzz", timestamp: 10.2 } }); // ignored
  r.handle({ method: "Network.loadingFinished" });
  r.handle(ev("Network.loadingFailed", "4", 10.5, { errorText: "net::ERR_FAILED https://x" }));
  const { records, orphans, malformed } = r.snapshot();
  assert.equal(records.length, 4);
  assert.equal(orphans, 1);
  assert.equal(malformed, 2);
  const [tm, tr, cm, rd] = records;
  assert.equal(tm.outcome, "finished");
  assert.equal(tm.status, 200);
  assert.equal(tm.cache.disk, true);
  assert.equal(tm.phase, "after-render");
  assert.equal(tm.encodedBytes, 512);
  assert.equal(tr.outcome, "canceled");
  assert.equal(tr.errorText, "net::ERR_ABORTED");
  assert.equal(cm.outcome, "incomplete");
  assert.equal(cm.cache.memory, true);
  assert.equal(cm.cache.revalidated, true);
  assert.equal(rd.redirects, 1);
  assert.equal(rd.errorText, "other");
  r.handle(sent("9", "https://api.trakt.tv/x", 11)); // snapshot disarms
  assert.equal(r.snapshot().records.length, 4);
});

test("alignment: resource-timing match, wall-clock fallback, unaligned", () => {
  const url = "https://api.themoviedb.org/3/movie/1";
  const recs = [{ urlHash: fnv1a(url), start: 10, wallTime: 1010 }];
  const viaRes = alignNetwork(recs, [[fnv1a(url), "fetch", 120, 300]], { t0: 50, timeOrigin: 0 });
  assert.equal(viaRes.method, "resource-timing");
  assert.equal(viaRes.offsetMs, 120 - 10000);
  const viaWall = alignNetwork(recs, [], { t0: 50, timeOrigin: 1000000 });
  assert.equal(viaWall.method, "wallclock");
  assert.equal(viaWall.offsetMs, 1010000 - 1000000 - 50 - 10000);
  assert.equal(alignNetwork([{ urlHash: "z", start: 1 }], null, {}).method, "unaligned");
  assert.equal(
    alignNetwork(recs, [["bad"], null, [fnv1a(url), "fetch", "x"]], {}).method,
    "unaligned"
  );
});

test("page hash and node hash are the same function", () => {
  const pageHash = new Function(`return ${FNV_SRC}`)();
  for (const s of ["", "a", "https://api.trakt.tv/sync/playback?x=1"])
    assert.equal(pageHash(s), fnv1a(s));
});

// ---------- markers ----------

const S = (ms, flags, vis = 1, text = 100, els = 50) => [ms, vis, text, els, 0, flags];
const META = FLAG.hero | FLAG.description | FLAG.play;

test("markers: loading shell, meta rendered, usable after logo decode, settle", () => {
  const m = summarizeMarkers([
    S(0, 0, 0, 0, 0),
    S(50, FLAG.loading, 1, 10, 20),
    S(100, META | FLAG.logo, 1, 80, 60),
    S(150, META | FLAG.logo | FLAG.logoLoaded, 1, 80, 60),
    S(200, META | FLAG.logo | FLAG.logoLoaded, 1, 120, 90)
  ]);
  assert.equal(m.visibleMs, 50);
  assert.equal(m.loadingShellMs, 50);
  assert.equal(m.metaRenderedMs, 100);
  assert.equal(m.usableMs, 150);
  assert.equal(m.settledMs, 200);
});

test("markers: text title is usable at once; no Play button or no description is never usable", () => {
  assert.equal(summarizeMarkers([S(0, META | FLAG.titleText)]).usableMs, 0);
  assert.equal(
    summarizeMarkers([S(0, FLAG.hero | FLAG.titleText | FLAG.description)]).usableMs,
    null
  );
  assert.equal(
    summarizeMarkers([S(0, FLAG.hero | FLAG.titleText | FLAG.play)]).metaRenderedMs,
    null
  );
  assert.equal(summarizeMarkers([S(0, META | FLAG.titleText, 0)]).metaRenderedMs, null);
});

test("markers: missing or malformed samples give nulls, not a crash", () => {
  for (const bad of [undefined, null, [], [[1, 2]], ["x"]]) {
    const m = summarizeMarkers(bad);
    assert.equal(m.visibleMs, null);
    assert.equal(m.usableMs, null);
    assert.equal(m.settledMs, null);
  }
});

// ---------- long tasks and profiles ----------

test("long tasks: overlap is counted once in the union", () => {
  const s = longTaskStats([
    [100, 200],
    [150, 100],
    [400, 50],
    ["x", 1],
    [500, -1]
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.sumMs, 350);
  assert.equal(s.unionMs, 250);
  assert.equal(s.maxOverlap, 2);
  assert.equal(s.worstMs, 200);
  assert.deepEqual(longTaskStats(undefined), {
    count: 0,
    sumMs: 0,
    unionMs: 0,
    maxOverlap: 0,
    worstMs: 0,
    entries: []
  });
});

// Profile: root -> anchor; root -> enrichMeta -> parseJson (hot); root -> (idle).
function fixtureProfile({ anchor = true, hotSamples = 300 } = {}) {
  const nodes = [
    { id: 1, callFrame: { functionName: "(root)", url: "" }, children: [2, 3, 5, 6] },
    { id: 6, callFrame: { functionName: "", url: "" }, children: [] }, // the recorder's own polling
    { id: 2, callFrame: frame(anchor ? ANCHOR_NAME : "other"), children: [] },
    { id: 3, callFrame: frame("enrichMeta", 10), children: [4] },
    { id: 4, callFrame: frame("parseJson", 20), children: [] },
    { id: 5, callFrame: { functionName: "(idle)", url: "" }, children: [] }
  ];
  const samples = [];
  const timeDeltas = [];
  const push = (id, n) => {
    for (let i = 0; i < n; i++) {
      samples.push(id);
      timeDeltas.push(1000); // 1 ms
    }
  };
  push(5, 10); // idle before the anchor
  push(2, 4); // anchor
  push(5, 96); // idle
  push(4, hotSamples); // the long task
  push(5, 100);
  push(6, 20);
  return { nodes, samples, timeDeltas, startTime: 5_000_000, endTime: 5_600_000 };
}

test("profile: the long-task window names the hot function and its owner", () => {
  const p = fixtureProfile();
  // anchor first sampled at index 10; with anchorAt = 2 ms, sample i is at (i - 10) + 2 ms.
  const a = attributeProfile(p, { anchorAt: 2, windows: [[102, 300]] });
  assert.equal(a.status, "ok");
  const w = a.windows[0];
  assert.equal(w.sampledMs, 300);
  assert.equal(w.recorderMs, 0);
  assert.equal(a.whole.recorderMs, 20);
  assert.equal(w.self[0][0], "parseJson@app.bundle.js:0:20");
  assert.equal(w.self[0][1], 300);
  assert.deepEqual(w.owners, [["enrichMeta", 300]]);
  assert.deepEqual(w.heaviestPath, [
    "enrichMeta@app.bundle.js:0:10",
    "parseJson@app.bundle.js:0:20"
  ]);
  assert.ok(a.whole.self.some(([fn]) => fn === "(idle)"));
});

test("profile: no anchor, malformed or empty profiles are reported, not guessed", () => {
  assert.equal(
    attributeProfile(fixtureProfile({ anchor: false }), { anchorAt: 2 }).status,
    "unaligned"
  );
  assert.equal(attributeProfile(fixtureProfile(), {}).status, "unaligned");
  assert.equal(attributeProfile(null).status, "malformed");
  const bad = fixtureProfile();
  bad.timeDeltas.pop();
  assert.equal(attributeProfile(bad, { anchorAt: 0 }).status, "malformed");
  assert.equal(
    attributeProfile({ nodes: [], samples: [], timeDeltas: [], startTime: 0 }, { anchorAt: 0 })
      .status,
    "empty"
  );
});

test("saved profiles keep only script file names", () => {
  const p = fixtureProfile();
  p.nodes[3].callFrame.url = "https://addon.example.net/SECRET/plugin.js?token=abc";
  const s = sanitizeProfile(p);
  assert.equal(s.nodes[3].callFrame.url, "plugin.js");
  assert.equal(s.nodes[2].callFrame.url, "app.bundle.js");
  assert.deepEqual(findLeaks(s), []);
});

// ---------- trial summary ----------

test("trial summary joins markers, requests and CPU on one clock, and stays redacted", () => {
  const url = "https://api.themoviedb.org/3/movie/603692?api_key=SECRET";
  const r = createNetworkRecorder();
  r.arm();
  r.handle(
    sent("1", url, 10.1, {
      initiator: { type: "script", stack: { callFrames: [frame("enrichMeta")] } }
    })
  );
  r.handle(ev("Network.responseReceived", "1", 10.3, { response: { status: 200 } }));
  r.handle(ev("Network.loadingFinished", "1", 10.4));
  r.handle(
    sent("2", "https://v3-cinemeta.strem.io/meta/movie/tt1.json", 10.0, {
      initiator: { type: "script", stack: { callFrames: [frame("getMetaFromAllAddons")] } }
    })
  );
  r.handle(ev("Network.loadingFinished", "2", 10.08));
  const page = {
    t0: 0,
    timeOrigin: 0,
    anchorAt: 2,
    staleHero: 0,
    samples: [
      S(0, 0, 0),
      S(50, FLAG.loading),
      S(100, META | FLAG.titleText),
      S(400, META | FLAG.titleText, 1, 200)
    ],
    longtasks: [[102, 300]],
    res: [
      [fnv1a("https://v3-cinemeta.strem.io/meta/movie/tt1.json"), "fetch", 5, 85],
      [fnv1a(url), "fetch", 105, 405]
    ]
  };
  const s = summarizeTrial({ page, net: r.snapshot(), profile: fixtureProfile(), sampleUs: 1000 });
  assert.equal(s.metaRenderedMs, 100);
  assert.equal(s.usableMs, 100);
  assert.equal(s.network.alignment.method, "resource-timing");
  assert.equal(s.network.alignment.matches, 2);
  assert.equal(s.network.lastBeforeRenderEndMs, 85);
  assert.equal(s.network.lastAfterRenderEndMs, 405);
  assert.equal(s.network.endedAfterUsable, 1);
  assert.equal(s.network.unattributed, 0);
  assert.deepEqual(Object.keys(s.network.categories).sort(), [
    "cinemeta /meta/movie/{x}",
    "tmdb /3/movie/{x}"
  ]);
  assert.equal(s.cpu.status, "ok");
  assert.equal(s.cpu.windows[0].self[0][0], "parseJson@app.bundle.js:0:20");
  assert.ok(
    s.timeline.findIndex((e) => e[2] === "metaRendered") <
      s.timeline.findIndex((e) => e[1] === "longtask")
  );
  assert.deepEqual(findLeaks(s), []);
  assert.equal(JSON.stringify(s).includes("603692"), false);
});

test("trial summary without network or profile marks them, it does not invent data", () => {
  const s = summarizeTrial({
    page: { samples: [], longtasks: [], res: [] },
    net: null,
    profile: undefined
  });
  assert.equal(s.network.status, "NOT_AVAILABLE");
  assert.equal(s.cpu.status, "NOT_RUN");
  assert.deepEqual(s.timeline, []);
  const failed = summarizeTrial({
    page: {},
    net: null,
    profile: { status: "INCOMPLETE", reason: "x" }
  });
  assert.equal(failed.cpu.status, "INCOMPLETE");
  assert.equal(failed.requests, 0);
});

test("timeline orders markers, requests and long tasks", () => {
  const t = buildTimeline(
    { visibleMs: 50, usableMs: null, samples: 3 },
    [
      {
        startMs: 10,
        endMs: 90,
        provider: "tmdb",
        category: "/3/movie/{x}",
        phase: "after-render",
        outcome: "finished",
        status: 200,
        resourceType: "Fetch"
      }
    ],
    [[60, 120]]
  );
  assert.deepEqual(
    t.map((e) => e[1]),
    ["request", "marker", "longtask", "response"]
  );
});

test("timeouts reject instead of hanging", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, "never"),
    /timeout: never after 20 ms/
  );
  assert.equal(await withTimeout(Promise.resolve(7), 20, "fast"), 7);
});

test("native frames are labelled native; the recorder never becomes the heaviest path", () => {
  const s = sanitizeInitiator({
    type: "script",
    stack: { callFrames: [{ functionName: "focus", url: "", lineNumber: -1, columnNumber: -1 }] }
  });
  assert.deepEqual(s.frames, ["focus@(native)"]);
  const a = attributeProfile(fixtureProfile({ hotSamples: 5 }), { anchorAt: 2 });
  assert.equal(a.whole.recorderMs, 20);
  assert.deepEqual(a.whole.heaviestPath, [
    "enrichMeta@app.bundle.js:0:10",
    "parseJson@app.bundle.js:0:20"
  ]);
});

test("script names that look like keys are not kept", () => {
  const p = fixtureProfile();
  p.nodes[3].callFrame.url = "https://cdn.example.net/a/Zx81Kq0pLm3Nw7Rt5Yv2Bc9Df4Gh.js";
  assert.equal(sanitizeProfile(p).nodes[3].callFrame.url, "(script)");
  assert.equal(sanitizeProfile(p).nodes[2].callFrame.url, "app.bundle.js");
});
