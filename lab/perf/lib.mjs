// Shared Chrome DevTools Protocol helpers for the Nuvio perf scripts.
// Works against the real TV (through an SSH tunnel) and the Linux emulator alike.
//   CDP_URL     http endpoint. TV tunnel: http://127.0.0.1:19998 (default). Emulator: http://127.0.0.1:9222
//   CDP_TARGET  regex matched against page title + url (default "nuvio")
//   DEVICE      label written into results: "tv" or "emu" (default "tv")
export const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:19998";
export const DEVICE = process.env.DEVICE || "tv";
const TARGET = new RegExp(process.env.CDP_TARGET || "nuvio", "i");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const KEYS = {
  R: ["ArrowRight", 39],
  L: ["ArrowLeft", 37],
  U: ["ArrowUp", 38],
  D: ["ArrowDown", 40],
  OK: ["Enter", 13]
};

export async function connect() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json();
  const t = targets.find((x) => x.type === "page" && TARGET.test(x.title + x.url));
  if (!t) {
    console.log("NO_NUVIO_TARGET");
    process.exit(1);
  }
  // The TV reports its own internal port in webSocketDebuggerUrl; rewrite it to the endpoint we reached.
  const wsUrl = t.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${new URL(CDP_URL).host}`);
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else for (const l of listeners) l(m);
  };
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expression, timeout = 60000) =>
    (
      await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout
      })
    ).result?.result?.value;
  const key = async ([k, code]) => {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", {
        type,
        key: k,
        code: k,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code
      });
    }
  };
  // True only while Home is visible and focus sits inside a Home row. Every key press is guarded by this,
  // so a person picking up the remote mid-run cannot make the script drive other screens.
  const onHome = async () =>
    (await ev(
      '(()=>{const h=document.getElementById("home"),a=document.activeElement;return !document.hidden&&!!h&&h.offsetWidth>0&&!!a&&!!a.closest(".home-row")})()'
    )) === true;
  return { ws, send, ev, key, onHome, onEvent: (l) => listeners.push(l), close: () => ws.close() };
}

// Sequence format: "R*6@300,L*5@300,D*8@600" = 6x Right 300 ms apart, 5x Left, 8x Down 600 ms apart.
export async function drive(c, seq) {
  let presses = 0;
  for (const part of seq.split(",")) {
    const m = part.match(/^([RLUD])\*(\d+)@(\d+)$/);
    if (!m) continue;
    for (let i = 0; i < +m[2]; i++) {
      if (!(await c.onHome())) {
        console.log("ABORT_NOT_ON_HOME after", presses, "presses");
        return { presses, aborted: true };
      }
      await c.key(KEYS[m[1]]);
      presses++;
      await sleep(+m[3]);
    }
  }
  return { presses, aborted: false };
}

// Default sequence used for every number in the findings: stays inside Home rows, left count < right count
// so focus never reaches the sidebar.
export const DEFAULT_SEQ = "R*6@300,L*5@300,D*8@600,R*6@300,L*5@300,U*8@600";
