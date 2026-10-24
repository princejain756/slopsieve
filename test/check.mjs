import assert from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseDiff } from "../src/parse.js";
import { analyze } from "../src/checks.js";

// slopsieve-ignore: empty-catch, phantom-imports, test-weakening, secret-in-diff
// ^ this file embeds diff fixture strings that look like the slop they test for

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "slopsieve.js");
const run = (f) => analyze(parseDiff(readFileSync(join(root, "fixtures", f), "utf8")), null, { cwd: root });
const runText = (t, opts = {}) => analyze(parseDiff(t), opts.pr || null, { cwd: opts.cwd || root });

const slop = run("slop.patch");
const clean = run("clean.patch");

// --- core scoring -------------------------------------------------------
assert.ok(slop.score >= 60, `slop.patch >= 60, got ${slop.score}`);
assert.ok(clean.score <= 15, `clean.patch <= 15, got ${clean.score}`);
for (const id of ["test-weakening", "debug-leftovers", "trivial-dependency", "commented-out-code", "boilerplate-comments"])
  assert.ok(slop.flags.some((f) => f.id === id), `slop.patch should flag ${id}`);

// --- parser: plain diff -u (no diff --git) -------------------------------
const plain = `--- a/src/x.js\t2026-10-15 12:00:00 +0000
+++ b/src/x.js\t2026-10-15 12:00:00 +0000
@@ -1,2 +1,3 @@
 const a = 1;
+console.log("x");
 const b = 2;
`;
{
  const files = parseDiff(plain);
  assert.equal(files.length, 1, "plain diff -u should produce 1 file");
  assert.equal(files[0].path, "src/x.js");
  const r = runText(plain);
  assert.ok(r.flags.some((f) => f.id === "debug-leftovers"), "plain diff should flag console.log");
}

// --- parser: removed line starting with "-- " inside a hunk --------------
const decrement = `diff --git a/src/c.c b/src/c.c
index 1..2 100644
--- a/src/c.c
+++ b/src/c.c
@@ -1,4 +1,4 @@
 int i = 3;
--- i;
+-- i;
 int j = 4;
`;
{
  const files = parseDiff(decrement);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/c.c", "-- i removed line must not corrupt path");
  assert.equal(files[0].dels.length, 1);
  assert.equal(files[0].dels[0].text, "-- i;");
  assert.equal(files[0].isNew, false);
}

// --- parser: mode-only new file, no ---/+++ ------------------------------
const modeOnly = `diff --git a/tests/empty.test.js b/tests/empty.test.js
new file mode 100644
index 0000000..e69de29
diff --git a/src/app.js b/src/app.js
index a..b 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,1 +1,2 @@
 x();
+console.log("hi");
`;
{
  const files = parseDiff(modeOnly);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, "tests/empty.test.js", "path from diff --git header");
  assert.equal(files[0].isNew, true, "new file mode detected");
}

// --- parser: CRLF ---------------------------------------------------------
{
  const files = parseDiff(decrement.replace(/\n/g, "\r\n"));
  assert.equal(files[0].dels[0].text, "-- i;");
  const r = analyze(files);
  assert.ok(r, "CRLF diff parses");
}

// --- trivial-dependency: version bump is not a new dep -------------------
const bump = `diff --git a/package.json b/package.json
index 1..2 100644
--- a/package.json
+++ b/package.json
@@ -1,4 +1,4 @@
 {
-  "express": "^4.18.0",
+  "express": "^4.19.0",
   "zod": "^3.22.0"
 }
`;
assert.ok(!runText(bump).flags.some((f) => f.id === "trivial-dependency"), "version bump should not flag");

// --- commented-out-code: JSDoc + markdown must stay clean ----------------
const jsdoc = `diff --git a/src/x.js b/src/x.js
new file mode 100644
index 0000000..a 100644
--- /dev/null
+++ b/src/x.js
@@ -0,0 +1,6 @@
+/**
+ * @param {Object} opts the options (see spec)
+ * @returns {boolean} true if valid
+ */
+export function f(opts) { return !!opts; }
+`;
assert.ok(!runText(jsdoc).flags.some((f) => f.id === "commented-out-code"), "JSDoc should not flag");

