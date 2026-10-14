import { labFixEnabled } from "../../../core/labSwitch.js";

// Lab experiment "watchedSkipRender": the watched-title projection that runs on every
// return to Home requested a full Home render even when the set of watched titles was
// unchanged. Home markup reads only that set, so an identical set cannot change it,
// and on the TV the redundant render cost about 1.3 s of main-thread work.
export function shouldRenderWatchedTitleChange(previousTitleIds, nextTitleIds) {
  if (!labFixEnabled("watchedSkipRender")) {
    return true;
  }
  if (!(previousTitleIds instanceof Set) || !(nextTitleIds instanceof Set)) {
    return true;
  }
  if (previousTitleIds.size !== nextTitleIds.size) {
    return true;
  }
  for (const id of nextTitleIds) {
    if (!previousTitleIds.has(id)) {
      return true;
    }
  }
  return false;
}
