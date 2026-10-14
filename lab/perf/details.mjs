// Details-open timing. Extend this file only; do not add a second waterfall.
//   node details.mjs [order]     order default "CDDCCD" (C = cold, D = dwell)
//   node details.mjs --synthetic cloud fixtures, no CDP, labeled SYNTHETIC
// Safety: OK is only pressed on a card with data-action="openDetail" outside
// Continue Watching. Back is pressed once per trial.
// settledMs is the last text or element-count change. It is not usable Details,
// metadata, artwork, enrichment, a selectable source, or trailer readiness.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, KEYS, DEVICE, CDP_URL } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer\s+[a-z0-9._-]{8,}|eyJ[a-zA-Z0-9_-]{8,}|[?&][^=\s]{0,40}=)/i;

export function safeInitiator(value) {
  const name = String(value || "").toLowerCase();
  if (["xmlhttprequest", "fetch", "img", "script", "css", "link", "beacon", "iframe"].includes(name)) {
    return name;
  }
  return "other";
}

export function categorizeResource(rawUrl, initiatorType = "other") {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return { provider: "unknown", category: "unparsed", initiator: safeInitiator(initiatorType) };
  }
  const host = url.hostname.toLowerCase();
  const pathName = url.pathname.toLowerCase();
  let provider = "other";
  if (host.includes("themoviedb.org")) provider = host.startsWith("image.") ? "tmdb-image" : "tmdb";
  else if (host.includes("trakt.tv")) provider = "trakt";
  else if (host.includes("cinemeta")) provider = "cinemeta";
  else if (host.includes("supabase")) provider = "nuvio-sync";
  else if (host.includes("youtube.com") || host.includes("youtu.be")) provider = "youtube";
  else if (host.includes("stremio") || host.endsWith(".strem.io")) provider = "addon";

  let category = "other";
  if (provider === "tmdb" || provider === "tmdb-image") {
    if (pathName.includes("/movie")) category = "movie";
    else if (pathName.includes("/tv")) category = "tv";
    else if (pathName.includes("/find")) category = "find";
    else if (pathName.includes("/search")) category = "search";
    else if (pathName.includes("/configuration")) category = "configuration";
    else if (provider === "tmdb-image") category = "image";
  } else if (provider === "trakt") {
    if (pathName.includes("watched")) category = "watched";
    else if (pathName.includes("comment")) category = "comments";
    else if (pathName.includes("related")) category = "related";
    else if (pathName.includes("/users/")) category = "user";
  } else if (provider === "cinemeta" || provider === "addon") {
    if (pathName.includes("/meta")) category = "meta";
    else if (pathName.includes("/catalog")) category = "catalog";
    else if (pathName.includes("/stream")) category = "stream";
  } else if (provider === "youtube") {
    category = pathName.includes("/embed") || pathName.includes("/iframe_api") ? "player" : "other";
  } else if (provider === "nuvio-sync") {
    category = pathName.includes("rpc") ? "rpc" : "other";
  }
  const role =
    provider === "trakt" && (category === "comments" || category === "related")
      ? "optional-candidate"
      : "unknown";
  return { provider, category, role, initiator: safeInitiator(initiatorType) };
}

export function timingFromResource(entry = {}, originMs = 0) {
  const start = Number(entry.startTime);
  const end = Number(entry.responseEnd);
  const responseStart = Number(entry.responseStart);
  const startMs = Number.isFinite(start) ? Math.round(start - originMs) : null;
  const endMs = Number.isFinite(end) && end > 0 ? Math.round(end - originMs) : null;
  const ttfbMs =
    Number.isFinite(responseStart) && responseStart > 0 && Number.isFinite(start)
      ? Math.round(responseStart - start)
      : null;
  const status = Number.isFinite(Number(entry.responseStatus)) ? Number(entry.responseStatus) : null;
  const transfer = Number(entry.transferSize);
  const decoded = Number(entry.decodedBodySize);
  let cache = "unknown";
  if (Number.isFinite(transfer) && transfer === 0 && Number.isFinite(decoded) && decoded > 0) cache = "memory-or-disk";
  else if (Number.isFinite(transfer) && transfer > 0) cache = "network";
  const incomplete = endMs == null || (startMs != null && endMs < startMs);
  const failed = incomplete || (status != null && status >= 400);
  return { startMs, endMs, ttfbMs, status, cache, failed, incomplete };
}

