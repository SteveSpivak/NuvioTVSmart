// CPU profile + frame timing + long tasks while D-pad keys are sent. Writes prof_<label>.cpuprofile and .meta.json
// into the current directory. Usage: node prof.mjs <label> [sequence]
// node prof.mjs --synthetic runs cloud fixtures and does not claim TV timings.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, drive, sleep, DEFAULT_SEQ, DEVICE, CDP_URL } from "./lib.mjs";
import { classifyTrace } from "./trace.mjs";

export const INTERESTING_FUNCTIONS = [
  "getTitleWatchedItems",
  "refreshContinueWatchingReleaseState",
  "openDetail",
  "enrichMeta",
  "normalizeMetadata",
  "discoverSources"
];

export function detectCapabilities(methods = []) {
  const available = new Set(methods);
  const required = [
    "Profiler.enable",
    "Profiler.start",
    "Profiler.stop",
    "Tracing.start",
    "Tracing.end"
  ];
  const missing = required.filter((name) => !available.has(name));
  return {
    profiler: missing.every((name) => !name.startsWith("Profiler")),
    tracing: missing.every((name) => !name.startsWith("Tracing")),
    longTaskObserver: true,
    schedulerYieldRequired: false,
    schedulerYieldPresent: available.has("scheduler.yield"),
    missing
  };
}

export function redactProfile(profile) {
  const copy = structuredClone(profile || {});
  for (const node of copy.nodes || []) {
    const frame = node.callFrame;
    if (!frame || typeof frame.url !== "string") continue;
    try {
      const url = new URL(frame.url);
      url.search = "";
      url.hash = "";
      frame.url = `${url.origin}${url.pathname}`;
    } catch {
      frame.url = "redacted";
    }
  }
  return copy;
}

export function summarizeProfile(profile) {
  if (
    !profile ||
    !Array.isArray(profile.nodes) ||
    !Array.isArray(profile.samples) ||
    !profile.samples.length
  ) {
    return { verdict: "INCOMPLETE", reason: "empty-profile", functions: [], interesting: [] };
  }
  const self = new Map();
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) || 0) + Number(deltas[i] || 0));
  }
  const children = new Map(profile.nodes.map((node) => [node.id, node.children || []]));
  const memo = new Map();
  const seen = new Set();
  function inclusive(id) {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return self.get(id) || 0;
    seen.add(id);
    let total = self.get(id) || 0;
    for (const child of children.get(id) || []) total += inclusive(child);
    seen.delete(id);
    memo.set(id, total);
    return total;
  }
  const functions = profile.nodes
    .map((node) => ({
      functionName: node.callFrame?.functionName || "(anonymous)",
      selfUs: self.get(node.id) || 0,
      inclusiveUs: inclusive(node.id)
    }))
    .filter((row) => row.selfUs || row.inclusiveUs)
    .sort((left, right) => right.selfUs - left.selfUs);
  const interesting = INTERESTING_FUNCTIONS.map((name) => {
    const hit = functions.find((row) => row.functionName === name);
    return hit
      ? { functionName: name, present: true, selfUs: hit.selfUs, inclusiveUs: hit.inclusiveUs }
      : { functionName: name, present: false, selfUs: null, inclusiveUs: null };
  });
  return { verdict: "PASS", reason: "profile-parsed", functions, interesting };
}

export function correlateTimeline({ longTasks = [], requests = [], markers = {} } = {}) {
  const overlaps = [];
  for (const task of longTasks) {
    const start = Number(task.startMs);
    const end = start + Number(task.durationMs || 0);
    const matched = (requests || []).filter((row) => {
      if (row.startMs == null || row.endMs == null) return false;
      return row.startMs < end && row.endMs > start;
    });
    overlaps.push({
      startMs: start,
      durationMs: task.durationMs,
      overlappingRequests: matched.map((row) => ({
        provider: row.provider,
        category: row.category,
        startMs: row.startMs,
        endMs: row.endMs
      }))
    });
  }
  return {
    clock: "performance.now",
    longTaskDurationMs: longTasks.reduce((sum, task) => sum + Number(task.durationMs || 0), 0),
    userVisibleMs: markers.visibleMs ?? null,
    usableMs: markers.usableMs ?? null,
    settledMs: markers.settledMs ?? null,
    overlaps,
    note: "Long-task duration is CPU overlap, not user-visible latency, and not a floor."
  };
}

