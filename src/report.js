// Terminal + JSON + GitHub-Actions rendering.

const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m" };

export function textReport(r, target, version, useColor = true) {
  const c = useColor ? C : Object.fromEntries(Object.keys(C).map((k) => [k, ""]));
  const bc = (b) => (b === "LOW" ? c.green : b === "MEDIUM" ? c.yellow : c.red);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`${c.bold}slopsieve ${version}${c.reset} ${c.dim}· ${target} · ${date}${c.reset}`);
  lines.push(`${c.dim}${"═".repeat(56)}${c.reset}`);
  lines.push(`${bc(r.band)}${c.bold}SLOP SCORE: ${r.score}/100 - ${r.band}${c.reset}`);
  lines.push(`${c.dim}${r.totals.files} files · +${r.totals.add} -${r.totals.del} lines${r.skippedGen ? ` · ${r.skippedGen} generated/lockfile skipped` : ""}${r.suppressed?.length ? ` · suppressed: ${r.suppressed.slice(0, 3).join(", ")}${r.suppressed.length > 3 ? ` +${r.suppressed.length - 3} more` : ""}` : ""}${c.reset}`);
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

// ::warning annotations pin each flag onto the PR "Files changed" line.
export function githubReport(r) {
  const escProp = (s) => String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
  const escData = (s) => String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const lines = [];
  for (const f of r.flags)
    for (const e of f.evidence) {
      const m = e.match(/^(.+?):(\d+)/);
      if (m) lines.push(`::warning file=${escProp(m[1])},line=${m[2]},title=${escProp(f.id)}::${escData(f.title)} - ${escData(e.slice(m[0].length).trim())}`);
      else lines.push(`::warning title=${escProp(f.id)}::${escData(f.title)} - ${escData(e)}`);
    }
  lines.push(`::notice title=slopsieve::score ${r.score}/100 - ${r.band}`);
  return lines.join("\n");
}

export function jsonReport(r, target, version) {
  return JSON.stringify({ tool: "slopsieve", version, target, ...r }, null, 2);
}

export function sarifReport(r, target, version) {
  const rules = r.flags.map((f) => ({
    id: f.id,
    shortDescription: { text: f.title },
    defaultConfiguration: { level: f.weight >= 25 ? "error" : "warning" },
    properties: { weight: f.weight }
  }));
  const results = [];
  for (const f of r.flags) {
    const level = f.weight >= 25 ? "error" : "warning";
    if (!f.evidence || f.evidence.length === 0) {
      results.push({
        ruleId: f.id,
        level,
        message: { text: `${f.title}${f.detail ? ` (${f.detail})` : ""}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: "diff" } } }]
      });
      continue;
    }
    for (const e of f.evidence) {
      const m = e.match(/^(.+?):(\d+)/);
      const snippet = m ? e.slice(m[0].length).trim() : e;
      const loc = m
        ? {
            physicalLocation: {
              artifactLocation: { uri: m[1] },
              region: { startLine: Math.max(1, Number(m[2])) }
            }
          }
        : { physicalLocation: { artifactLocation: { uri: "diff" } } };
      results.push({
        ruleId: f.id,
        level,
        message: { text: `${f.title}${snippet ? ` - ${snippet}` : ""}` },
        locations: [loc]
      });
    }
  }
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "slopsieve",
              version,
              informationUri: "https://github.com/princejain756/slopsieve",
              rules
            }
          },
          properties: {
            target,
            score: r.score,
            band: r.band,
            verdict: r.verdict,
            totals: r.totals
          },
          results
        }
      ]
    },
    null,
    2
  );
}
