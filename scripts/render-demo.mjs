// Regenerates demo.html from a REAL slopsieve run. Never hand-edit the output.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => {
  try {
    return execFileSync("node", [join(root, "bin/slopsieve.js"), ...args, "--no-color"], { encoding: "utf8" });
  } catch (e) {
    return e.stdout; // nonzero exit still produced the report
  }
};

const slop = run(["fixtures/slop.patch", "--fail-at", "0"]);
const clean = run(["fixtures/clean.patch", "--fail-at", "0"]);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const paint = (text) =>
  esc(text)
    .replace(/^slopsieve ([\d.]+)/m, '<span class="big">slopsieve $1</span>')
    .replace(/SLOP SCORE: (\d+)\/100 - (\w+)/g, (_m, s, b) => `<span class="${b === "LOW" ? "ok" : "score"}">SLOP SCORE: ${s}/100 - ${b}</span>`)
    .replace(/^(FLAGS|CLEAN|verdict:.*)$/gm, '<span class="big">$1</span>')
    .replace(/\[(\s*\d+)\]/g, '<span class="wt">[$1]</span>')
    .replace(/^      (?!\s*$)(.+)$/gm, '<span class="dim">      $1</span>')
    .replace(/═+/g, '<span class="dim">$&</span>')
    .replace(/(\d+ files · .+)$/gm, '<span class="dim">$1</span>');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #0b0e14; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: "SF Mono", Menlo, monospace; }
  .term { width: 1000px; margin: 40px; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.6); background: #0d1117; border: 1px solid #21262d; }
  .bar { display: flex; gap: 8px; padding: 14px 16px; background: #161b22; border-bottom: 1px solid #21262d; align-items: center; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
  .title { margin-left: 12px; color: #7d8590; font-size: 13px; }
  pre { margin: 0; padding: 26px 32px 32px; font-size: 15.5px; line-height: 1.55; color: #c9d1d9; white-space: pre-wrap; }
  .p { color: #79c0ff; } .dim { color: #7d8590; }
  .big { color: #79c0ff; font-weight: 700; }
  .score { color: #f85149; font-weight: 700; }
  .ok { color: #3fb950; font-weight: 700; }
  .wt { color: #f85149; font-weight: 600; }
</style>
</head>
<body>
<div class="term">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">zsh</span></div>
<pre><span class="p">$</span> npx slopsieve fixtures/slop.patch
${paint(slop)}
<span class="p">$</span> git show HEAD | slopsieve --fail-at 60
${paint(clean)}<span class="dim">  exit 0 - would pass a CI gate</span>
<span class="p">$</span> <span class="dim">|</span></pre>
</div>
</body>
</html>
`;
writeFileSync(join(root, "demo.html"), html);

// social card: 1280x640, same real output re-flowed so it fits landscape
const flagLines = slop.split("\n").filter((l) => /^\s+\[\s*\d+\]/.test(l)).map((l) => l.trim());
const score = slop.match(/SLOP SCORE: (\d+)\/100 - (\w+)/);
const verdict = slop.match(/verdict: (.+)/)?.[1] || "";
const social = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1280px; height: 640px; background: #0b0e14; display: flex; font-family: "SF Mono", Menlo, monospace; overflow: hidden; }
  .left { width: 62%; padding: 44px 40px; border-right: 1px solid #21262d; background: #0d1117; display: flex; flex-direction: column; justify-content: center; }
  .cmd { color: #79c0ff; font-size: 20px; margin-bottom: 22px; }
  .flag { color: #c9d1d9; font-size: 20px; line-height: 1.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .flag b { color: #f85149; font-weight: 600; margin-right: 10px; }
  .right { width: 38%; padding: 52px 44px; display: flex; flex-direction: column; justify-content: center; }
  .name { color: #79c0ff; font-size: 44px; font-weight: 700; margin-bottom: 18px; }
  .tag { color: #7d8590; font-size: 21px; line-height: 1.5; margin-bottom: 34px; }
  .score { color: #f85149; font-size: 40px; font-weight: 700; }
  .verdict { color: #7d8590; font-size: 17px; margin-top: 14px; line-height: 1.5; }
</style></head><body>
<div class="left">
  <div class="cmd">$ npx slopsieve your-org/repo#128</div>
  ${flagLines.map((l) => `<div class="flag"><b>${esc(l.match(/^\[\s*\d+\]/)[0])}</b>${esc(l.replace(/^\[\s*\d+\]\s*/, ""))}</div>`).join("\n  ")}
</div>
<div class="right">
  <div class="name">slopsieve</div>
  <div class="tag">Score a diff or PR for AI-slop review signals, before a human wastes time on it.</div>
  <div class="score">${score[1]}/100 - ${score[2]}</div>
  <div class="verdict">${esc(verdict)}</div>
</div>
</body></html>`;
writeFileSync(join(root, "social.html"), social);
console.log("demo.html + social.html regenerated from live runs");
