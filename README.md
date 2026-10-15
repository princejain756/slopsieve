# slopsieve

**`npx slopsieve` scores a diff or PR for the slop signals maintainers check by hand - test weakening, debug leftovers, trivial deps, dead exports. A linter for unreviewed generation.**

![slopsieve scoring a slop PR vs a clean diff](demo.png)

cURL killed its bug bounty over AI slop. Godot is drowning in it. GitHub floated a PR kill switch. The maintainers' complaint is consistent: the code *looks* fine until you actually read it. slopsieve runs the checklist a tired reviewer runs at 1am, in a second, against any diff.

## install / run

```bash
npx slopsieve owner/repo#123        # score a GitHub PR (uses gh)
npx slopsieve changes.diff          # score a patch file
git diff main | npx slopsieve       # score stdin
```

Zero dependencies. Node 18+.

## what it flags

| signal | weight | what it catches |
|---|---|---|
| test weakening | 30 | `it.skip`, `.only`, removed assertions, tautological `assertTrue(true)` |
| debug leftovers | 25 | `console.log`, `debugger`, `pdb.set_trace`, `binding.pry` |
| test file deleted | 25 | spec file removed while source changed |
| empty catch/except | 20 | `catch (e) {}`, `except: pass` |
| trivial dependency | 20 | `is-odd`-class deps; any new dep for a small diff |
| commented-out code | 15 | dead code shipped as comments |
| narration comments | 10 | "This function...", "Here we...", "Ensure that..." |
| exported but unreferenced | 10 | exports nothing in the diff uses |
| whitespace churn | 10 | files changed only in whitespace |
| oversized diff | 10 | >800 added lines or >15 files |
| vague util sprawl | 5 | new `utils.js`/`helpers.py` catch-alls |
| no linked context | 5 | PR body under 20 chars (gh mode) |

Exit code is `1` when the score hits `--fail-at` (default 50), so it works as a CI gate:

```yaml
- run: gh pr diff ${{ github.event.pull_request.number }} | npx slopsieve --fail-at 60
```

`--json` gives the same report for tooling.

## honest limitations

- **It is not an AI detector.** It scores diff hygiene signals. A human can write a 100/100 slop diff and an LLM can write a 0/100 clean one - the point is both deserve the same review burden.
- **Intra-diff analysis only.** "Exported but unreferenced" means unreferenced *in this diff*; real callers elsewhere in the repo are invisible to it.
- **Heuristics have blind spots.** `print(` flags Python; commented-out-code needs a code symbol to trigger; a two-line `catch` on separate lines escapes the single-line pattern.
- **Weights are opinionated.** The 30/25/20 tiers reflect how loudly each signal correlates with unreviewed generation in practice, not a study.

## why this exists

- [cURL scraps bug bounties over AI slop](https://reddit.com/r/programming/comments/1ql0w5p/) (2,049 upvotes of agreement)
- [Godot drowning in slop PRs](https://news.ycombinator.com/item?id=47059779)
- [GitHub ponders a PR kill switch](https://news.ycombinator.com/item?id=46884471)
- ["I won't be reviewing AI generated PRs"](https://reddit.com/r/ExperiencedDevs/comments/1towli9/) (1,922 upvotes)

## related

[mcp-bouncer](https://github.com/princejain756/mcp-bouncer) - policy enforcement at the MCP boundary · [agent-trials](https://github.com/princejain756/agent-trials) - benchmark coding agents on tasks you own

## license

MIT