function firstSample(samples, index, predicate) {
  const hit = samples.find((sample) => predicate(sample));
  return hit ? hit[index] : null;
}

export function markersFromSamples(samples = []) {
  const visibleMs = firstSample(samples, 0, (sample) => sample[1] === 1);
  const usableMs = firstSample(samples, 0, (sample) => sample[1] === 1 && sample[4] === 1);
  const metadataReadyMs = firstSample(samples, 0, (sample) => sample[1] === 1 && sample[5] === 1);
  const firstArtworkMs = firstSample(samples, 0, (sample) => sample[1] === 1 && sample[6] === 1);
  const enrichmentCompleteMs = firstSample(samples, 0, (sample) => sample[1] === 1 && sample[7] === 1);
  const firstSelectableSourceMs = firstSample(samples, 0, (sample) => sample[8] === 1);
  const trailerReadyMs = firstSample(samples, 0, (sample) => sample[9] === 1);
  const maxText = Math.max(0, ...samples.map((sample) => Number(sample[2]) || 0));
  const contentMs = firstSample(
    samples,
    0,
    (sample) => sample[2] >= maxText * 0.9 && sample[2] > 0
  );
  let settledMs = null;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i][2] !== samples[i - 1][2] || samples[i][3] !== samples[i - 1][3]) {
      settledMs = samples[i][0];
    }
  }
  return {
    visibleMs,
    usableMs,
    metadataReadyMs,
    firstArtworkMs,
    enrichmentCompleteMs,
    firstSelectableSourceMs,
    trailerReadyMs,
    contentMs,
    settledMs
  };
}

export function buildReport({
  sessionId,
  label = "SYNTHETIC",
  synthetic = false,
  samples = [],
  requests = [],
  longtasks = [],
  jsonParseMs = null,
  normalizeMs = null
} = {}) {
  const markers = markersFromSamples(samples);
  const rows = requests.map((entry) => ({
    sessionId,
    provider: entry.provider,
    category: entry.category,
    role: entry.role || "unknown",
    initiator: safeInitiator(entry.initiator),
    startMs: entry.startMs,
    endMs: entry.endMs,
    ttfbMs: entry.ttfbMs ?? null,
    status: entry.status ?? null,
    cache: entry.cache || "unknown",
    failed: Boolean(entry.failed),
    incomplete: Boolean(entry.incomplete)
  }));
  return {
    sessionId,
    label,
    synthetic: Boolean(synthetic),
    clock: "performance.now",
    markers,
    requests: rows,
    longTasks: longtasks.map((task) => ({
      startMs: task[0],
      durationMs: task[1]
    })),
    jsonParseMs,
    normalizeMs,
    timingSupport: jsonParseMs == null && normalizeMs == null ? "unsupported" : "provided",
    note: "settledMs is the last text or element-count change. It is not usable, metadata, artwork, enrichment, source, or trailer readiness."
  };
}

export function walkStrings(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => walkStrings(entry, found));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => walkStrings(entry, found));
  return found;
}

