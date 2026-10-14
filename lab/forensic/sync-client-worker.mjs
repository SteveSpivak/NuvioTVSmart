// One logical Nuvio installation. Module state is process-local, so each
// worker is a separate install. Supabase RPCs are forwarded to the parent
// mock. Nothing here calls a live account.

import { parentPort } from "node:worker_threads";
import { installClock } from "./fake-clock.mjs";
import { installMemoryStorage } from "./memory-storage.mjs";

const clock = installClock(1_700_000_000_000);
installMemoryStorage();

globalThis.fetch = async () => {
  throw new Error("forensic harness blocked a network fetch");
};
globalThis.document = {
  body: {
    classList: {
      names: new Set(),
      contains(name) {
        return this.names.has(name);
      },
      add(name) {
        this.names.add(name);
      },
      remove(name) {
        this.names.delete(name);
      }
    }
  }
};
globalThis.window = globalThis;
globalThis.location = {
  href: "https://nuvio.local/index.html",
  origin: "https://nuvio.local"
};

const [
  { AuthManager },
  { AuthState },
  { SessionStore },
  { SupabaseApi },
  { ProfileManager },
  { WatchProgressSyncService },
  { watchProgressRepository },
  { WatchProgressStore },
  { TraktSettingsStore, WatchProgressSource },
  { TraktAuthStore },
  { StartupSyncService },
  { getSyncClientId },
  { notifySessionTeardownHandlers },
  { createPlayerControllerMethods20 },
  { readContinueWatchingDisplaySnapshot, writeContinueWatchingDisplaySnapshot }
] = await Promise.all([
  import("../../js/core/auth/authManager.js"),
  import("../../js/core/auth/authState.js"),
  import("../../js/core/storage/sessionStore.js"),
  import("../../js/data/remote/supabase/supabaseApi.js"),
  import("../../js/core/profile/profileManager.js"),
  import("../../js/core/profile/watchProgressSyncService.js"),
  import("../../js/data/repository/watchProgressRepository.js"),
  import("../../js/data/local/watchProgressStore.js"),
  import("../../js/data/local/traktSettingsStore.js"),
  import("../../js/data/local/traktAuthStore.js"),
  import("../../js/core/profile/startupSyncService.js"),
  import("../../js/core/sync/syncClientIdentity.js"),
  import("../../js/core/auth/sessionLifecycle.js"),
  import("../../js/core/player/playerControllerMethods-20-flush-progress.js"),
  import("../../js/ui/screens/home/homeScreenHelpers-10-get-cached-continue-watching-enrichment.js")
]);

const pendingRpc = new Map();
let rpcSeq = 0;

function accountToken() {
  return SessionStore.accessToken || "";
}

SupabaseApi.rpc = (name, body = {}) =>
  new Promise((resolve, reject) => {
    const rpcId = ++rpcSeq;
    pendingRpc.set(rpcId, { resolve, reject });
    parentPort.postMessage({
      type: "rpc",
      rpcId,
      name,
      body,
      accountToken: accountToken()
    });
  });
SupabaseApi.select = async () => [];
SupabaseApi.upsert = async () => [];
SupabaseApi.delete = async () => [];

const homeNotifications = [];
StartupSyncService.subscribeToPullCompleted((event) => {
  homeNotifications.push(event);
});

function jwt(accountId) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: accountId, exp: 9_999_999_999 })).toString(
    "base64url"
  );
  return `${header}.${payload}.forensic`;
}

async function settle() {
  let quiet = 0;
  while (quiet < 4) {
    await new Promise((resolve) => setImmediate(resolve));
    if (pendingRpc.size === 0) {
      quiet += 1;
    } else {
      quiet = 0;
    }
  }
}

function project(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    contentId: item.contentId,
    profileId: String(item.profileId || ""),
    source: item.source || "",
    positionMs: Number(item.positionMs || 0),
    durationMs: Number(item.durationMs || 0),
    updatedAt: Number(item.updatedAt || 0),
    title: item.title || ""
  }));
}

async function configure(options = {}) {
  const accountId = String(options.accountId || "account-a");
  SessionStore.accessToken = jwt(accountId);
  SessionStore.refreshToken = `${accountId}-refresh`;
  AuthManager.setState(
    options.authenticated === false ? AuthState.SIGNED_OUT : AuthState.AUTHENTICATED
  );
  if (options.clientId) {
    localStorage.setItem("nuvio_web_installation_id", String(options.clientId));
  }
  await ProfileManager.setActiveProfile(String(options.profileId || "1"));
  TraktSettingsStore.setWatchProgressSource(options.source || WatchProgressSource.NUVIO_SYNC);
  if (options.traktAuthenticated) {
    TraktAuthStore.saveToken({
      access_token: "forensic-trakt-access",
      refresh_token: "forensic-trakt-refresh"
    });
  }
  if (options.constrained) {
    document.body.classList.add("performance-constrained");
  } else {
    document.body.classList.remove("performance-constrained");
  }
  return {
    accountId,
    profileId: ProfileManager.getActiveProfileId(),
    clientId: getSyncClientId(),
    authenticated: AuthManager.isAuthenticated,
    source: TraktSettingsStore.get().watchProgressSource
  };
}

