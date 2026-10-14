// Home load A/B for one lab fix: per block, set or clear localStorage "nuvioLabOff", reload the app and
// record long tasks plus a CPU profile for the first LOAD_MS of Home loading. No keys are pressed.
//   FIX=identityIndex node home_reload_ab.mjs [blocks]      blocks default "ABBAABBA" (A = fix on)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, DEVICE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX;
if (!FIX) throw new Error("set FIX to the lab fix name, e.g. FIX=identityIndex");
const BLOCKS = (process.argv[2] || "ABBAABBA").toUpperCase();
const LOAD_MS = +(process.env.LOAD_MS || 30000);
const OUT = path.join(
  HERE,
  "../results",
  DEVICE,
  `${process.env.STAMP || new Date().toISOString().slice(0, 10)}_home_${FIX}`
);
fs.mkdirSync(OUT, { recursive: true });

// Long tasks are recorded from the first script of the new page, so the startup freeze is included.
const OBSERVE = `window.__lt=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({entryTypes:["longtask"]})}catch(e){}`;

const results = [];
for (const [i, b] of [...BLOCKS].entries()) {
  const c = await connect();
  const off = b === "B" ? FIX : "";
  await c.ev(
    off
      ? `localStorage.setItem("nuvioLabOff",${JSON.stringify(off)})`
      : `localStorage.removeItem("nuvioLabOff")`
  );
  await c.send("Page.enable");
  const { result } = await c.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
  await c.send("Profiler.enable");
  await c.send("Profiler.setSamplingInterval", { interval: 500 });
  await c.send("Profiler.start");
  await c.send("Page.reload", { ignoreCache: false });
  await sleep(LOAD_MS);
  const prof = (await c.send("Profiler.stop")).result?.profile;
  await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: result.identifier });
  const s = JSON.parse(
    await c.ev(`JSON.stringify({lt:window.__lt||[],labOff:localStorage.getItem("nuvioLabOff"),
      cards:document.querySelectorAll('.home-row [data-action]').length,
      nodes:document.getElementsByTagName("*").length})`)
  );
  c.close();
  if ((s.labOff || "") !== off) {
    console.log("ABORT switch not set as expected, block", i + 1, s.labOff);
    process.exit(1);
  }
  const r = {
    block: `${i + 1}${b}`,
    fix: off ? "off" : "on",
    cards: s.cards,
    nodes: s.nodes,
    longTasks: s.lt.length,
    longTaskMs: s.lt.reduce((a, l) => a + l[1], 0),
    worstLongTaskMs: Math.max(0, ...s.lt.map((l) => l[1]))
  };
  fs.writeFileSync(path.join(OUT, `prof_block${i + 1}${b}.cpuprofile`), JSON.stringify(prof));
  results.push(r);
  console.log(JSON.stringify(r));
}
const c = await connect();
await c.ev('localStorage.removeItem("nuvioLabOff")');
c.close();
fs.writeFileSync(
  path.join(OUT, "home.json"),
  JSON.stringify({ fix: FIX, loadMs: LOAD_MS, results }, null, 1)
);
console.log("saved", OUT);
console.log("DONE switch cleared (all lab fixes on)");
process.exit(0);
