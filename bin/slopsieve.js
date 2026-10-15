#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseDiff } from "../src/parse.js";
import { analyze } from "../src/checks.js";
import { textReport, jsonReport } from "../src/report.js";

const VERSION = "0.1.0";

const HELP = `slopsieve ${VERSION} - score a diff/PR for AI-slop review signals

usage:
  slopsieve <file.diff|file.patch>   score a patch file
  slopsieve owner/repo#123           score a GitHub PR (uses gh)
  slopsieve https://github.com/o/r/pull/123
  git diff | slopsieve               score stdin

flags:
  --json            machine-readable report
  --fail-at <N>     exit 1 when score >= N (default 50, use 0 to never fail)
  --no-color        plain output
  -h, --help        this help
  -v, --version     version
`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) { console.log(HELP); process.exit(0); }
if (args.includes("-v") || args.includes("--version")) { console.log(VERSION); process.exit(0); }

const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const json = args.includes("--json");
const color = !args.includes("--no-color") && process.stdout.isTTY !== false;
const failAt = Number(flag("--fail-at", "50"));
const target = args.find((a) => !a.startsWith("-") && a !== flag("--fail-at"));

function gh(args_) {
  try {
    return execFileSync("gh", args_, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`slopsieve: 'gh ${args_[0]}' failed - ${e.stderr?.toString().trim() || e.message}`);
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
  diffText = gh(["pr", "diff", pr.num, "-R", pr.repo]);
  try {
    const meta = JSON.parse(gh(["pr", "view", pr.num, "-R", pr.repo, "--json", "title,body"]));
    prMeta = meta;
    label = `${pr.repo}#${pr.num} "${meta.title}"`;
  } catch { /* view is best-effort; diff already scored */ }
} else if (target) {
  try {
    diffText = readFileSync(target, "utf8");
  } catch {
    console.error(`slopsieve: cannot read '${target}' - pass a .diff/.patch file, owner/repo#N, a PR URL, or pipe a diff on stdin`);
    process.exit(2);
  }
} else if (!process.stdin.isTTY) {
  diffText = readFileSync(0, "utf8");
} else {
  console.error(HELP);
  process.exit(2);
}

if (!diffText || !diffText.includes("diff --git") && !diffText.match(/^@@ -\d+/m)) {
  console.error("slopsieve: input does not look like a unified diff (expected 'diff --git' or '@@' hunks)");
  process.exit(2);
}

const files = parseDiff(diffText);
const result = analyze(files, prMeta);
console.log(json ? jsonReport(result, label, VERSION) : textReport(result, label, VERSION, color));
process.exit(failAt > 0 && result.score >= failAt ? 1 : 0);
