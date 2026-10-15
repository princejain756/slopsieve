// Slop-signal checks over a parsed diff. Each returns null (clean) or
// { id, weight, title, evidence[] }. Weights sum into the slop score (cap 100),
// scaled by extra hits so 1 stray console.log isn't punished like 40.
// `// slopsieve-ignore` on a line, or `[slopsieve-ignore: id]` in the diff or PR
// body, suppresses that check.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GENERATED_PATH } from "./parse.js";

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|cypress|fixtures)\/|\.(test|spec)\.[a-z]+$|(_test|_spec)\.[a-z]+$|test_[\w.]+$/i;
const MANIFEST = /(^|\/)(package\.json|requirements.*\.txt|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml)$/;
const DOC_PATH = /\.(md|mdx|txt|rst|adoc|markdown)$/i;
const COMMENT = /^\s*(\/\/|\/\*|\*|#(?!!)|<!--|--)/;
const IGNORE = /slopsieve-ignore/;

// commented-out code = comment containing a code keyword + a code symbol;
// a lone "return early" or "@returns {bool}" stays clean
const looksLikeCode = (s) =>
  /=>|\)\s*\{|[\w)\]]\s*[=!<>]=|[;{}]\s*$|\b(if|for|while|elif|import|from|func|fn|def|class|public|private|return|const|let|var)\b[^.]*[(){}=<>;]/.test(s);

const ev = (f, l) => `${f.path}:${l.line} ${l.text.trim().slice(0, 80)}`;
const cap = (arr, n = 4) => arr.slice(0, n);

