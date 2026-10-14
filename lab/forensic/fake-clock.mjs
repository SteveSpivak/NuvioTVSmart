// Deterministic clock for forensic tests. Production modules call the globals
// at runtime, so installing this before those calls is enough. setImmediate
// stays real so a worker can still receive RPC replies while a timer chain runs.

const REAL_DATE = Date;

export function createClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  let nextId = 1;
  const timers = [];

  function setTimeout(fn, ms, ...args) {
    const id = nextId++;
    timers.push({
      id,
      at: now + Math.max(0, Number(ms) || 0),
      fn,
      args,
      interval: false
    });
    return id;
  }

  function setInterval(fn, ms, ...args) {
    const id = nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.push({
      id,
      at: now + delay,
      fn,
      args,
      interval: true,
      delay
    });
    return id;
  }

  function clearTimer(id) {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index >= 0) {
      timers.splice(index, 1);
    }
  }

  function advance(ms) {
    const target = now + Math.max(0, Number(ms) || 0);
    const spawned = [];
    while (true) {
      let nextIndex = -1;
      let nextAt = Infinity;
      for (let index = 0; index < timers.length; index += 1) {
        const timer = timers[index];
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextIndex = index;
        }
      }
      if (nextIndex < 0) {
        break;
      }
      const timer = timers[nextIndex];
      timers.splice(nextIndex, 1);
      now = timer.at;
      const result = timer.fn(...timer.args);
      if (result && typeof result.then === "function") {
        spawned.push(result);
      }
      if (timer.interval) {
        timers.push({
          ...timer,
          at: now + timer.delay
        });
      }
    }
    now = target;
    return spawned;
  }

  function reset(nextNow = startMs) {
    timers.splice(0, timers.length);
    now = nextNow;
  }

  class ClockDate extends REAL_DATE {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else {
        super(...args);
      }
    }

    static now() {
      return now;
    }

    static parse(value) {
      return REAL_DATE.parse(value);
    }

    static UTC(...args) {
      return REAL_DATE.UTC(...args);
    }
  }

  return {
    setTimeout,
    clearTimeout: clearTimer,
    setInterval,
    clearInterval: clearTimer,
    advance,
    reset,
    Date: ClockDate,
    now: () => now,
    pending: () => timers.length
  };
}

export function installClock(startMs) {
  const clock = createClock(startMs);
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  globalThis.setInterval = clock.setInterval;
  globalThis.clearInterval = clock.clearInterval;
  globalThis.Date = clock.Date;
  return clock;
}
