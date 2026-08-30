# Workflow Studio

Workflow Studio is a Codex plugin for running guarded multi-agent workflows and inspecting their results as an inline visual dashboard. It supports both a substantial single-file artifact and a bounded multi-file repository change.

![Workflow Studio dashboard](assets/workflow-studio-preview.png)

Release candidate: `v0.2.0`. The GitHub repository and license have not been published or selected yet.

## When to use it

Use Workflow Studio when substantial local write work materially benefits from separate discovery, planning, implementation, review, repair, and final verification:

- Single-file mode creates one substantial artifact such as a decision brief, implementation plan, launch checklist, research synthesis, or specification.
- Workspace mode implements a substantial feature, refactor, or migration across a narrow set of files or directories in an existing Git repository.

Keep ordinary Codex execution for simple edits, direct answers, read-only analysis, command-only work, debugging or status checks without an implementation request, external actions, or tasks prioritizing minimum latency and cost.

Explicit invocation remains available:

```text
$workflow-studio Create a launch brief at docs/launch-brief.md.
$workflow-studio Implement the requested feature across src/billing and tests/billing.
```

Codex may also select the Skill implicitly when the eligibility boundary is met.

## Reliable selection in crowded Codex profiles

Profiles with many installed skills or plugins can have competing discovery descriptions. Explicit `$workflow-studio` invocation remains the portable baseline. If you want reliable automatic routing on your own machine, add this bounded rule to `~/.codex/AGENTS.md`:

```markdown
# Workflow Studio Routing

- Use `$workflow-studio` for an explicit create/write request when the deliverable is a substantial single-file artifact or multi-file repository change and separate discovery, planning, implementation, review, repair, and verification materially improve the result.
- For multi-file work, require a concrete implementation request, an existing Git worktree, and narrow writable file or directory scopes; use the fixed workspace workflow rather than inventing commands or broadening the scope.
- Do not use Workflow Studio for direct answers, planning or review-only work, trivial edits, command/test/debug/status work, external actions, or requests prioritizing minimum latency or cost.
- Explicit `$workflow-studio` invocation expresses workflow intent but does not authorize a write; require a concrete artifact brief and destination or a concrete repository change with bounded write scopes before starting a writable workflow.
```

The plugin does not edit global Codex instructions during installation. This opt-in rule is visible in every workspace while preserving the same bounded eligibility gate.

## How it works

```text
Codex chat
  -> Workflow Studio Skill eligibility gate
  -> fixed local MCP tool
       -> build-artifact: one exact output file
       -> change-workspace: bounded Git repository paths
  -> guarded multi-agent workflow
  -> host-observed file verification
  -> trusted run journal
  -> inline MCP App dashboard
```

The single-file workflow runs Frame → Plan → Build → Review → Repair → Verify. Its writable workers receive only the exact requested output path.

The workspace workflow runs Discover → Plan → Implement → Review → Repair → Verify. It requires the absolute root of a Git worktree with a valid `HEAD` and 1–32 normalized relative write scopes. It rejects whole-workspace, `.git`, absolute, traversal, linked, and unsafe missing-parent paths. Writable phases are serialized; reviewers and the final verifier are read-only. Repository instructions remain active.

Both writable tools expose fixed schemas only: no arbitrary command, binary, script, flag, environment, networking, or research surface. The host snapshots Git-visible and authorized-scope state before and after the run, rejects observed changes outside the requested scopes, and cross-checks worker-reported files before accepting the result. A failed workspace run can leave local changes inside authorized scopes, and the dashboard reports those files rather than implying rollback.

## Visual dashboard

Every tool result carries the same inline MCP App. The dashboard shows:

- current state and workflow phase;
- planned, changed, and verified file counts;
- authorized write scopes and per-file status badges;
- blocking findings, timing, and usage;
- “Open output” for a single file or “Open changes” for a multi-file result.

Use `show_workflow_dashboard` for the latest trusted run or `get_workflow_run` for a specific run id.

## Install after publication

Once `github.com/alexanderradahl/workflow-studio` is published:

```bash
codex plugin marketplace add alexanderradahl/workflow-studio
codex plugin add workflow-studio@workflow-studio
```

Start a new Codex chat after installation so the Skill and MCP server load.

Useful prompts:

```text
Use $workflow-studio to implement this bounded multi-file repository change.
Use $workflow-studio to create a substantial single-file implementation brief.
Show the latest Workflow Studio dashboard.
Explain whether Workflow Studio is appropriate for this task.
```

## Development

Requirements: macOS, Node.js 24 or newer, an authenticated Codex installation, and Ultracode at `~/.local/bin/ultracode`.

```bash
npm ci
npm run check
```

Important files:

- `.codex-plugin/plugin.json` - plugin metadata and discovery copy
- `skills/workflow-studio/SKILL.md` - eligibility and conversational routing
- `mcp/server.mjs` - fixed MCP tools and inline UI resource
- `workflows/build-artifact.js` - exact-file workflow
- `workflows/change-workspace.js` - bounded multi-file workflow
- `src/workspace-guard.mjs` - path, snapshot, and acceptance guards
- `src/widget.js` - dashboard app

See [CONTRIBUTING.md](CONTRIBUTING.md) for change guidance and [RELEASING.md](RELEASING.md) for the deliberate publication checklist.

## Release and license status

No open-source license has been selected. Before making the repository public, choose a license (or intentionally publish without one), update the plugin manifest, and follow [RELEASING.md](RELEASING.md).
