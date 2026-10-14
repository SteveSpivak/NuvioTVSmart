// Set the row-window switch, reload, and wait until Home is ready.
// The switch is read once at page start, so a reload is required. Not a television measurement.
// Usage: node row-window-boot.mjs on|off
import { CDP_URL, connect, sleep, KEYS } from "./lib.mjs";

const on = process.argv[2] === "on";
const expectRows = Number(process.env.ROWS || 20);
let c = await connect();
const stored = await c.ev(
  `(() => { ${on ? 'localStorage.setItem("labRowWindow","1")' : 'localStorage.removeItem("labRowWindow")'}; return localStorage.getItem("labRowWindow"); })()`
);
console.log("stored", stored);
await c.send("Page.reload", { ignoreCache: true });
c.close();

const probe = `(()=>{const h=document.getElementById("home");const rows=document.querySelectorAll("#home .home-row").length;const imgs=[...document.querySelectorAll("#home img")].filter(i=>{const b=i.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth});const withSrc=imgs.filter(i=>i.getAttribute("src"));const loaded=withSrc.filter(i=>i.complete&&i.naturalWidth>0).length;const pending=withSrc.length-loaded;const vis=[...document.querySelectorAll("#app > *")].filter(e=>e.offsetWidth>0).map(e=>e.id||e.className).join(",");const sections=[...document.querySelectorAll(".home-modern-catalogs > .home-modern-row")];return JSON.stringify({vis,homeVisible:!!h&&h.offsetWidth>0,rows,loaded,pending,placeholders:sections.filter(n=>n.dataset.windowPlaceholder==="1").length,mounted:sections.filter(n=>n.querySelector(".home-content-card")).length,switchOn:localStorage.getItem("labRowWindow")==="1"})})()`;

const deadline = Date.now() + Number(process.env.BOOT_WAIT_MS || 90000);
let last = "";
let ready = null;
while (Date.now() < deadline) {
  await sleep(700);
  let targets = [];
  try {
    targets = await (await fetch(`${CDP_URL}/json`)).json();
  } catch (_error) {
    continue;
  }
  if (!targets.some((target) => target.type === "page")) {
    continue;
  }
  c = await connect();
  const raw = await c.ev(probe);
  if (raw && raw !== last) {
    console.log(raw);
    last = raw;
  }
  const state = JSON.parse(raw || "{}");
  if (state.vis === "profileSelection") {
    await c.key(KEYS.OK);
  }
  c.close();
  if (
    state.homeVisible &&
    state.rows >= expectRows &&
    state.loaded > 0 &&
    state.pending === 0 &&
    state.switchOn === on
  ) {
    ready = state;
    break;
  }
}
if (!ready) {
  console.log("BOOT_TIMEOUT");
  process.exit(1);
}
console.log("BOOT_READY", JSON.stringify(ready));
