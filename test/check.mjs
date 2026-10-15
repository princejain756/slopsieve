import assert from "node:assert";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseDiff } from "../src/parse.js";
import { analyze } from "../src/checks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "slopsieve.js");
const run = (f) => analyze(parseDiff(readFileSync(join(root, "fixtures", f), "utf8")));

const slop = run("slop.patch");
const clean = run("clean.patch");

assert.ok(slop.score >= 60, `slop.patch should score >= 60, got ${slop.score}`);
assert.ok(clean.score <= 15, `clean.patch should score <= 15, got ${clean.score}`);
for (const id of ["test-weakening", "debug-leftovers", "trivial-dependency", "commented-out-code", "boilerplate-comments", "dead-code-added"])
  assert.ok(slop.flags.some((f) => f.id === id), `slop.patch should flag ${id}`);
assert.equal(clean.flags.length, 0, `clean.patch should have no flags, got ${clean.flags.map((f) => f.id)}`);

// end-to-end: file arg, exit code
const out = execFileSync("node", [bin, "fixtures/slop.patch", "--no-color", "--fail-at", "0"], { cwd: root, encoding: "utf8" }).toString();
assert.match(out, /SLOP SCORE: \d+\/100/);
assert.ok(!out.includes("\x1b["), "--no-color output must not contain ANSI codes");
let code = 0;
try { execFileSync("node", [bin, "fixtures/clean.patch"], { cwd: root }); } catch (e) { code = e.status; }
assert.equal(code, 0, "clean.patch should exit 0");
try { execFileSync("node", [bin, "fixtures/slop.patch"], { cwd: root }); assert.fail("slop.patch should exit 1"); }
catch (e) { assert.equal(e.status, 1); }
const j = JSON.parse(execFileSync("node", [bin, "fixtures/slop.patch", "--json", "--fail-at", "0"], { cwd: root, encoding: "utf8" }));
assert.equal(j.tool, "slopsieve");
assert.ok(Array.isArray(j.flags) && j.flags.length >= 5);

console.log(`ok - slop=${slop.score} clean=${clean.score} flags=${slop.flags.map((f) => f.id).join(",")}`);
