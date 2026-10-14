// Performance-lab A/B switch. Every lab fix is on unless its name is listed in
// localStorage "nuvioLabOff" (comma separated), so one installed build can
// measure each fix on and off without reinstalling.
export function labFixEnabled(name) {
  try {
    const off = String(globalThis.localStorage?.getItem("nuvioLabOff") || "");
    return !off.split(",").includes(name);
  } catch (_) {
    return true;
  }
}