const player = {
  ...createPlayerControllerMethods20(),
  recordProgressSnapshot() {},
  async pushProgressIfDue() {
    return true;
  },
  async flushCloudLibraryProgress() {
    return false;
  }
};

async function handle(command) {
  switch (command.cmd) {
    case "configure":
      return configure(command);
    case "saveProgress":
      await watchProgressRepository.saveProgress(command.progress, command.options || {});
      return { local: project(WatchProgressStore.listAll()) };
    case "flushPlayer":
      return player.flushProgress(
        command.positionMs,
        command.durationMs,
        false,
        command.context,
        command.options || {}
      );
    case "advance": {
      clock.advance(command.ms);
      await settle();
      return { now: clock.now(), pendingTimers: clock.pending() };
    }
    case "pull":
      return {
        items: project(await WatchProgressSyncService.pull(command.profileId ?? null)),
        status: WatchProgressSyncService.getLastPullStatus(),
        changedHomeInputs: WatchProgressSyncService.getLastPullChangedHomeInputs(),
        hadUnsynced: WatchProgressSyncService.getLastPullHadUnsynced()
      };
    case "push":
      return { ok: await WatchProgressSyncService.push(command.profileId ?? null) };
    case "deleteItems":
      return {
        ok: await WatchProgressSyncService.deleteItems(
          command.items || [],
          command.profileId ?? null
        )
      };
    case "removeProgress":
      await watchProgressRepository.removeProgress(command.contentId, command.videoId ?? null);
      return { local: project(WatchProgressStore.listAll()) };
    case "getLocal":
      return project(
        command.profileId == null
          ? WatchProgressStore.listAll()
          : WatchProgressStore.listForProfile(command.profileId)
      );
    case "getContinueWatching":
      return project(await watchProgressRepository.getAllForContinueWatching());
    case "getRecent":
      return project(await watchProgressRepository.getRecent(30, { enrichMetadata: false }));
    case "writeSnapshot":
      writeContinueWatchingDisplaySnapshot(command.scopeKey, command.items || []);
      return readContinueWatchingDisplaySnapshot(command.scopeKey);
    case "readSnapshot":
      return readContinueWatchingDisplaySnapshot(command.scopeKey);
    case "setProfile":
      await ProfileManager.setActiveProfile(String(command.profileId));
      return ProfileManager.getActiveProfileId();
    case "teardown":
      return notifySessionTeardownHandlers({ waitForInFlight: command.waitForInFlight !== false });
    case "startSync":
      await StartupSyncService.start({
        profileScopedSyncEnabled: command.profileScopedSyncEnabled !== false,
        runInitialPull: command.runInitialPull === true
      });
      return {
        started: StartupSyncService.started,
        generation: StartupSyncService.runGeneration
      };
    case "stopSync":
      await StartupSyncService.stop({ waitForInFlight: false });
      return {
        started: StartupSyncService.started,
        generation: StartupSyncService.runGeneration
      };
    case "watchStateSync":
      return StartupSyncService.requestWatchStateSyncNow();
    case "scheduleForeground":
      return StartupSyncService.scheduleSurfacePull(
        "foreground",
        command.delayMs || 0,
        command.minIntervalMs || 0,
        command.force === true
      );
    case "homeNotifications":
      return homeNotifications.slice();
    case "sourceKey":
      return watchProgressRepository.getContinueWatchingSourceKey();
    case "now":
      return clock.now();
    case "storageKeys":
      return [
        ...Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      ];
    default:
      throw new Error(`Unknown command ${command.cmd}`);
  }
}

parentPort.on("message", async (message) => {
  if (message?.type === "rpc-result") {
    const waiter = pendingRpc.get(message.rpcId);
    if (!waiter) return;
    pendingRpc.delete(message.rpcId);
    if (message.error) {
      const error = new Error(String(message.error));
      error.status = message.status || 500;
      waiter.reject(error);
    } else {
      waiter.resolve(message.result);
    }
    return;
  }
  if (message?.type !== "command") return;
  try {
    const result = await handle(message);
    parentPort.postMessage({ type: "result", id: message.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      type: "result",
      id: message.id,
      ok: false,
      error: error?.stack || String(error)
    });
  }
});

parentPort.postMessage({ type: "ready" });
