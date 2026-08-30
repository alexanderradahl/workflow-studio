# Workflow Studio

Workflow Studio is a Codex plugin for creating one substantial local artifact through a guarded multi-agent workflow, then inspecting the result as an inline visual dashboard.

![Workflow Studio ready-state dashboard](assets/workflow-studio-preview.png)

Release candidate: `v0.1.1`. The GitHub repository and license have not been published or selected yet.

## When to use it

Use Workflow Studio when the requested result is one meaningful local file and separate framing, planning, building, review, repair, and final verification materially improve the result. Good examples include decision briefs, implementation plans, launch checklists, research syntheses, and specifications.

Keep ordinary Codex execution for simple edits, direct answers, read-only analysis, multi-file coding, command-only work, debugging, external actions, or tasks prioritizing minimum latency and cost.

Explicit invocation remains available:

```text
$workflow-studio Create a launch brief at docs/launch-brief.md.
```

Codex may also select the Skill implicitly when the eligibility boundary is met.

## Reliable selection in crowded Codex profiles

Profiles with many installed skills or plugins can have competing discovery descriptions. Explicit `$workflow-studio` invocation remains the portable baseline. If you want reliable automatic routing on your own machine, add this bounded rule to `~/.codex/AGENTS.md`:

```markdown
# Workflow Studio Routing

- Use `$workflow-studio` for an explicit create/write request when the deliverable is exactly one substantial local file and separate framing, planning, build, review, repair, and verification materially improve the result.
- Do not use Workflow Studio for direct answers, planning or review-only work, trivial edits, multi-file implementation, command/test/debug/status work, external actions, or requests prioritizing minimum latency or cost.
- Explicit `$workflow-studio` invocation expresses workflow intent but does not authorize a write; require a concrete artifact brief and destination before starting its writable workflow.
```

The plugin does not edit global Codex instructions during installation. This opt-in rule is visible in every workspace while preserving the same narrow eligibility gate.

## How it works

```text
Codex chat
  -> Workflow Studio Skill eligibility gate
  -> fixed local MCP tool
  -> guarded Ultracode workflow
  -> Frame -> Plan -> Build -> Review -> Repair -> Verify
  -> verified journal and exact output file
  -> inline MCP App dashboard
```

The writable tool accepts only a task, absolute workspace, normalized relative output path, artifact type, bounded constraints/source context, and 2-4 framing scouts. It exposes no arbitrary command, binary, script, flag, environment, or research surface.

Workers run with command networking disabled. Read-only workers cannot modify the workspace, and writable workers receive only the exact requested output path. Pre/post checks reject traversal, missing parents, symlinks, hard links, empty files, and outputs outside the workspace.

## Install after publication

Once `github.com/alexanderradahl/workflow-studio` is published:

```bash
codex plugin marketplace add alexanderradahl/workflow-studio
codex plugin add workflow-studio@workflow-studio
```

Start a new Codex chat after installation so the Skill and MCP server load.

Useful prompts:

```text
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
- `workflows/build-artifact.js` - six-phase workflow
- `src/widget.js` - dashboard app

See [CONTRIBUTING.md](CONTRIBUTING.md) for change guidance and [RELEASING.md](RELEASING.md) for the deliberate publication checklist.

## Release and license status

No open-source license has been selected. Before making the repository public, choose a license (or intentionally publish without one), update the plugin manifest, and follow [RELEASING.md](RELEASING.md).
