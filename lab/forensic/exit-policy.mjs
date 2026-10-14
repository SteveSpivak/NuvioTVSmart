// Exit policy for the forensic runner. A successful process is not a passing
// suite. Investigate records known failures. Regression fails on any required
// failure, a stale allowlist, a repeat mismatch, or zero discovered cases.

export function summarizeCases(cases = []) {
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0, EXPECTED_FAIL: 0 };
  for (const entry of cases) {
    const verdict = entry?.verdict || "UNKNOWN";
    if (verdict === "FAIL" && entry?.expectation === "expected") {
      counts.EXPECTED_FAIL += 1;
    }
    if (Object.prototype.hasOwnProperty.call(counts, verdict)) {
      counts[verdict] += 1;
    }
  }
  return counts;
}

export function decideExit({
  mode = "investigate",
  cases = [],
  repeatMatched = true,
  expectedFailureIds = []
} = {}) {
  if (!Array.isArray(cases) || cases.length === 0) {
    return { code: 1, reason: "zero-cases", unexpected: [], missingExpected: [] };
  }
  if (repeatMatched !== true) {
    return { code: 1, reason: "repeat-mismatch", unexpected: [], missingExpected: [] };
  }

  const expected = new Set(expectedFailureIds);
  const fails = cases.filter((entry) => entry.verdict === "FAIL");
  const unexpected = fails.filter((entry) => !expected.has(entry.id)).map((entry) => entry.id);
  const missingExpected = [...expected].filter(
    (id) => !cases.some((entry) => entry.id === id && entry.verdict === "FAIL")
  );
  const blockedRequired = cases
    .filter((entry) => entry.verdict === "BLOCKED" && entry.expectation === "required")
    .map((entry) => entry.id);

  if (mode === "regression") {
    if (unexpected.length || missingExpected.length || blockedRequired.length) {
      return {
        code: 1,
        reason: "regression",
        unexpected,
        missingExpected,
        blockedRequired
      };
    }
    return { code: 0, reason: "regression-ok", unexpected, missingExpected };
  }

  return {
    code: 0,
    reason: "investigate",
    unexpected,
    missingExpected,
    expectedFailures: fails.filter((entry) => expected.has(entry.id)).map((entry) => entry.id)
  };
}