export function compareProfiled(profiled, unprofiled) {
  if (!profiled || !unprofiled || profiled.visibleMs == null || unprofiled.visibleMs == null) {
    return { verdict: "INCOMPLETE", reason: "missing-unprofiled-baseline" };
  }
  return {
    verdict: "PASS",
    reason: "profiled-compared",
    visibleDeltaMs: profiled.visibleMs - unprofiled.visibleMs,
    settledDeltaMs:
      profiled.settledMs == null || unprofiled.settledMs == null
        ? null
        : profiled.settledMs - unprofiled.settledMs,
    note: "A profile changes timing. Do not trust stacks without this comparison."
  };
}

export function classifyCapture({
  capabilities,
  profileSummary,
  trace,
  comparison,
  redactionOk = true
} = {}) {
  if (!redactionOk) return { verdict: "INVALID", reason: "redaction-failure" };
  if (!capabilities?.profiler || !capabilities?.tracing) {
    return { verdict: "INCOMPLETE", reason: "unsupported-method" };
  }
  if (trace?.verdict === "INVALID" || profileSummary?.verdict === "INVALID") {
    return { verdict: "INVALID", reason: trace?.reason || profileSummary?.reason || "malformed" };
  }
  if (trace?.verdict !== "PASS")
    return { verdict: "INCOMPLETE", reason: trace?.reason || "trace-incomplete" };
  if (profileSummary?.verdict !== "PASS") {
    return { verdict: "INCOMPLETE", reason: profileSummary?.reason || "profile-incomplete" };
  }
  if (comparison?.verdict !== "PASS") {
    return { verdict: "INCOMPLETE", reason: comparison?.reason || "missing-unprofiled-baseline" };
  }
  return { verdict: "PASS", reason: "correlated" };
}

function syntheticProfile() {
  return {
    nodes: [
      {
        id: 1,
        callFrame: { functionName: "(root)", url: "https://nuvio.local/app.js?token=SECRET" },
        children: [2]
      },
      {
        id: 2,
        callFrame: { functionName: "getTitleWatchedItems", url: "https://nuvio.local/watched.js" },
        children: [3]
      },
      {
        id: 3,
        callFrame: { functionName: "normalizeMetadata", url: "https://nuvio.local/meta.js" },
        children: []
      }
    ],
    samples: [2, 3, 2],
    timeDeltas: [1000, 500, 250]
  };
}

