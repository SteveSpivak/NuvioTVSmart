import assert from "node:assert/strict";
import { decideExit, summarizeCases } from "./exit-policy.mjs";

const known = [
  { id: "kept", verdict: "PASS" },
  { id: "known-bug", verdict: "FAIL", expectation: "expected" },
  { id: "tv-frame", verdict: "NOT_RUN" }
];

const zero = decideExit({ mode: "regression", cases: [], repeatMatched: true });
assert.equal(zero.code, 1);
assert.equal(zero.reason, "zero-cases");

const investigate = decideExit({
  mode: "investigate",
  cases: known,
  repeatMatched: true,
  expectedFailureIds: ["known-bug"]
});
assert.equal(investigate.code, 0);
assert.equal(investigate.reason, "investigate");

const regressionOk = decideExit({
  mode: "regression",
  cases: known,
  repeatMatched: true,
  expectedFailureIds: ["known-bug"]
});
assert.equal(regressionOk.code, 0);

const newFail = decideExit({
  mode: "regression",
  cases: [...known, { id: "new-bug", verdict: "FAIL" }],
  repeatMatched: true,
  expectedFailureIds: ["known-bug"]
});
assert.equal(newFail.code, 1);
assert.deepEqual(newFail.unexpected, ["new-bug"]);

const staleAllowlist = decideExit({
  mode: "regression",
  cases: known.map((entry) =>
    entry.id === "known-bug" ? { ...entry, verdict: "PASS" } : entry
  ),
  repeatMatched: true,
  expectedFailureIds: ["known-bug"]
});
assert.equal(staleAllowlist.code, 1);
assert.deepEqual(staleAllowlist.missingExpected, ["known-bug"]);

const mismatch = decideExit({
  mode: "investigate",
  cases: known,
  repeatMatched: false,
  expectedFailureIds: ["known-bug"]
});
assert.equal(mismatch.code, 1);
assert.equal(mismatch.reason, "repeat-mismatch");

const counts = summarizeCases(known);
assert.equal(counts.PASS, 1);
assert.equal(counts.FAIL, 1);
assert.equal(counts.EXPECTED_FAIL, 1);
assert.equal(counts.NOT_RUN, 1);

console.log("exit-policy tests: 7 PASS");