const md = `diff --git a/README.md b/README.md
index 1..2 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,5 @@
 # Title
+## This section explains the setup
+# Note that this matters
+## First, we install
+## Then, we run
+`;
assert.ok(!runText(md).flags.some((f) => f.id === "boilerplate-comments" || f.id === "commented-out-code"), "markdown edits should not flag");

// --- debug-leftovers: mention in a comment is not a leftover -------------
const commentMention = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,1 +1,2 @@
 a();
+// do not call console.log(x) in prod paths
 b();
`;
assert.ok(!runText(commentMention).flags.some((f) => f.id === "debug-leftovers"), "comment mention should not flag");

// --- test-weakening: test.each refactor is not weakening ------------------
const each = `diff --git a/tests/t.test.js b/tests/t.test.js
index 1..2 100644
--- a/tests/t.test.js
+++ b/tests/t.test.js
@@ -1,8 +1,5 @@
 describe("x", () => {
-  expect(f(1)).toBe(2);
-  expect(f(2)).toBe(4);
-  expect(f(3)).toBe(6);
-  expect(f(4)).toBe(8);
-  expect(f(5)).toBe(10);
+  test.each([[1,2],[2,4],[3,6],[4,8],[5,10]])("f(%i)=%i", (i,o) => {
+    expect(f(i)).toBe(o);
+  });
 });
`;
assert.ok(!runText(each).flags.some((f) => f.id === "test-weakening"), "test.each refactor should not flag");

// --- debug-leftovers: console.log IS the product in cli/scripts ------------
const cliPrint = `diff --git a/scripts/gen.js b/scripts/gen.js
index 1..2 100644
--- a/scripts/gen.js
+++ b/scripts/gen.js
@@ -1,1 +1,2 @@
 a();
+console.log("generated ok");
`;
assert.ok(!runText(cliPrint).flags.some((f) => f.id === "debug-leftovers"), "console.log in scripts/ is the product");
const cliTrap = cliPrint.replace('console.log("generated ok");', 'debugger;');
assert.ok(runText(cliTrap).flags.some((f) => f.id === "debug-leftovers"), "debugger still flags in scripts/");

// --- empty-catch: parameterless catch {} ----------------------------------
const emptyCatch = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,1 +1,2 @@
 a();
+try { b(); } catch {}
`;
assert.ok(runText(emptyCatch).flags.some((f) => f.id === "empty-catch"), "catch {} should flag");

// --- whitespace-churn: reordered code is not whitespace --------------------
const reorder = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,3 +1,3 @@
-const a = 1;
-const b = 2;
+const b = 2;
+const a = 1;
 c();
`;
assert.ok(!runText(reorder).flags.some((f) => f.id === "whitespace-churn"), "reorder is real churn, not whitespace");

const ws = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,3 +1,3 @@
-  const a = 1;
-  const b = 2;
+    const a = 1;
+    const b = 2;
 c();
`;
assert.ok(runText(ws).flags.some((f) => f.id === "whitespace-churn"), "pure re-indent should flag");

// --- suppression -----------------------------------------------------------
const suppressed = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,1 +1,2 @@
 a();
+console.log("x"); // slopsieve-ignore: debug-leftovers
`;
assert.ok(!runText(suppressed).flags.some((f) => f.id === "debug-leftovers"), "inline suppression should work");

const suppressedPr = runText(suppressed.replace("slopsieve-ignore: debug-leftovers", ""), { pr: { title: "t", body: "explain [slopsieve-ignore: debug-leftovers]" } });
assert.ok(!suppressedPr.flags.some((f) => f.id === "debug-leftovers"), "PR-body suppression should work");

// --- generated/lockfile exclusion ------------------------------------------
const lock = `diff --git a/package-lock.json b/package-lock.json
index 1..2 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,900 @@
+${"  dep,".repeat(0)}+console.log("x");
`;
{
  const r = runText(lock);
  assert.equal(r.totals.files, 0, "lockfile skipped");
  assert.equal(r.skippedGen, 1);
}

// --- secret-in-diff ---------------------------------------------------------
const secret = `diff --git a/src/cfg.js b/src/cfg.js
index 1..2 100644
--- a/src/cfg.js
+++ b/src/cfg.js
@@ -1,1 +1,2 @@
 a();
