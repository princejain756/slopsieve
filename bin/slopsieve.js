#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiff } from "../src/parse.js";
import { analyze } from "../src/checks.js";
import { textReport, jsonReport, githubReport, sarifReport } from "../src/report.js";

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;

const HELP = `slopsieve ${VERSION} - score a diff/PR for AI-slop review signals

usage:
  slopsieve <file.diff|file.patch>   score a patch file
  slopsieve owner/repo#123           score a GitHub PR (uses gh)
  slopsieve https://github.com/o/r/pull/123
  slopsieve --staged                 score staged changes (git)
  slopsieve <ref1>..<ref2>           score a git range, e.g. main...HEAD
  git diff | slopsieve               score stdin

flags:
  --json            machine-readable report (shorthand for --format json)
  --format <fmt>    output format: text (default), json, github, sarif
  --fail-at <N>     exit 1 when score >= N (default 50, use 0 to never fail)
  --no-color        plain output
  --config <path>   config file (default: .slopsieverc.json if present)
  -h, --help        this help
  -v, --version     version

config (.slopsieverc.json):
  { "failAt": 50, "disabled": ["narration-comments"], "weights": { "secret-in-diff": 50 } }

suppress in code:  // slopsieve-ignore            -> silences all checks on the diff
                   // slopsieve-ignore: check-id  -> silences one check
suppress in PR body: [slopsieve-ignore: check-id]
`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) { console.log(HELP); process.exit(0); }
if (args.includes("-v") || args.includes("--version")) { console.log(VERSION); process.exit(0); }

const idx = (name) => args.indexOf(name);
const hasFlag = (name) => idx(name) !== -1 || args.some((a) => a.startsWith(`${name}=`));
const val = (name) => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq !== undefined) return eq.slice(name.length + 1);
  return idx(name) !== -1 ? args[idx(name) + 1] : undefined;
};
const VALID_FORMATS = new Set(["text", "json", "github", "sarif"]);
const rawFormat = hasFlag("--format") ? val("--format") : args.includes("--json") ? "json" : "text";
if (!VALID_FORMATS.has(rawFormat)) {
  console.error(`slopsieve: --format must be one of ${Array.from(VALID_FORMATS).join(", ")}`);
  process.exit(2);
}
const color = !args.includes("--no-color") && process.stdout.isTTY !== false;

const failPresent = hasFlag("--fail-at");
const failRaw = val("--fail-at");
let failAt = !failPresent ? 50 : Number(failRaw);
if (failPresent && (failRaw === undefined || failRaw.trim() === "" || Number.isNaN(failAt))) {
  console.error("slopsieve: --fail-at requires a number");
  process.exit(2);
}

const cfgRaw = val("--config");
const cfgPath = cfgRaw !== undefined ? cfgRaw : existsSync(".slopsieverc.json") ? ".slopsieverc.json" : null;
let cfg = {};
if (cfgPath) {
  try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); }
  catch { console.error(`slopsieve: cannot parse ${cfgPath}`); process.exit(2); }
}
if (failRaw === undefined && typeof cfg.failAt === "number") failAt = cfg.failAt;
const opts = { disabled: cfg.disabled || [], weights: cfg.weights || {}, cwd: process.cwd() };

const consumed = new Set();
for (const i of [idx("--fail-at"), idx("--format"), idx("--config")]) if (i >= 0) { consumed.add(i); consumed.add(i + 1); }
const target = args.find((a, i) => !a.startsWith("-") && !consumed.has(i));

function sh(bin_, args_, silent) {
  try {
    return execFileSync(bin_, args_, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`slopsieve: '${bin_} ${args_.slice(0, 2).join(" ")}' failed - ${e.stderr?.toString().trim() || e.message}`);
    process.exit(2);
  }
}

function resolvePr(t) {
  const m = t.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/) || t.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  return m ? { repo: m[1], num: m[2] } : null;
}

let diffText = null;
let prMeta = null;
let label = target || "stdin";

const pr = target && resolvePr(target);
if (pr) {
  diffText = sh("gh", ["pr", "diff", pr.num, "-R", pr.repo]);
  try {
    const meta = JSON.parse(sh("gh", ["pr", "view", pr.num, "-R", pr.repo, "--json", "title,body"]));
    prMeta = meta;
    label = `${pr.repo}#${pr.num} "${meta.title}"`;
  } catch { /* view is best-effort; diff already scored */ }
} else if (args.includes("--staged")) {
  diffText = sh("git", ["diff", "--staged"]);
  label = "git diff --staged";
} else if (target && /^\S+\.\.\.?\S+$/.test(target)) {
  diffText = sh("git", ["diff", target]);
  label = `git diff ${target}`;
} else if (target) {
  try {
    diffText = readFileSync(target, "utf8");
  } catch {
    console.error(`slopsieve: cannot read '${target}' - pass a .diff/.patch file, owner/repo#N, a PR URL, --staged, a ref..ref range, or pipe a diff on stdin`);
    process.exit(2);
  }
} else if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  diffText = Buffer.concat(chunks).toString("utf8");
} else {
  console.error(HELP);
  process.exit(2);
}

if (!diffText || (!diffText.includes("diff --git") && !diffText.match(/^@@ -\d+/m) && !diffText.match(/^--- /m))) {
  console.error("slopsieve: input does not look like a unified diff (expected 'diff --git', '---/+++', or '@@' hunks)");
  process.exit(2);
}

const files = parseDiff(diffText);
if (!files.length) {
  console.error("slopsieve: no file changes found in this diff");
  process.exit(2);
}
const result = analyze(files, prMeta, opts);
const out =
  rawFormat === "github"
    ? githubReport(result)
    : rawFormat === "sarif"
      ? sarifReport(result, label, VERSION)
      : rawFormat === "json"
        ? jsonReport(result, label, VERSION)
        : textReport(result, label, VERSION, color);
console.log(out);
process.exit(failAt > 0 && result.score >= failAt ? 1 : 0);