export function assertSafe(report) {
  const strings = walkStrings(report);
  const hit = strings.find((value) => SECRET.test(value) || /https?:\/\//i.test(value));
  if (hit) return { ok: false, reason: "redaction-failure" };
  if (!report?.sessionId || typeof report.sessionId !== "string") {
    return { ok: false, reason: "missing-session" };
  }
  return { ok: true, reason: "redacted" };
}

export function classifyReport(report) {
  if (!report?.sessionId) return { verdict: "INVALID", reason: "missing-session" };
  const markers = report.markers || {};
  const later = [
    "usableMs",
    "metadataReadyMs",
    "firstArtworkMs",
    "enrichmentCompleteMs",
    "trailerReadyMs"
  ];
  if (markers.visibleMs != null) {
    for (const key of later) {
      if (markers[key] != null && markers[key] < markers.visibleMs) {
        return { verdict: "INVALID", reason: "unexpected-ordering" };
      }
    }
  }
  for (const row of report.requests || []) {
    if (row.startMs != null && row.endMs != null && row.endMs < row.startMs) {
      return { verdict: "INVALID", reason: "unexpected-ordering" };
    }
    if (!row.provider || !row.category || !row.role) {
      return { verdict: "INVALID", reason: "missing-category" };
    }
    if (row.sessionId && row.sessionId !== report.sessionId) {
      return { verdict: "INVALID", reason: "session-mismatch" };
    }
  }
  if (markers.visibleMs == null) return { verdict: "INCOMPLETE", reason: "details-not-visible" };
  if (!Array.isArray(report.requests)) return { verdict: "INCOMPLETE", reason: "missing-requests" };
  return { verdict: "PASS", reason: "redacted-waterfall" };
}

export function sessionId() {
  return `e0-${Math.random().toString(16).slice(2, 10)}`;
}

function collectorScript(id) {
  const sid = JSON.stringify(id);
  return `(()=>{const d=document.getElementById("detail");performance.setResourceTimingBufferSize(2000);performance.clearResourceTimings();window.__dt={sessionId:${sid},t0:performance.now(),samples:[],longtasks:[]};
  try{window.__dtObs&&window.__dtObs.disconnect();window.__dtObs=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__dt.longtasks.push([Math.round(e.startTime-window.__dt.t0),Math.round(e.duration)])});window.__dtObs.observe({entryTypes:["longtask"]})}catch(e){}
  clearInterval(window.__dtTimer);window.__dtTimer=setInterval(()=>{const vis=!!d&&d.offsetWidth>0&&getComputedStyle(d).display!=="none";
    const play=vis&&!!d.querySelector('[data-action="playDefault"],[data-action="playEpisodeStream"],[data-action="playPendingStream"]');
    const meta=vis&&!!d.querySelector(".detail-meta-stack,.detail-meta-row");
    const art=vis&&[...d.querySelectorAll("img")].some(i=>i.complete&&i.naturalWidth>0);
    const enrich=vis&&!!d.querySelector(".detail-meta-genres,.series-detail-credits,.detail-credits");
    const source=!!document.querySelector('[data-action="playStream"],[data-stream-row]:not([hidden])');
    const trailer=!!document.querySelector(".detail-trailer-ready");
    const imgs=vis?[...d.querySelectorAll("img")]:[];
    window.__dt.samples.push([Math.round(performance.now()-window.__dt.t0),vis?1:0,vis?d.innerText.length:0,vis?d.getElementsByTagName("*").length:0,play&&meta?1:0,meta?1:0,art?1:0,enrich?1:0,source?1:0,trailer?1:0,imgs.filter(i=>i.complete&&i.naturalWidth>0).length])},50);return true})()`;
}

function collectScript() {
  const categorize = categorizeResource.toString();
  const timing = timingFromResource.toString();
  return `(()=>{clearInterval(window.__dtTimer);const t0=window.__dt.t0;const categorize=${categorize};const timingFromResource=${timing};
  const res=performance.getEntriesByType("resource").filter(e=>e.startTime>=t0).map(e=>{const kind=categorize(e.name,e.initiatorType);const times=timingFromResource(e,t0);return {provider:kind.provider,category:kind.category,role:kind.role,initiator:kind.initiator,startMs:times.startMs,endMs:times.endMs,ttfbMs:times.ttfbMs,status:times.status,cache:times.cache,failed:times.failed,incomplete:times.incomplete}});
  return JSON.stringify({sessionId:window.__dt.sessionId,samples:window.__dt.samples,longtasks:window.__dt.longtasks,requests:res})})()`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1));
  const raw = fs.readFileSync(file, "utf8");
  if (SECRET.test(raw) || /https?:\/\//i.test(raw)) {
    fs.rmSync(file, { force: true });
    return false;
  }
  return true;
}