const commentBody = (t) =>
  t.replace(/^\s*(\/\/+|\/\*+|\*+|#+|<!--|--)\s?/, "").replace(/\s*(\*\/|-->)\s*$/, "");

export const checks = [
  {
    id: "secret-in-diff",
    weight: 40,
    title: "possible secret committed",
    run(files) {
      const PAT =
        /\b(sk_(live|test)_[0-9a-zA-Z]{16,}|sk-[a-zA-Z0-9_-]{16,}|rk_(live|test)_[0-9a-zA-Z]{16,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9a-zA-Z-]{10,}|glpat-[0-9a-zA-Z_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|npm_[0-9a-zA-Z]{30,}|hf_[0-9a-zA-Z]{30,})\b|\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret)\s*[:=]\s*["']?[0-9a-zA-Z_\-/.+]{20,}["']?/i;
      const hits = [];
      for (const f of files)
        for (const l of f.adds)
          if (!COMMENT.test(l.text) && PAT.test(l.text)) hits.push(ev(f, l).replace(/(['"]?)([0-9a-zA-Z_\-/.+]{8})[0-9a-zA-Z_\-/.+]{6,}/g, "$1$2..."));
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "test-weakening",
    weight: 30,
    title: "test weakening",
    run(files) {
      const hits = [];
      for (const f of files.filter((x) => TEST_PATH.test(x.path))) {
        const parameterized = f.adds.some((l) => /\.(each|forEach|parametrize)|\bfor\s*\(/.test(l.text));
        for (const l of f.adds) {
          if (/\.(skip|only)\s*\(|^\s*(xit|xdescribe|xtest|ftest)\s*\(|@Disabled|pytest\.mark\.(skip|xfail)|unittest\.skip|\.todo\s*\(/.test(l.text))
            hits.push(ev(f, l));
          if (/assert(True|Equals)\(\s*(true|1)\s*[,)]|expect\(\s*true\s*\)\.(toBe|toEqual)\(\s*true/.test(l.text))
            hits.push(`${ev(f, l)}  <- tautological assertion`);
        }
        const ASSERT = /\b(assert\w*\s*\(|expect\s*\(|\.should\b|verify\s*\()/;
        const delAsserts = f.dels.filter((l) => ASSERT.test(l.text)).length;
        const addAsserts = f.adds.filter((l) => ASSERT.test(l.text)).length;
        if (!parameterized && delAsserts - addAsserts >= 3)
          hits.push(`${f.path}: ${delAsserts - addAsserts} more assertion lines removed than added`);
      }
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "debug-leftovers",
    weight: 25,
    title: "debug leftovers",
    run(files) {
      // stdout is the product in cli/script entrypoints - prints stay clean
      // there, but real traps (debugger, pdb, binding.pry) still flag everywhere
      const STDOUT_TOOL = /(^|\/)(bin|scripts?|cli|cmds?|tools?)\/|(^|\/|\.)cli\.[mc]?[jt]s$/;
      const PRINT = /console\.(log|debug|warn|error|info)\s*\(|fmt\.Println|System\.out\.println|(?<![\w.])print\s*\(|(?<![\w.])puts\s+[a-zA-Z_"'(]|println!\s*\(|dbg!\s*\(/;
      const TRAP = /\bdebugger\b|pdb\.set_trace|binding\.(pry|irb)|var_dump\s*\(|\bdd\s*\(/;
      const hits = [];
      for (const f of files)
        for (const l of f.adds)
          if (!COMMENT.test(l.text) && (TRAP.test(l.text) || (PRINT.test(l.text) && !STDOUT_TOOL.test(f.path))))
            hits.push(ev(f, l));
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "test-file-deleted",
    weight: 25,
    title: "test file deleted",
    run(files) {
      const gone = files.filter((f) => f.isDeleted && TEST_PATH.test(f.path));
      const added = files.filter((f) => f.isNew && TEST_PATH.test(f.path)).length;
      const hasCode = files.some((f) => !TEST_PATH.test(f.path) && !f.isDeleted);
      return gone.length > added && hasCode
        ? { evidence: cap(gone.slice(added).map((f) => `${f.path} deleted while non-test files changed`)) }
        : null;
    },
  },
  {
    id: "phantom-imports",
    weight: 20,
    title: "import of missing local file",
    run(files, _tot, _pr, ctx) {
      if (!ctx?.cwd) return null;
      const hits = [];
      for (const f of files) {
        const seen = new Set();
        for (const l of [...f.adds, ...f.ctxs]) {
          const m = l.text.match(/(?:from|import|require)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/) || l.text.match(/import\s+["'](\.{1,2}\/[^"']+)["']/);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          const base = resolve(ctx.cwd, dirname(f.path), m[1]);
          const inDiff = files.some((o) => base.endsWith("/" + o.path) || base === resolve(ctx.cwd, o.path));
          if (inDiff) continue;
          const exists = [base, `${base}.js`, `${base}.ts`, `${base}.mjs`, `${base}.jsx`, `${base}.tsx`, `${base}.py`, `${base}/index.js`, `${base}/index.ts`].some((p) => existsSync(p));
          if (!exists) hits.push(`${f.path}:${l.line} imports '${m[1]}' - not found on disk or in this diff`);
        }
      }
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "empty-catch",
    weight: 20,
    title: "empty catch/except",
    run(files) {
      const hits = [];
      for (const f of files)
        for (const l of f.adds)
          if (/\bcatch\s*(\([^)]*\))?\s*\{\s*\}|\bexcept[^:()]*:\s*pass\s*(#.*)?$|rescue\s*(=>\s*\w+\s*)?(end|#.*)?$/.test(l.text))
            hits.push(ev(f, l));
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "trivial-dependency",
    weight: 20,
    title: "dependency added for trivial use",
    run(files, tot) {
      const TRIVIAL = /^(is-odd|is-even|is-number|left-pad|isarray|is-windows|is-positive|is-negative|is-integer|upper-case|lower-case|is-true|is-false)$/i;
      const hits = [];
      for (const f of files.filter((x) => MANIFEST.test(x.path))) {
        for (const l of f.adds) {
          const js = l.text.match(/"([\w@./-]+)"\s*:\s*"[\^~>=*\d]/)?.[1];
          const py = /^[\s]*([\w.-]+)([=<>!~]=|\s*$)/.exec(l.text.trim())?.[1];
          const name = f.path.endsWith("package.json") ? js : f.path.endsWith(".txt") ? py : null;
          if (name && TRIVIAL.test(name.replace(/^@.*\//, ""))) hits.push(`${f.path}:${l.line} adds '${name}'`);
        }
        if (!hits.length && tot.add < 250) {
          const isDep = (l) => /"[\w@./-]+"\s*:\s*"[\^~>=<*\d]/.test(l.text) || /^\s*[\w.-]+\s*[=<>!~]=\s*[\d]/.test(l.text);
          const net = f.adds.filter(isDep).length - f.dels.filter(isDep).length;
          if (net > 0) hits.push(`${f.path}: ${net} net new dep entr${net > 1 ? "ies" : "y"} for a ${tot.add}-line diff`);
        }
      }
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "untested-feature",
    weight: 15,
    title: "feature code, zero test changes",
    run(files) {
      const srcAdd = files.filter((f) => !TEST_PATH.test(f.path) && !MANIFEST.test(f.path) && !DOC_PATH.test(f.path)).reduce((n, f) => n + f.adds.length, 0);
      const testAdd = files.filter((f) => TEST_PATH.test(f.path)).reduce((n, f) => n + f.adds.length + f.dels.length, 0);
      return srcAdd > 150 && testAdd === 0
        ? { evidence: [`${srcAdd} lines of implementation added, 0 lines touched in test files`] }
        : null;
    },
  },
  {
    id: "commented-out-code",
    weight: 15,
    title: "commented-out code shipped",
    run(files) {
      const hits = [];
      for (const f of files.filter((x) => !DOC_PATH.test(x.path)))
        for (const l of f.adds) {
          if (!COMMENT.test(l.text)) continue;
          const body = commentBody(l.text);
          if (/^@(param|returns?|type|typedef|example|see|throws|template|description|deprecated)\b/.test(body)) continue;
          if (looksLikeCode(body)) hits.push(ev(f, l));
        }
      return hits.length >= 3 ? { evidence: cap(hits), detail: `${hits.length} commented-out lines` } : null;
    },
  },
  {
    id: "boilerplate-comments",
    weight: 10,
    title: "narration comments",
    run(files) {
      const PAT = /(This (function|method|class|variable|module|code|block|line|is|will|returns?|handles?|checks?|initializes?|creates?|defines?|ensures?|validates?|iterates?|loops?|processes?|parses?|converts?|calculates?|helper|section)|Here,? we|Note that|Simply|First,? we|Then,? we|Next,? we|Finally,? we|Now,? we|Initialize|Iterate over|Loop through|Check (if|whether|that)|Ensure that|Make sure|Declare and initialize|The following (code|function|method|block)|Import (the )?necessary)/i;
      const hits = [];
      for (const f of files.filter((x) => !DOC_PATH.test(x.path)))
        for (const l of f.adds)
          if (COMMENT.test(l.text) && PAT.test(l.text)) hits.push(ev(f, l));
      return hits.length >= 4 ? { evidence: cap(hits), detail: `${hits.length} narration comments` } : null;
    },
  },
  {
    id: "dead-code-added",
    weight: 10,
    title: "exported but unreferenced",
    run(files) {
      const bodies = files.flatMap((f) => [...f.adds, ...f.ctxs].map((l) => ({ f, l })));
      const hits = [];
      for (const f of files.filter((x) => x.isNew))
        for (const l of f.adds) {
          if (l.text.includes("export default")) continue;
          const m = l.text.match(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/);
          if (!m) continue;
          const refs = bodies.filter((b) => b.l !== l && new RegExp(`\\b${m[1]}\\b`).test(b.l.text));
          if (!refs.length) hits.push(`${f.path}:${l.line} '${m[1]}' is exported but referenced nowhere in this diff`);
        }
      return hits.length ? { evidence: cap(hits, 3) } : null;
    },
  },
  {
    id: "whitespace-churn",
    weight: 10,
    title: "whitespace-only churn",
    run(files) {
      const churn = files.filter((f) => {
        if (!f.adds.length || f.adds.length !== f.dels.length) return false;
        const norm = (ls) => ls.map((l) => l.text.replace(/\s+/g, "")).join("");
        const changed = f.adds.some((a, i) => a.text !== f.dels[i]?.text);
        return changed && norm(f.adds) === norm(f.dels);
      });
      return churn.length
        ? { evidence: cap(churn.map((f) => `${f.path}: ${f.adds.length + f.dels.length} lines changed, identical after whitespace normalization`)) }
        : null;
    },
  },
  {
    id: "giant-diff",
    weight: 10,
    title: "oversized diff",
    run(files, tot) {
      const hits = [];
      if (tot.add > 800) hits.push(`${tot.add} added lines (threshold 800)`);
      if (tot.files > 15) hits.push(`${tot.files} files touched (threshold 15)`);
      return hits.length ? { evidence: hits } : null;
    },
  },
  {
    id: "vague-sprawl",
    weight: 5,
    title: "vague util sprawl",
    run(files) {
      const hits = files
        .filter((f) => f.isNew && /(^|\/)(utils?|helpers?|misc|common|shared|stuff|tools?|funcs?)\.[^/]+$/i.test(f.path))
        .map((f) => `${f.path} created (generic name, catch-all destination)`);
      return hits.length ? { evidence: cap(hits, 3) } : null;
    },
  },
  {
    id: "missing-context",
    weight: 5,
    title: "no linked context",
    run(_files, _tot, pr) {
      if (!pr) return null;
      return (pr.body || "").trim().length < 20 ? { evidence: ["PR body under 20 chars; no linked issue or rationale"] } : null;
    },
  },
];

// Inline markers suppress for the file containing them (eslint-disable style);
// only PR-body [slopsieve-ignore: id] suppresses globally.
const suppressed = (files, prMeta) => {
  const global = new Set();
  const perFile = new Map();
  for (const f of files)
    for (const l of [...f.adds, ...f.ctxs]) {
      const m = l.text.match(/slopsieve-ignore(?::\s*([\w-]+(?:\s*,\s*[\w-]+)*))?/);
      if (!m) continue;
      const s = perFile.get(f.path) || perFile.set(f.path, new Set()).get(f.path);
      for (const id of (m[1] || "all").split(/\s*,\s*/)) s.add(id);
    }
  if (prMeta?.body)
    for (const m of prMeta.body.matchAll(/\[slopsieve-ignore(?::\s*([\w-]+(?:\s*,\s*[\w-]+)*))?\]/g))
      for (const id of (m[1] || "all").split(/\s*,\s*/)) global.add(id);
  return { global, perFile };
};

export function analyze(rawFiles, prMeta = null, opts = {}) {
  const files = rawFiles.filter((f) => !GENERATED_PATH.test(f.path));
  const skippedGen = rawFiles.length - files.length;
  const off = suppressed(rawFiles, prMeta);
  const tot = { files: files.length, add: files.reduce((n, f) => n + f.adds.length, 0), del: files.reduce((n, f) => n + f.dels.length, 0) };
  const suppressedCount = [...off.perFile.values()].reduce((n, s) => n + s.size, 0) + off.global.size;
  const flags = checks
    .filter((c) => !off.global.has("all") && !off.global.has(c.id) && !(opts.disabled || []).includes(c.id))
    .map((c) => {
      const visible = files.filter((f) => !off.perFile.get(f.path)?.has("all") && !off.perFile.get(f.path)?.has(c.id));
      return { ...c, result: c.run(visible, tot, prMeta, opts) };
    })
    .filter((c) => c.result)
    .map((c) => {
      const base = opts.weights?.[c.id] ?? c.weight;
      const extra = Math.max(0, (c.result.evidence?.length || 0) - 1) * 2;
      return { id: c.id, weight: Math.min(base + extra, Math.round(base * 1.5)), title: c.title, ...c.result };
    })
    .sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, flags.reduce((n, f) => n + f.weight, 0));
  const verdict =
    score <= 10 ? ["LOW", "low slop signal - looks reviewable"] :
    score <= 35 ? ["MEDIUM", "a few flags - worth a real look"] :
    score <= 70 ? ["HIGH", "heavy slop signal - request changes or an explanation"] :
                  ["ALARM", "strong unreviewed-generation signals - likely reject"];
  const cleanIds = checks.filter((c) => !flags.find((f) => f.id === c.id)).map((c) => c.title);
  const suppressedList = [...off.global].concat([...off.perFile.entries()].flatMap(([p, s]) => [...s].map((id) => `${p}:${id}`)));
  return { score, band: verdict[0], verdict: verdict[1], totals: tot, flags, cleanIds, skippedGen, suppressed: suppressedList, suppressedCount };
}