async function runSynthetic() {
  const capabilities = detectCapabilities([
    "Profiler.enable",
    "Profiler.start",
    "Profiler.stop",
    "Tracing.start",
    "Tracing.end"
  ]);
  const unsupported = detectCapabilities(["Tracing.start"]);
  const profile = redactProfile(syntheticProfile());
  const summary = summarizeProfile(profile);
  const empty = summarizeProfile({ nodes: [], samples: [] });
  const trace = classifyTrace({
    events: [
      { name: "RunTask", ts: 10 },
      { name: "RunTask", ts: 20 }
    ],
    complete: true
  });
  const partial = classifyTrace({ events: [{ name: "RunTask", ts: 10 }], complete: false });
  const malformed = classifyTrace({ events: [{ ts: 10 }], complete: true });
  const unordered = classifyTrace({
    events: [
      { name: "RunTask", ts: 30 },
      { name: "RunTask", ts: 10 }
    ],
    complete: true
  });
  const navigated = classifyTrace({
    events: [
      { name: "RunTask", ts: 10 },
      { name: "navigationStart", ts: 15 }
    ],
    complete: true
  });
  const correlation = correlateTimeline({
    longTasks: [{ startMs: 100, durationMs: 40 }],
    requests: [{ provider: "tmdb", category: "movie", startMs: 90, endMs: 150 }],
    markers: { visibleMs: 180, usableMs: 420, settledMs: 9000 }
  });
  const comparison = compareProfiled(
    { visibleMs: 200, settledMs: 1000 },
    { visibleMs: 180, settledMs: 900 }
  );
  const missingBaseline = compareProfiled({ visibleMs: 200 }, null);
  const capture = classifyCapture({
    capabilities,
    profileSummary: summary,
    trace,
    comparison,
    redactionOk: !JSON.stringify(profile).includes("SECRET")
  });
  const checks = [
    { id: "yield-not-required", ok: capabilities.schedulerYieldRequired === false },
    {
      id: "unsupported-is-incomplete",
      ok:
        classifyCapture({ capabilities: unsupported, profileSummary: summary, trace, comparison })
          .verdict === "INCOMPLETE"
    },
    {
      id: "self-versus-inclusive",
      ok:
        summary.interesting.find((row) => row.functionName === "getTitleWatchedItems")?.selfUs ===
          1250 &&
        summary.interesting.find((row) => row.functionName === "getTitleWatchedItems")
          ?.inclusiveUs === 1750
    },
    {
      id: "absent-function-not-invented",
      ok:
        summary.interesting.find((row) => row.functionName === "discoverSources")?.present === false
    },
    { id: "empty-profile-incomplete", ok: empty.verdict === "INCOMPLETE" },
    { id: "partial-trace-incomplete", ok: partial.verdict === "INCOMPLETE" },
    { id: "malformed-trace-invalid", ok: malformed.verdict === "INVALID" },
    { id: "unordered-trace-invalid", ok: unordered.verdict === "INVALID" },
    { id: "navigation-invalid", ok: navigated.verdict === "INVALID" },
    {
      id: "redaction",
      ok: !JSON.stringify(profile).includes("SECRET") && !JSON.stringify(profile).includes("token=")
    },
    {
      id: "correlation-not-floor",
      ok:
        correlation.longTaskDurationMs === 40 &&
        correlation.userVisibleMs === 180 &&
        correlation.longTaskDurationMs !== correlation.userVisibleMs
    },
    { id: "missing-baseline-incomplete", ok: missingBaseline.verdict === "INCOMPLETE" },
    { id: "synthetic-capture-pass", ok: capture.verdict === "PASS" }
  ];
  const failed = checks.filter((entry) => !entry.ok);
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../results/synthetic");
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    label: "SYNTHETIC",
    verdict: failed.length ? "FAIL" : capture.verdict,
    reason: failed.length ? "fixture-failed" : capture.reason,
    checks,
    summary,
    correlation,
    comparison,
    note: "These stacks are fixture samples. They are not the historical 13s Home freeze, 6s watched match, or 2.2s addon-settings cost, and they are not a TV measurement."
  };
  const file = path.join(outDir, "e1-profile.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 1));
  if (/SECRET|token=|https?:\/\//.test(fs.readFileSync(file, "utf8"))) {
    fs.rmSync(file, { force: true });
    console.log("INVALID redaction-failure");
    process.exit(1);
  }
  console.log(
    JSON.stringify({ verdict: payload.verdict, failed: failed.map((entry) => entry.id) })
  );
  process.exit(failed.length ? 1 : 0);
}