export function syntheticFixtures() {
  const id = "e0-synthetic";
  const happySamples = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [180, 1, 12, 20, 0, 0, 0, 0, 0, 0],
    [420, 1, 40, 30, 1, 1, 0, 0, 0, 0],
    [700, 1, 40, 31, 1, 1, 1, 0, 0, 0],
    [1100, 1, 80, 40, 1, 1, 1, 1, 0, 0],
    [1600, 1, 80, 41, 1, 1, 1, 1, 1, 0],
    [2000, 1, 90, 42, 1, 1, 1, 1, 1, 1],
    [9000, 1, 200, 80, 1, 1, 1, 1, 1, 1]
  ];
  const tokenUrl = "https://api.themoviedb.org/3/movie/550?api_key=SECRETTOKEN&title=Private%20Title%20Alpha";
  const categorized = categorizeResource(tokenUrl, "fetch");
  const timed = timingFromResource(
    { startTime: 200, responseStart: 260, responseEnd: 340, transferSize: 1200, decodedBodySize: 800 },
    0
  );
  const happy = buildReport({
    sessionId: id,
    label: "SYNTHETIC",
    synthetic: true,
    samples: happySamples,
    requests: [
      { ...categorized, ...timed },
      {
        ...categorizeResource("https://api.trakt.tv/comments/private-title", "fetch"),
        ...timingFromResource(
          { startTime: 800, responseStart: 900, responseEnd: 1400, transferSize: 0, decodedBodySize: 40 },
          0
        )
      }
    ],
    longtasks: [[420, 180]]
  });
  const incomplete = buildReport({
    sessionId: id,
    label: "SYNTHETIC",
    synthetic: true,
    samples: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    requests: []
  });
  const ordered = buildReport({
    sessionId: id,
    label: "SYNTHETIC",
    synthetic: true,
    samples: [[50, 0, 0, 0, 1, 1, 0, 0, 0, 0], [80, 1, 10, 4, 1, 1, 0, 0, 0, 0]],
    requests: [{ ...categorized, startMs: 90, endMs: 40, failed: true, incomplete: true }]
  });
  return { id, tokenUrl, happy, incomplete, ordered };
}

async function runSynthetic() {
  const { tokenUrl, happy, incomplete, ordered } = syntheticFixtures();
  const checks = [];
  const happyClass = classifyReport(happy);
  const happySafe = assertSafe(happy);
  checks.push({
    id: "synthetic-happy",
    ok:
      happyClass.verdict === "PASS" &&
      happySafe.ok &&
      happy.markers.usableMs === 420 &&
      happy.markers.settledMs === 9000 &&
      happy.markers.usableMs !== happy.markers.settledMs &&
      happy.markers.metadataReadyMs === 420 &&
      happy.markers.firstArtworkMs === 700 &&
      happy.markers.enrichmentCompleteMs === 1100 &&
      happy.markers.firstSelectableSourceMs === 1600 &&
      happy.markers.trailerReadyMs === 2000 &&
      happy.requests.every((row) => row.sessionId === happy.sessionId) &&
      !JSON.stringify(happy).includes("SECRETTOKEN") &&
      !JSON.stringify(happy).includes("Private Title Alpha") &&
      !JSON.stringify(happy).includes(tokenUrl)
  });
  checks.push({
    id: "synthetic-incomplete",
    ok: classifyReport(incomplete).verdict === "INCOMPLETE"
  });
  checks.push({
    id: "synthetic-ordering",
    ok: classifyReport(ordered).verdict === "INVALID"
  });
  const poisoned = { ...happy, leak: tokenUrl };
  checks.push({ id: "synthetic-poison-rejected", ok: assertSafe(poisoned).ok === false });
  const out = path.join(HERE, "../results/synthetic/e0-details.json");
  const written = writeJson(out, { ...happy, verdict: happyClass.verdict, reason: happyClass.reason });
  checks.push({ id: "synthetic-file-kept", ok: written && fs.existsSync(out) });
  const poisonFile = path.join(HERE, "../results/synthetic/e0-poison.json");
  const poisonWritten = writeJson(poisonFile, poisoned);
  checks.push({
    id: "synthetic-poison-file-deleted",
    ok: poisonWritten === false && !fs.existsSync(poisonFile)
  });
  const source = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const clears = source.split("\n").filter((line) => line.includes("performance.clearResourceTimings()") && !line.includes("split(")).length;
  checks.push({ id: "clear-resource-timings-only-in-recorder", ok: clears === 1 });
  const failed = checks.filter((entry) => !entry.ok);
  console.log(
    JSON.stringify(
      {
        label: "SYNTHETIC",
        verdict: failed.length ? "FAIL" : "PASS",
        checks,
        markers: happy.markers,
        providers: happy.requests.map((row) => row.provider + ":" + row.category)
      },
      null,
      1
    )
  );
  process.exit(failed.length ? 1 : 0);
}

