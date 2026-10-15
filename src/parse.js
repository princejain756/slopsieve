// Minimal unified-diff parser. No dependencies.
// Handles git diffs AND plain `diff -u` output, CRLF, timestamps, quoted paths,
// mode-only changes, renames, and empty files. Hunk boundaries come from the
// @@ -o,c +n,c @@ counts, so a removed line starting with "-- " can't be
// mistaken for a "--- " file header.

const strip = (p) =>
  p.split("\t")[0].trim().replace(/^"|"$/g, "").replace(/^[ab]\//, "");

const newFile = (oldPath, newPath) => ({
  oldPath, newPath, isNew: false, isDeleted: false, hunks: [], adds: [], dels: [], ctxs: [],
});

export function parseDiff(text) {
  const files = [];
  let cur = null;
  let hunk = null; // { oldStart, newStart, oldLeft, newLeft, lines }
  const hunkOpen = () => hunk && (hunk.oldLeft > 0 || hunk.newLeft > 0);

  for (const raw of text.split(/\r?\n/)) {
    if (!hunkOpen() && raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
      cur = newFile(m?.[1] || null, m?.[2] || null);
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!hunkOpen() && cur && raw.startsWith("new file mode")) { cur.isNew = true; continue; }
    if (!hunkOpen() && cur && raw.startsWith("deleted file mode")) { cur.isDeleted = true; continue; }

    if (!hunkOpen() && raw.startsWith("--- ")) {
      if (cur === null || cur.hunks.length > 0) {
        // plain `diff -u` (no diff --git): a --- line after a finished file
        // starts the next file record
        cur = newFile(null, null);
        files.push(cur);
      }
      cur.oldPath = raw.includes("/dev/null") ? null : strip(raw.slice(4));
      if (raw.includes("/dev/null")) cur.isNew = true;
      continue;
    }
    if (!hunkOpen() && raw.startsWith("+++ ")) {
      if (cur) {
        cur.newPath = raw.includes("/dev/null") ? null : strip(raw.slice(4));
        if (raw.includes("/dev/null")) cur.isDeleted = true;
      }
      continue;
    }
    if (!cur) continue;

    if (!hunkOpen()) {
      const m = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        hunk = {
          oldStart: +m[1],
          newStart: +m[3],
          oldLeft: m[2] === undefined ? 1 : +m[2],
          newLeft: m[4] === undefined ? 1 : +m[4],
          lines: [],
        };
        cur.hunks.push(hunk);
      }
      continue;
    }

    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      const l = { type: "add", text: raw.slice(1), line: hunk.newStart + (hunk.newCount ?? 0) };
      hunk.newCount = (hunk.newCount ?? 0) + 1;
      hunk.newLeft--;
      hunk.lines.push(l);
      cur.adds.push(l);
    } else if (raw.startsWith("-")) {
      const l = { type: "del", text: raw.slice(1), line: hunk.oldStart + (hunk.oldCount ?? 0) };
      hunk.oldCount = (hunk.oldCount ?? 0) + 1;
      hunk.oldLeft--;
      hunk.lines.push(l);
      cur.dels.push(l);
    } else {
      const l = { type: "ctx", text: raw.replace(/^ /, ""), line: hunk.newStart + (hunk.newCount ?? 0) };
      hunk.newCount = (hunk.newCount ?? 0) + 1;
      hunk.oldCount = (hunk.oldCount ?? 0) + 1;
      hunk.oldLeft--;
      hunk.newLeft--;
      hunk.lines.push(l);
      cur.ctxs.push(l);
    }
  }

  for (const f of files) f.path = f.newPath || f.oldPath || "(unknown)";
  return files;
}

// Paths nobody should lint: lockfiles, build output, minified, snapshots.
export const GENERATED_PATH =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)|\.min\.[a-z]+$|(^|\/)dist\/|(^|\/)build\/|\.snap$|\.map$/i;

export function totals(files) {
  let add = 0;
  let del = 0;
  for (const f of files) {
    add += f.adds.length;
    del += f.dels.length;
  }
  return { files: files.length, add, del };
}
