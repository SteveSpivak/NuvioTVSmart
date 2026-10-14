// node lab/checks/detail-trailer-intent.test.mjs
// Lab switch "trailerIntent": the paused trailer player is warmed only after focus rests on the
// Trailer button, not on every Details open. Switch off keeps the warm-on-open timer.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

// Fake timers: record pending callbacks so the test controls when they fire.
let timers = new Map();
let nextId = 1;
globalThis.setTimeout = (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
const fireAll = () => { const due = [...timers.values()]; timers = new Map(); due.forEach((t) => t.fn()); };

const { createMetaDetailsScreenMethods19 } = await import("../../js/ui/screens/detail/metaDetailsScreenMethods-19-toggle-active-trailer-playback.js");

const target = (selectorMatch) => ({ matches: (selector) => selector === selectorMatch });
const trailerButton = target('[data-action="toggleTrailer"]');
const playButton = target('[data-action="playDefault"]');

function screen() {
  const s = Object.assign({ trailerWarmTimer: null, warmCalls: 0 }, createMetaDetailsScreenMethods19());
  s.warmTrailerPlayer = () => { s.warmCalls += 1; };
  return s;
}

// 1. Switch on (default): opening Details does not warm the player.
{
  const s = screen();
  s.scheduleTrailerWarm();
  assert.equal(timers.size, 0, "no warm timer on Details open");
  fireAll();
  assert.equal(s.warmCalls, 0);
}

// 2. Focus rests on the Trailer button: warm after the intent delay.
{
  const s = screen();
  s.noteTrailerFocus(trailerButton);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 600);
  fireAll();
  assert.equal(s.warmCalls, 1);
}

// 3. Focus passes over the Trailer button and moves on: no warm.
{
  const s = screen();
  s.noteTrailerFocus(trailerButton);
  s.noteTrailerFocus(playButton);
  assert.equal(timers.size, 0, "pending intent timer cleared");
  fireAll();
  assert.equal(s.warmCalls, 0);
}

// 4. Switch off: previous behavior, warm on open; focus is ignored.
storage.set("nuvioLabOff", "trailerIntent");
{
  const s = screen();
  s.noteTrailerFocus(trailerButton);
  assert.equal(timers.size, 0, "focus ignored with switch off");
  s.scheduleTrailerWarm();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 1000);
  fireAll();
  assert.equal(s.warmCalls, 1);
}

console.log("detail trailer intent: 4 cases passed");