+const STRIPE_KEY = "${"sk_" + "live_"}4eC39HqLyjWDarjtT1zdp7dc";
`;
assert.ok(runText(secret).flags.some((f) => f.id === "secret-in-diff"), "live key should flag");

// --- untested-feature -------------------------------------------------------
const untested = `diff --git a/src/big.js b/src/big.js
new file mode 100644
index 0000000..a 100644
--- /dev/null
+++ b/src/big.js
@@ -0,0 +1,160 @@
+${"const x = 1;\n+".repeat(159)}const x = 1;`;
assert.ok(runText(untested).flags.some((f) => f.id === "untested-feature"), "150+ src lines no tests should flag");

// --- dead-code: default export + non-new files stay clean --------------------
const defaultExport = `diff --git a/src/existing.js b/src/existing.js
index 1..2 100644
--- a/src/existing.js
+++ b/src/existing.js
@@ -1,1 +1,2 @@
 a();
+export function newHelper() { return 1; }
`;
assert.ok(!runText(defaultExport).flags.some((f) => f.id === "dead-code-added"), "export in existing file is legitimate API");

// --- CLI: arg edge cases -----------------------------------------------------
{
  let code = 0;
  try { execFileSync("node", [bin, "fixtures/slop.patch", "--fail-at"], { cwd: root }); } catch (e) { code = e.status; }
  assert.equal(code, 2, "--fail-at without number must exit 2");
}

// --- end-to-end: file arg, exit codes, formats -------------------------------
const out = execFileSync("node", [bin, "fixtures/slop.patch", "--no-color", "--fail-at", "0"], { cwd: root, encoding: "utf8" }).toString();
assert.match(out, /SLOP SCORE: \d+\/100/);
assert.ok(!out.includes("\x1b["), "--no-color must not contain ANSI codes");

let code = 0;
try { execFileSync("node", [bin, "fixtures/clean.patch"], { cwd: root }); } catch (e) { code = e.status; }
assert.equal(code, 0, "clean.patch should exit 0");
try { execFileSync("node", [bin, "fixtures/slop.patch"], { cwd: root }); assert.fail("slop.patch should exit 1"); }
catch (e) { assert.equal(e.status, 1); }

const j = JSON.parse(execFileSync("node", [bin, "fixtures/slop.patch", "--json", "--fail-at", "0"], { cwd: root, encoding: "utf8" }));
assert.equal(j.tool, "slopsieve");
assert.ok(j.flags.length >= 5);

const gh = execFileSync("node", [bin, "fixtures/slop.patch", "--format", "github", "--fail-at", "0"], { cwd: root, encoding: "utf8" });
assert.match(gh, /::warning file=tests\/cart\.test\.js,line=\d+,title=test-weakening/);
assert.ok(!gh.includes("%3A") && !gh.includes("%2C"), "github message body must not percent-encode colons or commas");

const sarif = JSON.parse(execFileSync("node", [bin, "fixtures/slop.patch", "--format=sarif", "--fail-at=0"], { cwd: root, encoding: "utf8" }));
assert.equal(sarif.version, "2.1.0");
assert.ok(sarif.runs?.[0]?.results?.length >= 5, "SARIF report has results");
assert.ok(sarif.runs[0].results.some((r) => r.locations?.[0]?.physicalLocation?.region?.startLine > 0), "SARIF locations carry startLine");

let badFmtCode = 0;
try { execFileSync("node", [bin, "fixtures/clean.patch", "--format", "xml"], { cwd: root }); } catch (e) { badFmtCode = e.status; }
assert.equal(badFmtCode, 2, "invalid --format must exit 2");

// stdin pipe: `cat fixture | slopsieve` must not EAGAIN on non-blocking fds
const stdinOut = execFileSync("node", [bin, "--no-color", "--fail-at", "0"], { cwd: root, encoding: "utf8", input: readFileSync(join(root, "fixtures", "slop.patch"), "utf8") }).toString();
assert.match(stdinOut, /SLOP SCORE: \d+\/100/, "piped stdin should score the diff");

// phantom-imports: fixture importing a nonexistent relative file
const phantom = `diff --git a/src/x.js b/src/x.js
index 1..2 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,1 +1,2 @@
 a();
+import { thing } from "./does/not/exist-xyz.js";
`;
assert.ok(runText(phantom, { cwd: root }).flags.some((f) => f.id === "phantom-imports"), "missing local import should flag");

console.log(`ok - slop=${slop.score} clean=${clean.score} flags=${slop.flags.map((f) => f.id).join(",")}`);
