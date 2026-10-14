// Two-client Continue Watching simulation. Each client is a worker with its
// own module realm and localStorage. The parent is a mock Supabase, not the
// live project.

import { Worker } from "node:worker_threads";
import { writeFileSync } from "node:fs";

const MOVIE_DURATION = 7_200_000;
const EPOCH = 1_700_000_000_000;

function accountFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
    return String(payload.sub || "unknown");
  } catch {
    return "unknown";
  }
}

function createCloud() {
  const buckets = new Map();
  const log = [];
  const held = new Map();

  function bucket(account, profile) {
    const key = `${account}::${String(profile)}`;
    if (!buckets.has(key)) buckets.set(key, new Map());
    return buckets.get(key);
  }

  function apply(clientName, message, reply) {
    const account = accountFromToken(message.accountToken);
    const profile = message.body?.p_profile_id ?? 1;
    log.push({
      clientName,
      name: message.name,
      account,
      profile: String(profile),
      origin: message.body?.p_origin_client_id || "",
      entries: (message.body?.p_entries || []).map((row) => ({
        key: row.progress_key,
        position: row.position,
        duration: row.duration,
        lastWatched: row.last_watched
      })),
      keys: message.body?.p_keys || []
    });
    if (message.name === "sync_push_watch_progress") {
      const target = bucket(account, profile);
      for (const row of message.body?.p_entries || []) {
        target.set(row.progress_key, {
          ...row,
          origin_client_id: message.body?.p_origin_client_id || ""
        });
      }
      reply({ result: true });
      return;
    }
    if (message.name === "sync_pull_watch_progress") {
      reply({ result: [...bucket(account, profile).values()] });
      return;
    }
    if (message.name === "sync_delete_watch_progress") {
      const target = bucket(account, profile);
      for (const key of message.body?.p_keys || []) target.delete(key);
      reply({ result: true });
      return;
    }
    if (String(message.name || "").includes("pull")) {
      reply({ result: [] });
      return;
    }
    reply({ result: true });
  }

  return {
    log,
    failNext: new Set(),
    hold(clientName) {
      held.set(clientName, []);
    },
    release(clientName) {
      const queued = held.get(clientName) || [];
      held.delete(clientName);
      queued.forEach((entry) => apply(clientName, entry.message, entry.reply));
    },
    handle(clientName, message, reply) {
      if (this.failNext.has(`${clientName}:${message.name}`)) {
        this.failNext.delete(`${clientName}:${message.name}`);
        log.push({
          clientName,
          name: message.name,
          account: accountFromToken(message.accountToken),
          failed: true
        });
        reply({ error: "forced sync failure", status: 503 });
        return;
      }
      if (held.has(clientName)) {
        held.get(clientName).push({ message, reply });
        return;
      }
      apply(clientName, message, reply);
    },
    rows(account, profile) {
      return [...bucket(account, profile).values()];
    },
    seed(account, profile, row) {
      bucket(account, profile).set(row.progress_key, row);
    },
    names(clientName) {
      return log.filter((entry) => entry.clientName === clientName).map((entry) => entry.name);
    }
  };
}

function createClient(name, cloud) {
  const worker = new Worker(new URL("./sync-client-worker.mjs", import.meta.url));
  const pending = new Map();
  let seq = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(
    () => readyReject(new Error(`${name} did not become ready`)),
    20000
  );
  worker.on("message", (message) => {
    if (message?.type === "ready") {
      clearTimeout(readyTimer);
      readyResolve();
      return;
    }
    if (message?.type === "rpc") {
      cloud.handle(name, message, (response) => {
        worker.postMessage({ type: "rpc-result", rpcId: message.rpcId, ...response });
      });
      return;
    }
    if (message?.type === "result") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error || `${name} command failed`));
    }
  });
  worker.on("error", (error) => {
    readyReject(error);
    for (const waiter of pending.values()) waiter.reject(error);
  });
  return {
    name,
    ready,
    async call(cmd, extra = {}, timeoutMs = 8000) {
      await ready;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${name} ${cmd} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: "command", id, cmd, ...extra });
      });
    },
    async close() {
      await worker.terminate();
    }
  };
}

function movie(contentId, positionMs, updatedAt, extra = {}) {
  return {
    contentId,
    contentType: "movie",
    title: extra.title || contentId,
    positionMs,
    durationMs: extra.durationMs == null ? MOVIE_DURATION : extra.durationMs,
    updatedAt,
    imdbId: contentId.startsWith("tt") ? contentId : null
  };
}

