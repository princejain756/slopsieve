// Minimal unified-diff parser. No dependencies.
// Produces per-file lists of added / removed / context lines with line numbers.

const strip = (p) => p.trim().replace(/^"|"$/g, "").replace(/^[ab]\//, "");

export function parseDiff(text) {
  const files = [];
  let cur = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git")) {
      cur = { oldPath: null, newPath: null, isNew: false, isDeleted: false, hunks: [], adds: [], dels: [], ctxs: [] };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("--- ")) {
      cur.oldPath = raw.includes("/dev/null") ? null : strip(raw.slice(4));
      if (raw.includes("/dev/null")) cur.isNew = true;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      cur.newPath = raw.includes("/dev/null") ? null : strip(raw.slice(4));
      if (raw.includes("/dev/null")) cur.isDeleted = true;
      continue;
    }
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      oldNo = +m[1];
      newNo = +m[2];
      hunk = { oldStart: oldNo, newStart: newNo, lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      const l = { type: "add", text: raw.slice(1), line: newNo++ };
      hunk.lines.push(l);
      cur.adds.push(l);
    } else if (raw.startsWith("-")) {
      const l = { type: "del", text: raw.slice(1), line: oldNo++ };
      hunk.lines.push(l);
      cur.dels.push(l);
    } else {
      const l = { type: "ctx", text: raw.replace(/^ /, ""), line: newNo };
      newNo++;
      oldNo++;
      hunk.lines.push(l);
      cur.ctxs.push(l);
    }
  }

  for (const f of files) f.path = f.newPath || f.oldPath || "(unknown)";
  return files;
}

export function totals(files) {
  let add = 0;
  let del = 0;
  for (const f of files) {
    add += f.adds.length;
    del += f.dels.length;
  }
  return { files: files.length, add, del };
}
