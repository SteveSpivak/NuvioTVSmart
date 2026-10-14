// A/B blocks for one lab fix: per block, set or clear localStorage "nuvioLabOff", reload the app (fresh
// in-memory caches), wait for Home, move focus down to the first row of title cards, then run details.mjs.
//   FIX=watchedMemo node details_ab.mjs [blocks] [order]
//   blocks default "ABBA" (A = fix on, B = fix off); order is passed to details.mjs (default "CDDC")
// Safety: keys are only pressed while Home is visible with focus in a Home row (see details.mjs).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, KEYS } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX;
if (!FIX) throw new Error("set FIX to the lab fix name, e.g. FIX=watchedMemo");
const BLOCKS = (process.argv[2] || "ABBA").toUpperCase();
const ORDER = process.argv[3] || "CDDC";
const STAMP = process.env.STAMP || new Date().toISOString().slice(0, 10);

for (const [i, b] of [...BLOCKS].entries()) {
  const c = await connect();
  const off = b === "B" ? FIX : "";
  await c.ev(
    off
      ? `localStorage.setItem("nuvioLabOff",${JSON.stringify(off)})`
      : `localStorage.removeItem("nuvioLabOff")`
  );
  await c.send("Page.reload", { ignoreCache: false });
  c.close();
  await sleep(3000);

  let h = null;
  for (let t = 0; t < 30; t++) {
    try {
      h = await connect();
      const cards = await h.ev(
        'document.getElementById("home")&&document.getElementById("home").offsetWidth>0?document.querySelectorAll(\'.home-row [data-action="openDetail"]\').length:0'
      );
      if (cards >= 50) break;
      h.close();
      h = null;
    } catch (_) {
      h = null;
    }
    await sleep(2000);
  }
  if (!h) {
    console.log("ABORT Home did not load after reload, block", i + 1);
    process.exit(1);
  }
  await sleep(8000); // let the startup requests settle before measuring
  const labOff = await h.ev('localStorage.getItem("nuvioLabOff")');
  if ((labOff || "") !== off) {
    console.log("ABORT switch not set as expected, block", i + 1, labOff);
    process.exit(1);
  }
  // Move down to the first row of title cards: Continue Watching and collection-folder rows are skipped.
  for (let d = 0; d < 12; d++) {
    const where = await h.ev(
      '(()=>{const a=document.activeElement;return !a||!a.closest(".home-row")?"none":a.closest(".home-row-continue")?"continue":a.dataset.action==="openDetail"?"title":"other"})()'
    );
    if (where === "title") break;
    if (d === 11 || where === "none" || !(await h.onHome())) {
      console.log("ABORT no row of title cards reachable from Home focus, block", i + 1);
      process.exit(1);
    }
    await h.key(KEYS.D);
    await sleep(1500);
  }
  h.close();

  const label = `${STAMP}_ab_${FIX}_${i + 1}${b}`;
  console.log(`BLOCK ${i + 1} ${b} (${off ? "fix off" : "fix on"}) -> ${label}`);
  const r = spawnSync("node", [path.join(HERE, "details_v1.mjs"), ORDER], {
    stdio: "inherit",
    env: { ...process.env, LABEL: label, PROFILE: "1" }
  });
  if (r.status !== 0) {
    console.log("ABORT details.mjs failed, block", i + 1);
    process.exit(1);
  }
  const n = JSON.parse(fs.readFileSync(path.join(HERE, "../results/tv", label, "details.json")))
    .results.length;
  if (n < ORDER.length) {
    console.log(`ABORT block ${i + 1} recorded ${n} of ${ORDER.length} opens`);
    process.exit(1);
  }
}

const c = await connect();
await c.ev('localStorage.removeItem("nuvioLabOff")');
c.close();
console.log("DONE switch cleared (all lab fixes on)");
process.exit(0);
