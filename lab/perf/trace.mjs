// Timeline trace (style, layout, paint, composite, raster, image decode) while D-pad keys are sent.
// Writes trace_<label>.json into the current directory. Usage: node trace.mjs <label> [sequence]
import fs from "node:fs";
import { connect, drive, sleep, DEFAULT_SEQ, DEVICE } from "./lib.mjs";
const label = process.argv[2] || "run";
const seq = process.argv[3] || DEFAULT_SEQ;
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
await Promise.race([complete, sleep(60000)]);
fs.writeFileSync(
  `trace_${label}.json`,
  JSON.stringify({ wallMs, presses, seq, device: DEVICE, aborted, events })
);
console.log(
  aborted ? "INVALID_ABORTED" : "saved",
  label,
  "wallMs",
  wallMs,
  "presses",
  presses,
  "events",
  events.length
);
c.close();
process.exit(aborted ? 3 : 0);
