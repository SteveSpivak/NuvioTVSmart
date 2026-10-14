// Break checks for the lab row window. Not a second harness: uses lab/perf/lib.mjs.
// Prints one JSON line. The caller marks each check pass or fail. Does not claim television speed.
import { connect, sleep, KEYS } from "./lib.mjs";

const c = await connect();

async function snapshot() {
  const raw = await c.ev(`(() => {
    const active = document.activeElement;
    const card = active?.closest?.(".home-content-card") || null;
    const row = card?.closest?.("[data-row-key]") || null;
    const hero = document.querySelector(".home-hero-title-text");
    const vis = [...document.querySelectorAll("#app > *")].filter((e) => e.offsetWidth > 0).map((e) => e.id || e.className).join(",");
    const catalogs = document.querySelector(".home-modern-catalogs");
    const sections = [...document.querySelectorAll(".home-modern-catalogs > .home-modern-row")];
    const placeholders = sections.filter((node) => node.dataset.windowPlaceholder === "1");
    const mounted = sections.filter((node) => node.querySelector(".home-content-card"));
    const track = card?.closest?.(".home-track") || null;
    return JSON.stringify({
      vis,
      onHome: !!document.getElementById("home") && document.getElementById("home").offsetWidth > 0,
      rowKey: row?.dataset?.rowKey || "",
      rowIndex: row?.dataset?.rowIndex ?? "",
      itemId: card?.dataset?.itemId || "",
      itemIndex: card?.dataset?.itemIndex ?? "",
      focused: !!card?.classList?.contains("focused"),
      scrollLeft: track ? Math.round(track.scrollLeft) : null,
      hero: (hero?.textContent || "").trim(),
      sections: sections.length,
      placeholders: placeholders.length,
      mounted: mounted.length,
      cards: document.querySelectorAll(".home-modern-catalogs .home-content-card").length,
      switchOn: localStorage.getItem("labRowWindow") === "1"
    });
  })()`);
  return JSON.parse(raw || "{}");
}

async function press(name, times = 1, gap = 350) {
  for (let i = 0; i < times; i += 1) {
    await c.key(KEYS[name]);
    await sleep(gap);
  }
}

async function pressEscape() {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    });
  }
}

const before = await snapshot();
const vertical = [];
let focusKept = true;
let visitedDown = new Set();
if (before.rowIndex !== "") visitedDown.add(String(before.rowIndex));
for (let i = 0; i < 19; i += 1) {
  await press("D", 1, 420);
  const snap = await snapshot();
  vertical.push({
    dir: "down",
    i,
    rowIndex: snap.rowIndex,
    itemId: snap.itemId,
    focused: snap.focused
  });
  if (!snap.focused || !snap.itemId) focusKept = false;
  if (snap.rowIndex !== "") visitedDown.add(String(snap.rowIndex));
}
const bottom = await snapshot();
let visitedUp = new Set();
if (bottom.rowIndex !== "") visitedUp.add(String(bottom.rowIndex));
for (let i = 0; i < 19; i += 1) {
  await press("U", 1, 420);
  const snap = await snapshot();
  vertical.push({
    dir: "up",
    i,
    rowIndex: snap.rowIndex,
    itemId: snap.itemId,
    focused: snap.focused
  });
  if (!snap.focused || !snap.itemId) focusKept = false;
  if (snap.rowIndex !== "") visitedUp.add(String(snap.rowIndex));
}
const top = await snapshot();

await press("D", 2, 420);
const mid = await snapshot();
await press("R", 4, 280);
const afterRight = await snapshot();
await press("L", 3, 280);
const afterLeft = await snapshot();

await press("D", 12, 420);
const row15 = await snapshot();
await c.key(KEYS.OK);
let detail = null;
for (let i = 0; i < 20; i += 1) {
  await sleep(300);
  detail = await snapshot();
  if (!detail.onHome && detail.vis && detail.vis !== "home") break;
}
await pressEscape();
let returned = null;
for (let i = 0; i < 30; i += 1) {
  await sleep(300);
  returned = await snapshot();
  if (returned.onHome && returned.itemId) break;
}

const heroBefore = returned?.hero || "";
await press("D", 1, 500);
await sleep(900);
const heroAfter = await snapshot();

const report = {
  before,
  focusKept,
  downRows: [...visitedDown].sort((a, b) => Number(a) - Number(b)),
  upRows: [...visitedUp].sort((a, b) => Number(a) - Number(b)),
  bottomRow: bottom.rowIndex,
  topRow: top.rowIndex,
  horizontal: {
    mid,
    afterRight,
    afterLeft,
    scrolledRight: Number(afterRight.scrollLeft) > Number(mid.scrollLeft),
    scrolledLeft: Number(afterLeft.scrollLeft) < Number(afterRight.scrollLeft),
    stayedInRow: afterRight.rowKey === mid.rowKey && afterLeft.rowKey === mid.rowKey
  },
  details: {
    openedFrom: row15,
    detail,
    returned,
    sameCard:
      Boolean(row15.itemId) &&
      row15.itemId === returned?.itemId &&
      row15.rowKey === returned?.rowKey
  },
  hero: {
    before: heroBefore,
    after: heroAfter.hero,
    changed: Boolean(heroBefore) && Boolean(heroAfter.hero) && heroBefore !== heroAfter.hero,
    stillFocused: heroAfter.focused
  }
};
console.log(JSON.stringify(report));
c.close();
