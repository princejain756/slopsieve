// Terminal + JSON rendering.

const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m" };
export function textReport(r, target, version, useColor = true) {
  const c = useColor ? C : Object.fromEntries(Object.keys(C).map((k) => [k, ""]));
  const bc = (b) => (b === "LOW" ? c.green : b === "MEDIUM" ? c.yellow : c.red);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`${c.bold}slopsieve ${version}${c.reset} ${c.dim}· ${target} · ${date}${c.reset}`);
  lines.push(`${c.dim}${"═".repeat(56)}${c.reset}`);
  lines.push(`${bc(r.band)}${c.bold}SLOP SCORE: ${r.score}/100 - ${r.band}${c.reset}`);
  lines.push(`${c.dim}${r.totals.files} files · +${r.totals.add} -${r.totals.del} lines${c.reset}`);
  lines.push("");
  if (r.flags.length) {
    lines.push(`${c.bold}FLAGS${c.reset}`);
    for (const f of r.flags) {
      lines.push(`  ${c.red}[${String(f.weight).padStart(2)}] ${f.title}${f.detail ? ` (${f.detail})` : ""}${c.reset}`);
      for (const e of f.evidence) lines.push(`      ${c.dim}${e}${c.reset}`);
    }
    lines.push("");
  }
  if (r.cleanIds.length) {
    lines.push(`${c.bold}CLEAN${c.reset}`);
    lines.push(`  ${c.green}${r.cleanIds.join(" · ")}${c.reset}`);
    lines.push("");
  }
  lines.push(`${c.dim}verdict: ${r.score}/100 - ${r.verdict}${c.reset}`);
  return lines.join("\n");
}

export function jsonReport(r, target, version) {
  return JSON.stringify({ tool: "slopsieve", version, target, ...r }, null, 2);
}
