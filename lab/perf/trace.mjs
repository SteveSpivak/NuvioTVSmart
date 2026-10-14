// Timeline trace (style, layout, paint, composite, raster, image decode) while D-pad keys are sent.
// Writes trace_<label>.json into the current directory. Usage: node trace.mjs <label> [sequence]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, drive, sleep, DEFAULT_SEQ, DEVICE, CDP_URL } from "./lib.mjs";

export function classifyTrace({
  events,
  complete = false,
  timedOut = false,
  disconnected = false
} = {}) {
  if (disconnected) return { verdict: "INCOMPLETE", reason: "cdp-disconnect" };
  if (timedOut) return { verdict: "INCOMPLETE", reason: "trace-timeout" };
  if (!Array.isArray(events)) return { verdict: "INVALID", reason: "malformed-events" };
  if (!complete) return { verdict: "INCOMPLETE", reason: "missing-trace-completion" };
  if (!events.length) return { verdict: "INCOMPLETE", reason: "empty-trace" };
  let lastTs = null;
  for (const event of events) {
    if (!event || typeof event.name !== "string")
      return { verdict: "INVALID", reason: "malformed-events" };
    if (event.name === "navigationStart")
      return { verdict: "INVALID", reason: "navigation-during-capture" };
    if (typeof event.ts === "number") {
      if (lastTs != null && event.ts < lastTs)
        return { verdict: "INVALID", reason: "unexpected-ordering" };
      lastTs = event.ts;
    }
  }
  return { verdict: "PASS", reason: "trace-complete" };
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
if (isMain) {
  if (process.argv.includes("--synthetic")) {
    const complete = classifyTrace({ events: [{ name: "RunTask", ts: 1 }], complete: true });
    const missing = classifyTrace({ events: [{ name: "RunTask", ts: 1 }], complete: false });
    const ok = complete.verdict === "PASS" && missing.verdict === "INCOMPLETE";
    console.log(
      JSON.stringify({ label: "SYNTHETIC", verdict: ok ? "PASS" : "FAIL", complete, missing })
    );
    process.exit(ok ? 0 : 1);
  }
  const reach = await cdpReachable();
  if (reach !== true) {
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../results/blocked");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "e1-trace-cdp.json"),
      JSON.stringify(
        {
          label: "BLOCKED",
          verdict: "INCOMPLETE",
          reason: "cdp-unavailable",
          error: reach.error || "cdp-unavailable",
          note: "Tracing.start was not run. No TV timeline was measured."
        },
        null,
        1
      )
    );
    console.log("INCOMPLETE cdp-unavailable");
    process.exit(2);
  }
  await runLive(process.argv[2] || "run", process.argv[3] || DEFAULT_SEQ);
}

async function runLive(label, seq) {
  const c = await connect();
  const events = [];
  let done;
  const complete = new Promise((r) => (done = r));
  c.onEvent((m) => {
    if (m.method === "Tracing.dataCollected") for (const x of m.params.value) events.push(x);
    else if (m.method === "Tracing.tracingComplete") done();
  });
  const r = await c.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordUntilFull",
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "v8.execute",
        "blink.user_timing"
      ]
    }
  });
  if (r.error) {
    console.log("TRACING_START_ERROR", JSON.stringify(r.error));
    process.exit(2);
  }
  const t0 = Date.now();
  const { presses, aborted } = await drive(c, seq);
  await sleep(1500);
  const wallMs = Date.now() - t0;
  await c.send("Tracing.end");
  const finished = await Promise.race([
    complete.then(() => "complete"),
    sleep(60000).then(() => "timeout")
  ]);
  const classified = classifyTrace({
    events,
    complete: finished === "complete",
    timedOut: finished === "timeout"
  });
  const payload = {
    wallMs,
    presses,
    seq,
    device: DEVICE,
    aborted,
    verdict: classified.verdict,
    reason: classified.reason,
    events
  };
  const text = JSON.stringify(payload);
  if (/[?&][^=\s]+=|api[_-]?key|access[_-]?token/i.test(text)) {
    console.log("INVALID redaction-failure");
    c.close();
    process.exit(1);
  }
  fs.writeFileSync(`trace_${label}.json`, text);
  const verdict = aborted ? "INVALID" : classified.verdict;
  console.log(verdict, label, "wallMs", wallMs, "presses", presses, "events", events.length);
  c.close();
  process.exit(aborted ? 3 : verdict === "PASS" ? 0 : verdict === "INVALID" ? 1 : 2);
}