async function cdpReachable() {
  try {
    const response = await fetch(`${CDP_URL}/json`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch (error) {
    const message = String(error?.cause?.code || error?.code || error?.name || "cdp-unavailable");
    return { ok: false, error: message.slice(0, 80) };
  }
}

async function runLive(order) {
  const reach = await cdpReachable();
  if (reach !== true) {
    const file = path.join(HERE, "../results/blocked/e0-cdp.json");
    writeJson(file, {
      sessionId: sessionId(),
      label: "BLOCKED",
      synthetic: false,
      verdict: "INCOMPLETE",
      reason: "cdp-unavailable",
      cdpUrlHost: "configured-endpoint",
      error: reach.error || "http-not-ok",
      emulator: "CHROME is unset and no Chromium binary is on PATH. lab/emu/start.mjs cannot start. This is not a TV measurement.",
      note: "No television or emulator CDP endpoint answered. This is not a TV measurement."
    });
    console.log("INCOMPLETE cdp-unavailable");
    process.exit(2);
  }
  const c = await connect();
  const dwellMs = +(process.env.DWELL_MS || 5000);
  const waitMs = +(process.env.WAIT_MS || 12000);
  const back = ["GoBack", 461];
  const safeCard = () =>
    c.ev(`(()=>{const a=document.activeElement;if(!a||!a.closest(".home-row"))return "not_in_row";
    if(a.closest(".home-row-continue"))return "continue_row";
    return a.dataset.action==="openDetail"?"ok":"action:"+(a.dataset.action||"none")})()`);
  const results = [];
  let verdict = "PASS";
  for (const [i, kind] of [...order].entries()) {
    if (!(await c.onHome())) {
      verdict = "INCOMPLETE";
      console.log("INCOMPLETE not on Home before trial", i + 1);
      break;
    }
    await c.key(KEYS.R);
    await sleep(kind === "D" ? dwellMs : 400);
    const safe = await safeCard();
    if (safe !== "ok") {
      console.log("SKIP trial", i + 1, "focused card is", safe);
      continue;
    }
    const id = sessionId();
    await c.ev(collectorScript(id));
    await c.key(KEYS.OK);
    await sleep(waitMs);
    let raw;
    try {
      raw = await c.ev(collectScript());
    } catch (error) {
      verdict = "INCOMPLETE";
      results.push({ sessionId: id, verdict: "INCOMPLETE", reason: "cdp-disconnect", error: error?.name || "cdp" });
      break;
    }
    if (!raw) {
      verdict = "INCOMPLETE";
      results.push({ sessionId: id, verdict: "INCOMPLETE", reason: "empty-collect" });
      break;
    }
    const collected = JSON.parse(raw);
    const report = buildReport({
      sessionId: collected.sessionId || id,
      label: DEVICE,
      synthetic: false,
      samples: collected.samples || [],
      requests: collected.requests || [],
      longtasks: collected.longtasks || []
    });
    const safety = assertSafe(report);
    const classified = safety.ok ? classifyReport(report) : { verdict: "INVALID", reason: safety.reason };
    report.verdict = classified.verdict;
    report.reason = classified.reason;
    report.kind = kind === "D" ? "dwell" : "cold";
    if (classified.verdict !== "PASS") verdict = classified.verdict;
    results.push(report);
    console.log(JSON.stringify({ trial: i + 1, verdict: report.verdict, markers: report.markers }));
    if (report.markers.visibleMs == null) {
      console.log("INCOMPLETE details screen never appeared; not pressing Back");
      break;
    }
    await c.key(back);
    await sleep(2500);
    if (!(await c.onHome())) {
      verdict = "INCOMPLETE";
      console.log("INCOMPLETE Home did not return after one Back");
      break;
    }
  }
  if (!results.length) verdict = "INCOMPLETE";
  const out = path.join(
    HERE,
    "../results",
    DEVICE,
    process.env.LABEL || `details_${new Date().toISOString().slice(0, 10)}`,
    "details.json"
  );
  const payload = { order, dwellMs, device: DEVICE, verdict, results };
  const kept = writeJson(out, payload);
  if (!kept) {
    console.log("INVALID redaction-failure; deleted", out);
    c.close();
    process.exit(1);
  }
  console.log(verdict, "saved", out);
  c.close();
  process.exit(verdict === "PASS" ? 0 : verdict === "INVALID" ? 1 : 2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--synthetic")) {
    await runSynthetic();
  } else {
    const order = (process.argv.find((arg) => /^[CD]+$/i.test(arg)) || "CDDCCD").toUpperCase();
    await runLive(order);
  }
}
