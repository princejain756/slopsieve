// Slop-signal checks over a parsed diff. Each returns null (clean) or
// { id, weight, title, evidence[] }. Weights sum into the slop score (cap 100).

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|cypress|fixtures)\/|\.(test|spec)\.[a-z]+$|(_test|_spec)\.[a-z]+$|test_[\w.]+$/i;
const MANIFEST = /(^|\/)(package\.json|requirements.*\.txt|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml)$/;
const COMMENT = /^\s*(\/\/|\/\*|\*|#(?!!)|<!--|--)/;

// commented-out code = code keyword + code symbol; a lone "return early" comment stays clean
const looksLikeCode = (s) =>
  /=>|\)\s*\{|[\w)\]]\s*[=!<>]=|[;{}]$|\b(if|for|while|elif|import|from|func|fn|def|class|public|private|return|const|let|var)\b[^.]*[();{}=<>]/.test(s);

const ev = (f, l) => `${f.path}:${l.line} ${l.text.trim().slice(0, 80)}`;
const cap = (arr, n = 4) => arr.slice(0, n);

export const checks = [
  {
    id: "debug-leftovers",
    weight: 25,
    title: "debug leftovers",
    run(files) {
      const hits = [];
      for (const f of files)
        for (const l of f.adds)
          if (/console\.(log|debug)\s*\(|\bdebugger\b|pdb\.set_trace|binding\.(pry|irb)|fmt\.Println|System\.out\.println|var_dump\s*\(|\bdd\s*\(/.test(l.text))
            hits.push(ev(f, l));
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
        for (const l of f.adds) {
          if (/\.(skip|only)\s*\(|^\s*(xit|xdescribe|xtest|ftest)\s*\(|@Disabled|pytest\.mark\.(skip|xfail)|unittest\.skip|\.todo\s*\(/.test(l.text))
            hits.push(ev(f, l));
          if (/assert(True|Equals)\(\s*(true|1)\s*[,)]|expect\(\s*true\s*\)\.(toBe|toEqual)\(\s*true/.test(l.text))
            hits.push(`${ev(f, l)}  <- tautological assertion`);
        }
        const delAsserts = f.dels.filter((l) => /\b(assert|expect|should|verify)\b/.test(l.text)).length;
        const addAsserts = f.adds.filter((l) => /\b(assert|expect|should|verify)\b/.test(l.text)).length;
        if (delAsserts - addAsserts >= 3) hits.push(`${f.path}: ${delAsserts - addAsserts} more assertion lines removed than added`);
      }
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "test-file-deleted",
    weight: 25,
    title: "test file deleted",
    run(files) {
      const gone = files.filter((f) => f.isDeleted && TEST_PATH.test(f.path));
      const hasCode = files.some((f) => !TEST_PATH.test(f.path) && !f.isDeleted);
      return gone.length && hasCode
        ? { evidence: cap(gone.map((f) => `${f.path} deleted while ${files.length - gone.length} non-test file(s) changed`)) }
        : null;
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
          if (/\}\s*catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\([^)]*\)\s*\{\s*\}|except[^:()]*:\s*pass\s*$|rescue\s*(=>|=>?\s*\w*)?\s*$/.test(l.text))
            hits.push(ev(f, l));
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "commented-out-code",
    weight: 15,
    title: "commented-out code shipped",
    run(files) {
      const hits = [];
      for (const f of files)
        for (const l of f.adds)
          if (COMMENT.test(l.text) && looksLikeCode(l.text.replace(/^\s*(\/\/+|\/\*+|\*+|#+|<!--|--)\s?/, "")))
            hits.push(ev(f, l));
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
      for (const f of files)
        for (const l of f.adds)
          if (COMMENT.test(l.text) && PAT.test(l.text)) hits.push(ev(f, l));
      return hits.length >= 4 ? { evidence: cap(hits), detail: `${hits.length} narration comments` } : null;
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
          const depAdds = f.adds.filter((l) => /"[\w@./-]+"\s*:|^[\s]*[\w.-]+\s*[=<>!~]=|require\(|gem\s+'/.test(l.text)).length;
          if (depAdds) hits.push(`${f.path}: ${depAdds} new dep entr${depAdds > 1 ? "ies" : "y"} for a ${tot.add}-line diff`);
        }
      }
      return hits.length ? { evidence: cap(hits) } : null;
    },
  },
  {
    id: "dead-code-added",
    weight: 10,
    title: "exported but unreferenced",
    run(files) {
      const bodies = files.flatMap((f) => [...f.adds, ...f.ctxs].map((l) => ({ f, l })));
      const hits = [];
      for (const f of files)
        for (const l of f.adds) {
          const m = l.text.match(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+(\w+)/);
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
        if (!f.adds.length || !f.dels.length) return false;
        const norm = (ls) => ls.map((l) => l.text.replace(/\s+/g, "")).sort().join("\n");
        return norm(f.adds) === norm(f.dels);
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

export function analyze(files, prMeta = null) {
  const tot = { files: files.length, add: files.reduce((n, f) => n + f.adds.length, 0), del: files.reduce((n, f) => n + f.dels.length, 0) };
  const flags = checks
    .map((c) => ({ ...c, result: c.run(files, tot, prMeta) }))
    .filter((c) => c.result)
    .map((c) => ({ id: c.id, weight: c.weight, title: c.title, ...c.result }))
    .sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, flags.reduce((n, f) => n + f.weight, 0));
  const verdict =
    score <= 10 ? ["LOW", "low slop signal - looks reviewable"] :
    score <= 35 ? ["MEDIUM", "a few flags - worth a real look"] :
    score <= 70 ? ["HIGH", "heavy slop signal - request changes or an explanation"] :
                  ["ALARM", "strong unreviewed-generation signals - likely reject"];
  const cleanIds = checks.filter((c) => !flags.find((f) => f.id === c.id)).map((c) => c.title);
  return { score, band: verdict[0], verdict: verdict[1], totals: tot, flags, cleanIds };
}