function byId(items, contentId) {
  return (items || []).find((item) => item.contentId === contentId) || null;
}

async function withClients(names, run) {
  const cloud = createCloud();
  const clients = {};
  try {
    await Promise.all(
      names.map(async (name) => {
        clients[name] = createClient(name, cloud);
        await clients[name].ready;
      })
    );
    return await run(clients, cloud);
  } finally {
    await Promise.all(Object.values(clients).map((client) => client.close()));
  }
}

function caseResult(id, verdict, classification, summary, evidence = {}) {
  return { id, track: "sync", verdict, classification, summary, evidence };
}

const cases = [];

async function runCase(id, fn) {
  try {
    cases.push(await fn());
  } catch (error) {
    cases.push(
      caseResult(id, "FAIL", "harness", `Harness error: ${error.message}`, {
        stack: String(error.stack || error)
          .split("\n")
          .slice(0, 8)
      })
    );
  }
}

async function main() {
  await runCase("same-account-profile-roundtrip", async () => {
    return withClients(["A", "B"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", {
        progress: movie("tt1000001", 120000, EPOCH + 1000, { title: "Shared" })
      });
      const before = cloud.rows("account-a", 1);
      await clients.A.call("advance", { ms: 1500 });
      const pulled = await clients.B.call("pull");
      const item = byId(pulled.items, "tt1000001");
      const ok =
        before.length === 0 && item?.positionMs === 120000 && item?.durationMs === MOVIE_DURATION;
      return caseResult(
        "same-account-profile-roundtrip",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "Same account and profile: A saved locally, push after 1.5s, B pull restored the same position."
          : "Same account and profile did not round-trip the position.",
        { beforePush: before.length, pulled: item, rpc: cloud.names("A") }
      );
    });
  });

  await runCase("different-account-isolated", async () => {
    return withClients(["A", "B"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-b",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000002", 150000, EPOCH + 2000) });
      await clients.A.call("advance", { ms: 1500 });
      const pulled = await clients.B.call("pull");
      const ok = pulled.items.length === 0 && pulled.status === "ok";
      return caseResult(
        "different-account-isolated",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "A different account pulled an empty snapshot and did not see account A's row."
          : "Account isolation failed.",
        { pulled }
      );
    });
  });

  await runCase("different-profile-isolated", async () => {
    return withClients(["A", "B"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "2",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000003", 160000, EPOCH + 3000) });
      await clients.A.call("advance", { ms: 1500 });
      const pulled = await clients.B.call("pull");
      const local = await clients.B.call("getLocal", { profileId: "2" });
      const ok = pulled.items.length === 0 && local.length === 0;
      return caseResult(
        "different-profile-isolated",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "Same account, profile 2 did not receive profile 1 progress."
          : "Profile isolation failed.",
        { pulled, local }
      );
    });
  });

  await runCase("local-save-before-push", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000004", 170000, EPOCH + 4000) });
      const local = await clients.A.call("getLocal", { profileId: "1" });
      const cloudRows = cloud.rows("account-a", 1);
      const ok = byId(local, "tt1000004")?.positionMs === 170000 && cloudRows.length === 0;
      return caseResult(
        "local-save-before-push",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "saveProgress writes localStorage before the debounced cloud push."
          : "Local save was not ahead of the cloud push.",
        { local, cloudRows: cloudRows.length, rpc: cloud.names("A") }
      );
    });
  });

  await runCase("debounce-1500", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000005", 180000, EPOCH + 5000) });
      await clients.A.call("advance", { ms: 1499 });
      const early = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      await clients.A.call("advance", { ms: 1 });
      const late = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      const ok = early === 0 && late === 1;
      return caseResult(
        "debounce-1500",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "Unconstrained push fired at 1500ms, not at 1499ms."
          : "1.5s debounce did not match the source delay.",
        { early, late }
      );
    });
  });

  await runCase("constrained-debounce-15000", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a",
        constrained: true
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000006", 190000, EPOCH + 6000) });
      await clients.A.call("advance", { ms: 1500 });
      const early = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      await clients.A.call("advance", { ms: 13500 });
      const late = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      const ok = early === 0 && late === 1;
      return caseResult(
        "constrained-debounce-15000",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "performance-constrained body class delayed the push to 15s."
          : "Constrained debounce was not 15s.",
        { early, late }
      );
    });
  });

  await runCase("termination-before-push", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000007", 200000, EPOCH + 7000) });
      await clients.A.call("teardown", { waitForInFlight: false });
      await clients.A.call("advance", { ms: 20000 });
      const local = await clients.A.call("getLocal", { profileId: "1" });
      const pushes = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      const localKept = byId(local, "tt1000007")?.positionMs === 200000;
      const cloudMissed = pushes === 0;
      const reproduced = localKept && cloudMissed;
      return caseResult(
        "termination-before-push",
        reproduced ? "FAIL" : "PASS",
        reproduced ? "reproduced-defect" : "verified-behavior",
        "Session teardown before the debounce cancels the cloud push. The local row remains. A kill inside the debounce window loses the cloud write.",
        {
          expected: "Local save is durable to the mock cloud even if teardown happens 500ms later.",
          actual: { localKept, pushes, cloudRows: cloud.rows("account-a", 1).length },
          callChain: [
            "player/repository saveProgress",
            "queueWatchProgressCloudSync setTimeout 1500",
            "notifySessionTeardownHandlers",
            "stopWatchProgressCloudSync increments generation and clears the timer"
          ]
        }
      );
    });
  });

  await runCase("failed-push-retry-backoff", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", {
        progress: movie("tt1000008", 210000, EPOCH + 8000),
        options: { syncRemote: false }
      });
      cloud.failNext.add("A:sync_push_watch_progress");
      const first = await clients.A.call("push");
      const second = await clients.A.call("push");
      await clients.A.call("advance", { ms: 119999 });
      const duringBackoff = await clients.A.call("push");
      await clients.A.call("advance", { ms: 1 });
      const afterBackoff = await clients.A.call("push");
      const pushes = cloud.log.filter(
        (entry) => entry.clientName === "A" && entry.name === "sync_push_watch_progress"
      );
      const ok =
        first.ok === false &&
        second.ok === false &&
        duringBackoff.ok === false &&
        afterBackoff.ok === true &&
        pushes.length === 2;
      return caseResult(
        "failed-push-retry-backoff",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "harness",
        ok
          ? "A failed push is not retried until 120s have passed for the same signature. The later retry committed."
          : "Retry backoff did not match pushOnce.",
        { first, second, duringBackoff, afterBackoff, pushes: pushes.length }
      );
    });
  });

  await runCase("independent-changes-both-kept", async () => {
    return withClients(["A", "B"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000009", 100000, EPOCH + 9000) });
      await clients.A.call("advance", { ms: 1500 });
      await clients.B.call("saveProgress", { progress: movie("tt1000010", 110000, EPOCH + 9001) });
      await clients.B.call("advance", { ms: 1500 });
      const rows = cloud
        .rows("account-a", 1)
        .map((row) => row.progress_key)
        .sort();
      const ok = rows.join(",") === "tt1000009,tt1000010";
      return caseResult(
        "independent-changes-both-kept",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "Upserts of different keys from two clients both remain. The mock follows the client contract that a push is not a full replace."
          : "Independent keys were not both kept.",
        { rows, divergence: "none after both pushes" }
      );
    });
  });

  await runCase("conflict-newer-local-wins", async () => {
    return withClients(["A", "B"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000011", 100000, EPOCH + 10000) });
      await clients.A.call("advance", { ms: 1500 });
      await clients.B.call("pull");
      await clients.A.call("saveProgress", { progress: movie("tt1000011", 200000, EPOCH + 20000) });
      await clients.A.call("advance", { ms: 1500 });
      await clients.B.call("saveProgress", { progress: movie("tt1000011", 300000, EPOCH + 30000) });
      const pulled = await clients.B.call("pull");
      const item = byId(pulled.items, "tt1000011");
      const ok = item?.positionMs === 300000;
      return caseResult(
        "conflict-newer-local-wins",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "Both sides changed from the baseline. B's newer updatedAt kept B's position on pull."
          : "Newer local write did not win the merge.",
        { item }
      );
    });
  });

  await runCase("conflict-equal-timestamp-remote-wins", async () => {
    return withClients(["A", "B"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000012", 100000, EPOCH + 10000) });
      await clients.A.call("advance", { ms: 1500 });
      await clients.B.call("pull");
      await clients.A.call("saveProgress", { progress: movie("tt1000012", 220000, EPOCH + 40000) });
      await clients.A.call("advance", { ms: 1500 });
      await clients.B.call("saveProgress", { progress: movie("tt1000012", 330000, EPOCH + 40000) });
      const pulled = await clients.B.call("pull");
      const local = byId(await clients.B.call("getLocal", { profileId: "1" }), "tt1000012");
      const remoteWon = local?.positionMs === 220000;
      return caseResult(
        "conflict-equal-timestamp-remote-wins",
        remoteWon ? "FAIL" : "PASS",
        "reproduced-defect",
        "Equal updatedAt values take the remote row because the comparison is `>`, not `>=`. B's simultaneous local position is discarded on pull.",
        {
          expected:
            "A tie should not silently drop the local write, or the winner should be explicit and stable across clients.",
          actual: local,
          callChain: [
            "WatchProgressSyncService.pull",
            "mergeProgressItems",
            "localChanged && remoteChanged",
            "winner = local.updatedAt > remote.updatedAt ? local : remote"
          ]
        }
      );
    });
  });

  await runCase("pending-delete-then-resave", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000013", 140000, EPOCH + 13000) });
      await clients.A.call("advance", { ms: 1500 });
      cloud.hold("A");
      const deleting = clients.A.call("deleteItems", {
        items: [movie("tt1000013", 140000, EPOCH + 13000)]
      });
      await new Promise((resolve) => setImmediate(resolve));
      await clients.A.call("saveProgress", { progress: movie("tt1000013", 250000, EPOCH + 50000) });
      cloud.release("A");
      await deleting;
      await clients.A.call("advance", { ms: 1500 });
      const rows = cloud.rows("account-a", 1);
      const local = byId(await clients.A.call("getLocal", { profileId: "1" }), "tt1000013");
      const restored = rows.some(
        (row) => row.progress_key === "tt1000013" && row.position === 250000
      );
      const ok = restored && local?.positionMs === 250000;
      return caseResult(
        "pending-delete-then-resave",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "A re-save while delete was in flight was pushed again after the delete. The newer local row is back in the mock cloud."
          : "Re-save after an in-flight delete did not restore the row.",
        { rows, local, rpc: cloud.names("A") }
      );
    });
  });

  await runCase("empty-remote-keeps-local", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", {
        progress: movie("tt1000014", 155000, EPOCH + 14000),
        options: { syncRemote: false }
      });
      const pulled = await clients.A.call("pull");
      const local = byId(await clients.A.call("getLocal", { profileId: "1" }), "tt1000014");
      const pushes = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      const ok =
        local?.positionMs === 155000 &&
        pulled.status === "ok" &&
        pushes === 0 &&
        cloud.rows("account-a", 1).length === 0;
      return caseResult(
        "empty-remote-keeps-local",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "reproduced-defect",
        ok
          ? "An empty remote snapshot did not replace the nonempty local store and did not schedule an empty push."
          : "Empty remote snapshot changed local state.",
        { pulledStatus: pulled.status, local, pushes }
      );
    });
  });

  await runCase("stale-snapshot-after-pull", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      const scopeKey = await clients.A.call("sourceKey");
      await clients.A.call("writeSnapshot", {
        scopeKey,
        items: [{ contentId: "tt-old", title: "Stale card", contentType: "movie" }]
      });
      cloud.seed("account-a", 1, {
        content_id: "tt1000015",
        content_type: "movie",
        video_id: null,
        season: null,
        episode: null,
        position: 180000,
        duration: MOVIE_DURATION,
        last_watched: EPOCH + 15000,
        progress_key: "tt1000015"
      });
      const pulled = await clients.A.call("pull");
      const snapshot = await clients.A.call("readSnapshot", { scopeKey });
      const store = await clients.A.call("getLocal", { profileId: "1" });
      const stale = snapshot.some((item) => item.contentId === "tt-old");
      const storeUpdated = byId(store, "tt1000015")?.positionMs === 180000;
      return caseResult(
        "stale-snapshot-after-pull",
        stale && storeUpdated ? "PASS" : "FAIL",
        "verified-behavior",
        stale && storeUpdated
          ? "Pull replaced the progress store but left homeContinueWatchingDisplaySnapshot unchanged. Home can still render the stale card until it rewrites the snapshot."
          : "Snapshot/store relationship did not match the source.",
        { scopeKey, snapshot, store, pullStatus: pulled.status }
      );
    });
  });

  await runCase("home-writer-reconciles-snapshot", async () => {
    return withClients(["A"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      const scopeKey = await clients.A.call("sourceKey");
      await clients.A.call("writeSnapshot", {
        scopeKey,
        items: [{ contentId: "tt-old", title: "Stale card", contentType: "movie" }]
      });
      const fresh = await clients.A.call("writeSnapshot", {
        scopeKey,
        items: [{ contentId: "tt1000016", title: "Fresh card", contentType: "movie" }]
      });
      const ok = fresh.length === 1 && fresh[0].contentId === "tt1000016";
      return caseResult(
        "home-writer-reconciles-snapshot",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "The real Home snapshot writer replaces the stale card when Home reconcile runs. Pull itself does not."
          : "Home snapshot writer did not replace the card.",
        { fresh }
      );
    });
  });

  await runCase("trakt-source-skips-nuvio-cloud", async () => {
    return withClients(["A", "B"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a",
        source: "nuvio_sync"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b",
        source: "trakt",
        traktAuthenticated: true
      });
      await clients.A.call("saveProgress", {
        progress: movie("tt1000017", 175000, EPOCH + 17000, { title: "Nuvio only" })
      });
      await clients.A.call("advance", { ms: 1500 });
      const pulled = await clients.B.call("pull");
      const watching = await clients.B.call("getContinueWatching");
      const ok =
        pulled.status === "skipped" &&
        watching.length === 0 &&
        cloud.rows("account-a", 1).length === 1;
      return caseResult(
        "trakt-source-skips-nuvio-cloud",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "A Trakt-selected authenticated install skips Supabase watch-progress pull. It does not show the other install's Nuvio Sync row. Divergence starts at shouldUseSupabaseWatchProgressSync."
          : "Trakt-selected client did not skip Nuvio cloud pull as the source does.",
        {
          pulled,
          watching,
          firstDivergence: "B.pull status skipped while cloud still holds A's row"
        }
      );
    });
  });

  await runCase("trakt-filter-drops-local-source-row", async () => {
    return withClients(["A"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a",
        source: "nuvio_sync"
      });
      await clients.A.call("saveProgress", {
        progress: movie("tt1000018", 165000, EPOCH + 18000),
        options: { syncRemote: false }
      });
      const before = await clients.A.call("getContinueWatching");
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a",
        source: "trakt",
        traktAuthenticated: true
      });
      const after = await clients.A.call("getContinueWatching");
      const hidden = byId(before, "tt1000018") && !byId(after, "tt1000018");
      return caseResult(
        "trakt-filter-drops-local-source-row",
        hidden ? "PASS" : "FAIL",
        "verified-behavior",
        hidden
          ? "Switching the same install to Trakt hides a tt-id row whose source does not start with trakt. Cloud push is a separate skip."
          : "Trakt Continue Watching filter did not hide the local row.",
        { before, after }
      );
    });
  });

  await runCase("profile-switch-queued-push-keeps-profile", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000019", 145000, EPOCH + 19000) });
      await clients.A.call("setProfile", { profileId: "2" });
      await clients.A.call("advance", { ms: 1500 });
      const profile1 = cloud.rows("account-a", 1);
      const profile2 = cloud.rows("account-a", 2);
      const ok = profile1.length === 1 && profile2.length === 0;
      return caseResult(
        "profile-switch-queued-push-keeps-profile",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "The debounced push kept the profile id captured at save time. Switching the active profile did not retarget it."
          : "Queued push followed the newly active profile.",
        { profile1: profile1.length, profile2: profile2.length }
      );
    });
  });

  await runCase("profile-switch-inflight-pull-writes-original", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      cloud.seed("account-a", 1, {
        content_id: "tt1000020",
        content_type: "movie",
        position: 190000,
        duration: MOVIE_DURATION,
        last_watched: EPOCH + 20000,
        progress_key: "tt1000020"
      });
      cloud.hold("A");
      const pulling = clients.A.call("pull");
      await new Promise((resolve) => setImmediate(resolve));
      await clients.A.call("setProfile", { profileId: "2" });
      cloud.release("A");
      await pulling;
      const profile1 = byId(await clients.A.call("getLocal", { profileId: "1" }), "tt1000020");
      const profile2 = await clients.A.call("getLocal", { profileId: "2" });
      const ok = profile1?.positionMs === 190000 && profile2.length === 0;
      return caseResult(
        "profile-switch-inflight-pull-writes-original",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "pull() resolved the profile id before the RPC. A later profile switch did not write that response into profile 2."
          : "In-flight pull wrote the wrong profile.",
        { profile1, profile2 }
      );
    });
  });

  await runCase("older-generation-skips-home-notify", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("startSync", { runInitialPull: false, profileScopedSyncEnabled: true });
      cloud.seed("account-a", 1, {
        content_id: "tt1000021",
        content_type: "movie",
        position: 210000,
        duration: MOVIE_DURATION,
        last_watched: EPOCH + 21000,
        progress_key: "tt1000021"
      });
      cloud.hold("A");
      const syncing = clients.A.call("watchStateSync", {}, 8000);
      await new Promise((resolve) => setImmediate(resolve));
      await clients.A.call("stopSync");
      cloud.release("A");
      const completed = await syncing;
      const notes = await clients.A.call("homeNotifications");
      const stored = byId(await clients.A.call("getLocal", { profileId: "1" }), "tt1000021");
      const ok = completed === false && notes.length === 0 && stored?.positionMs === 210000;
      return caseResult(
        "older-generation-skips-home-notify",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "Stopping StartupSyncService during an in-flight watch-state pull suppresses the Home notification. The progress store is still replaced by the late response."
          : "Older-generation pull did not match the service guards.",
        { completed, notes, stored }
      );
    });
  });

  await runCase("foreground-resume-leaves-snapshot-until-rewrite", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      const scopeKey = await clients.A.call("sourceKey");
      await clients.A.call("writeSnapshot", {
        scopeKey,
        items: [{ contentId: "tt-stale-resume", title: "Before resume", contentType: "movie" }]
      });
      cloud.seed("account-a", 1, {
        content_id: "tt1000022",
        content_type: "movie",
        position: 230000,
        duration: MOVIE_DURATION,
        last_watched: EPOCH + 22000,
        progress_key: "tt1000022"
      });
      await clients.A.call("startSync", { runInitialPull: false, profileScopedSyncEnabled: true });
      const scheduled = await clients.A.call("scheduleForeground", { delayMs: 0, force: true });
      await clients.A.call("advance", { ms: 1 });
      const snapshot = await clients.A.call("readSnapshot", { scopeKey });
      const store = await clients.A.call("getLocal", { profileId: "1" });
      const notes = await clients.A.call("homeNotifications");
      return caseResult(
        "foreground-resume-leaves-snapshot-until-rewrite",
        snapshot.some((item) => item.contentId === "tt-stale-resume") ? "PASS" : "FAIL",
        "verified-behavior",
        "Foreground watch-state scheduling does not itself rewrite the Home display snapshot. The stale card remains until Home calls writeContinueWatchingDisplaySnapshot.",
        {
          scheduled,
          snapshot,
          storeHasFresh: Boolean(byId(store, "tt1000022")),
          notes: notes.length,
          rpc: cloud.names("A")
        }
      );
    });
  });

  await runCase("player-flush-saves-before-cloud", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      const flushed = await clients.A.call("flushPlayer", {
        positionMs: 125000,
        durationMs: MOVIE_DURATION,
        context: {
          itemId: "tt1000023",
          itemType: "movie",
          title: "Player",
          imdbId: "tt1000023"
        }
      });
      const local = byId(await clients.A.call("getLocal", { profileId: "1" }), "tt1000023");
      const before = cloud.rows("account-a", 1).length;
      await clients.A.call("advance", { ms: 1500 });
      const after = cloud.rows("account-a", 1);
      const ok = local?.positionMs === 125000 && before === 0 && after[0]?.position === 125000;
      return caseResult(
        "player-flush-saves-before-cloud",
        ok ? "PASS" : "FAIL",
        ok ? "verified-behavior" : "harness",
        ok
          ? "player flushProgress saved the local row immediately and the cloud row appeared only after the debounce."
          : "Player flush did not follow the local-then-debounce path.",
        { flushed, local, before, after }
      );
    });
  });

  await runCase("short-position-duration-zero-roundtrip", async () => {
    return withClients(["A", "B"], async (clients) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", {
        progress: movie("short-clip", 10000, EPOCH + 24000, { durationMs: 0, title: "Short" }),
        options: { syncRemote: false }
      });
      await clients.A.call("push");
      const pulled = await clients.B.call("pull");
      const item = byId(pulled.items, "short-clip");
      const preserved = item?.positionMs === 10000;
      return caseResult(
        "short-position-duration-zero-roundtrip",
        preserved ? "PASS" : "FAIL",
        preserved ? "verified-behavior" : "reproduced-defect",
        preserved
          ? "A 10s position with no duration survived pull unchanged."
          : "Pull inflated a 10s position because the legacy position/duration fields have no unit and duration 0 does not force millisecond mode.",
        {
          expected: { positionMs: 10000, durationMs: 0 },
          actual: item,
          callChain: [
            "watchProgressRepository.saveProgress",
            "WatchProgressSyncService.push",
            "buildRemoteProgressEntries position/duration without _ms suffix",
            "mapProgressRow normalizeAmbiguousRemoteTime"
          ]
        }
      );
    });
  });

  await runCase("empty-push-does-not-wipe-cloud", async () => {
    return withClients(["A", "B"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000024", 135000, EPOCH + 25000) });
      await clients.A.call("advance", { ms: 1500 });
      const pushed = await clients.B.call("push");
      const rows = cloud.rows("account-a", 1);
      const ok = pushed.ok === true && rows.length === 1;
      return caseResult(
        "empty-push-does-not-wipe-cloud",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "B had no local rows. push() returned success and did not send an empty payload, so A's cloud row remained."
          : "Empty local push changed the cloud set.",
        { pushed, rows: rows.length, rpc: cloud.names("B") }
      );
    });
  });

  await runCase("installation-ids-differ", async () => {
    return withClients(["A", "B"], async (clients, cloud) => {
      const a = await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      const b = await clients.B.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-b"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000025", 128000, EPOCH + 26000) });
      await clients.A.call("advance", { ms: 1500 });
      const origin = cloud.log.find((entry) => entry.name === "sync_push_watch_progress")?.origin;
      const ok = a.clientId !== b.clientId && origin === a.clientId;
      return caseResult(
        "installation-ids-differ",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "Two installs minted different client ids. The id is sent on push and is not the merge key."
          : "Installation ids were not distinct or were not sent.",
        { a: a.clientId, b: b.clientId, origin }
      );
    });
  });

  await runCase("double-save-one-push", async () => {
    return withClients(["A"], async (clients, cloud) => {
      await clients.A.call("configure", {
        accountId: "account-a",
        profileId: "1",
        clientId: "nuvio-web-client-a"
      });
      await clients.A.call("saveProgress", { progress: movie("tt1000026", 100000, EPOCH + 27000) });
      await clients.A.call("advance", { ms: 500 });
      await clients.A.call("saveProgress", { progress: movie("tt1000026", 180000, EPOCH + 27500) });
      await clients.A.call("advance", { ms: 1499 });
      const early = cloud.names("A").filter((name) => name === "sync_push_watch_progress").length;
      await clients.A.call("advance", { ms: 1 });
      const pushes = cloud.log.filter((entry) => entry.name === "sync_push_watch_progress");
      const ok = early === 0 && pushes.length === 1 && pushes[0].entries[0].position === 180000;
      return caseResult(
        "double-save-one-push",
        ok ? "PASS" : "FAIL",
        "verified-behavior",
        ok
          ? "A second save inside the debounce replaced the timer. One push carried the later position."
          : "Debounce did not collapse two saves into one later push.",
        { early, pushes }
      );
    });
  });

  const counts = cases.reduce((acc, entry) => {
    acc[entry.verdict] = (acc[entry.verdict] || 0) + 1;
    return acc;
  }, {});
  const output = {
    suite: "sync",
    node: process.version,
    cases,
    counts
  };
  writeFileSync(
    new URL("./sync-results.json", import.meta.url),
    `${JSON.stringify(output, null, 2)}\n`
  );
  console.log(
    JSON.stringify(
      {
        suite: "sync",
        counts,
        cases: cases.map((entry) => ({ id: entry.id, verdict: entry.verdict }))
      },
      null,
      2
    )
  );
  if (!cases.length) {
    process.exit(1);
  }
}

await main();