async function cdpReachable() {
  try {
    const response = await fetch(`${CDP_URL}/json`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? true : { error: "http-not-ok" };
  } catch (error) {
    return { error: String(error?.cause?.code || error?.code || error?.name || "cdp-unavailable") };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {
  // imported for classification only
} else if (process.argv.includes("--synthetic")) {
  await runSynthetic();
} else {
  const reach = await cdpReachable();
  if (reach !== true) {
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../results/blocked");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "e1-cdp.json"),
      JSON.stringify(
        {
          label: "BLOCKED",
          verdict: "INCOMPLETE",
          reason: "cdp-unavailable",
          error: reach.error || "cdp-unavailable",
          note: "Profiler.enable and Tracing.start were not run. No TV stack was measured. Historical long-task sums are not a floor."
        },
        null,
        1
      )
    );
    console.log("INCOMPLETE cdp-unavailable");
    process.exit(2);
  }
  const liveLabel = process.argv[2] || "run";
  const liveSeq = process.argv[3] || DEFAULT_SEQ;
  await runLive(liveLabel, liveSeq);
}

async function runLive(label, seq) {
  const c = await connect();
  const state = () =>
    c.ev(
      `(()=>JSON.stringify({vis:[...document.querySelectorAll("#app > *")].filter(e=>e.offsetWidth>0).map(e=>e.id||e.className).join(","),dom:document.getElementsByTagName("*").length,imgs:document.images.length,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null}))()`
    );
  const metrics = async () =>
    Object.fromEntries(
      ((await c.send("Performance.getMetrics")).result?.metrics || []).map((m) => [m.name, m.value])
    );
  console.log("before", await state());
  await c.send("Performance.enable");
  // Frame recorder (requestAnimationFrame gaps) and long-task observer inside the page.
  await c.ev(`(()=>{const w=window;w.__pf={f:[],on:true,last:performance.now()};const tick=n=>{if(!w.__pf.on)return;w.__pf.f.push(n-w.__pf.last);w.__pf.last=n;requestAnimationFrame(tick)};requestAnimationFrame(tick);
  w.__pf.lt=[];try{w.__pf.po=new PerformanceObserver(l=>{for(const e of l.getEntries())w.__pf.lt.push(Math.round(e.duration))});w.__pf.po.observe({entryTypes:["longtask"]})}catch(e){}return 1})()`);
  const m0 = await metrics();
  const enabled = await c.send("Profiler.enable");
  if (enabled?.error) {
    console.log("INCOMPLETE unsupported-method", JSON.stringify(enabled.error));
    c.close();
    process.exit(2);
  }
  await c.send("Profiler.setSamplingInterval", { interval: 500 });
  await c.send("Profiler.start");
  const t0 = Date.now();
  const { presses, aborted } = await drive(c, seq);
  await sleep(1500);
  const stopped = await c.send("Profiler.stop");
  const prof = redactProfile(stopped.result?.profile);
  const summary = summarizeProfile(prof);
  const wallMs = Date.now() - t0;
  const m1 = await metrics();
  const frames = JSON.parse(
    await c.ev(
      `(()=>{const w=window;w.__pf.on=false;try{w.__pf.po.disconnect()}catch(e){};const r=JSON.stringify({f:w.__pf.f.map(x=>Math.round(x)),lt:w.__pf.lt});delete w.__pf;return r})()`
    )
  );
  console.log("after", await state());
  const profileText = JSON.stringify(prof);
  if (/[?&][^=\s]+=|api[_-]?key|access[_-]?token/i.test(profileText)) {
    console.log("INVALID redaction-failure");
    c.close();
    process.exit(1);
  }
  fs.writeFileSync(`prof_${label}.cpuprofile`, profileText);
  const d = {};
  for (const k of [
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
    "TaskDuration",
    "LayoutCount",
    "RecalcStyleCount",
    "JSHeapUsedSize",
    "Nodes",
    "JSEventListeners"
  ])
    d[k] = [m0[k], m1[k]];
  fs.writeFileSync(
    `prof_${label}.meta.json`,
    JSON.stringify({
      label,
      device: DEVICE,
      throttle: process.env.THROTTLE || null,
      seq,
      presses,
      aborted,
      wallMs,
      metrics: d,
      frames,
      profileSummary: summary,
      comparison: { verdict: "INCOMPLETE", reason: "missing-unprofiled-baseline" },
      note: "Stacks are not trusted until an unprofiled visible/settle comparison exists. Long-task sums are not a floor."
    })
  );
  console.log(
    aborted ? "INVALID_ABORTED" : "INCOMPLETE",
    label,
    "wallMs",
    wallMs,
    "presses",
    presses
  );
  await c.send("Profiler.disable");
  c.close();
  process.exit(aborted ? 3 : summary.verdict === "INVALID" ? 1 : 2);
}
