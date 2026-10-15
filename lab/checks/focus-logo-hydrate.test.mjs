// CDP_URL=http://127.0.0.1:9222 node lab/checks/focus-logo-hydrate.test.mjs
// Lab switch "focusLogoHydrate": on the TV, Home row updates after Back flip a card's logo data-src between two
// sources (addon and TMDB). updateHomeDom then removed the src of the focused, expanded card's logo, and nothing
// hydrates a card that already has focus, so its title logo stayed blank until focus moved (MEASURED, observer on
// the TV). The fix loads the new source in place for a focused or expanded card only.
// Needs a real DOM: runs the source module in a new tab of a local Chrome (the emulator's, DevTools on CDP_URL).
// Exits 2 with NOT_RUN when no Chrome is reachable.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(file.endsWith("/") || req.url === "/" ? 200 : 404, { "content-type": "text/html" });
    return res.end("<!doctype html><title>check</title>");
  }
  res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/plain" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

let version;
try {
  version = await (await fetch(`${CDP_URL}/json/version`)).json();
} catch (_) {
  console.log(`NOT_RUN: no Chrome DevTools at ${CDP_URL}`);
  server.close();
  process.exit(2);
}
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) => new Promise((r) => {
  id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { result: { targetId } } = await send("Target.createTarget", { url: `${origin}/` });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await new Promise((r) => setTimeout(r, 500));

// Runs in the page. Returns the focused and unfocused logo state after one incremental update.
const scenario = async (moduleUrl, off) => {
  if (off) localStorage.setItem("nuvioLabOff", "focusLogoHydrate");
  else localStorage.removeItem("nuvioLabOff");
  const { updateHomeDom } = await import(`${moduleUrl}?${off ? "off" : "on"}`);
  const card = (id, logo) =>
    `<div class="home-content-card home-poster-card" data-item-id="${id}">` +
    `<img class="home-poster-expanded-logo" data-src="${logo}" loading="lazy"></div>`;
  const markup = (logo) =>
    `<div class="home-shell"><div class="home-row" data-row-key="r1">` +
    `${card("a", `/logo-a-${logo}.png`)}${card("b", `/logo-b-${logo}.png`)}</div></div>`;
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  updateHomeDom(container, markup("addon"));
  const [focused, other] = container.querySelectorAll(".home-content-card");
  // What focus does on the TV: expand the card and hydrate its logo (hydrateFocusedPosterAssets).
  focused.classList.add("focused", "is-expanded");
  for (const c of [focused, other]) {
    const img = c.querySelector("img");
    img.setAttribute("src", img.dataset.src);
    img.removeAttribute("data-src");
  }
  const incremental = updateHomeDom(container, markup("tmdb"), { incremental: true, focusedNode: focused });
  const state = (c) => {
    const img = c.querySelector("img");
    return { src: img.getAttribute("src"), dataSrc: img.getAttribute("data-src") };
  };
  return { incremental, sameNode: container.contains(focused), focused: state(focused), other: state(other) };
};

const run = async (off) => {
  const expr = `(${scenario})(${JSON.stringify(`${origin}/js/ui/screens/home/homeDomUpdate.js`)}, ${off})`;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};

try {
  const on = await run(false);
  assert.equal(on.incremental, true);
  assert.equal(on.sameNode, true);
  // Focused, expanded card: the new logo loads in place instead of going blank.
  assert.deepEqual(on.focused, { src: "/logo-a-tmdb.png", dataSrc: null }, "focused logo must load the new source");
  // A card without focus keeps the lazy path: src cleared, the hydration pass loads it on focus.
  assert.deepEqual(on.other, { src: null, dataSrc: "/logo-b-tmdb.png" });
  // Switch off: the old behavior, the focused logo is blank.
  const off = await run(true);
  assert.deepEqual(off.focused, { src: null, dataSrc: "/logo-a-tmdb.png" });
  console.log("focus logo hydrate: 6 cases passed (real DOM, Chrome)");
} finally {
  await send("Target.closeTarget", { targetId });
  ws.close();
  server.close();
}
