// Read-only probe: evaluates one expression in the Nuvio page and prints the result.
// Usage: node probe.mjs '<js expression>'
import { connect } from "./lib.mjs";
const c = await connect();
const v = await c.ev(process.argv[2]);
console.log(typeof v === "string" ? v : JSON.stringify(v));
c.close();
process.exit(0);
