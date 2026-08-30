## Context

The existing `build-artifact` workflow is a guarded JavaScript workflow executed by Ultracode. It coordinates read-only framing, planning, review, and verification workers around one exact-path writer. Today it is discoverable through a shell command and its JSON journal, but it is not loaded as a Codex Skill or rendered as an inline chat component.

The plugin must remain local-first, preserve the existing filesystem and network boundaries, work from ordinary Codex prompts, and degrade cleanly when the host does not support MCP App resources.

## Goals / Non-Goals

**Goals:**

- Make workflow execution and inspection discoverable through `$workflow-studio` and natural-language prompts.
- Bundle a self-contained workflow definition and guarded subprocess runner.
- Expose fixed-schema local MCP tools for run, status, and dashboard operations.
- Render a compact inline dashboard showing phases, acceptance, findings, output, duration, and usage.
- Keep every external action and arbitrary command surface out of scope.
- Validate the plugin, Skill, MCP protocol, UI resource contract, and installation path.

**Non-Goals:**

- Reimplement Ultracode's orchestration engine.
- Add remote hosting, authentication, cloud persistence, deployment, or sending capabilities.
- Provide arbitrary workflow-script execution or arbitrary CLI arguments.
- Guarantee live iframe progress before a tool call returns; the first version renders final or journaled state and emits ordinary MCP progress where supported.

## Decisions

### Use a personal marketplace plugin

The plugin source lives at `~/plugins/workflow-studio` and is registered in the default personal marketplace. This is the supported local development path and makes the plugin visible in Codex UI ordering without requiring a custom marketplace installation.

Alternative considered: repository-local plugin packaging. Rejected because the requested behavior is personal and should be available across Codex workspaces.

### Pair a Skill with a local stdio MCP App

The Skill provides conversational routing and usage guidance. A bundled stdio MCP server provides the actual tools and a `ui://` resource. The UI remains additive: each tool also returns a complete text summary and structured content.

Alternative considered: Skill-only wrapper around the shell command. Rejected because it would not produce an inline visual element or a typed tool boundary.

### Expose fixed tools, not arbitrary commands

The server exposes `run_build_artifact`, `show_workflow_dashboard`, and `get_workflow_run`. Inputs are validated and translated into a fixed Ultracode invocation. Callers cannot provide arbitrary flags, script paths, binaries, or environment overrides.

Alternative considered: a generic `run_workflow` command tool. Rejected because it would expand the execution surface beyond the user's requested workflow.

### Bundle the workflow and guard runner

The plugin carries its own workflow source and `codex-lean` runner. The MCP server prepends the plugin scripts directory to `PATH`, pins the ChatGPT app's native Codex executable so the nested macOS sandbox does not traverse a user-level launcher, sets exact guard environment variables, launches Ultracode with the bundled script path, and performs independent no-follow output checks.

Alternative considered: depend on `~/.codex/ultracode/workflows/build-artifact.js`. Rejected because plugin behavior would silently drift or fail when the global file changes or is absent.

### Read final state from the exact returned journal

The tool launches Ultracode without human progress output, parses its complete stdout buffer as one JSON record, takes only that record's exact run id, and then reads and verifies the corresponding journal under `CODEX_HOME`. The journal becomes the typed source for dashboard normalization; no unscoped “latest run” lookup participates in execution acceptance.

Alternative considered: discover a new journal by modification time or parse only the last output line. Rejected because concurrent runs make “latest” ambiguous and pretty-printed JSON is not a last-line protocol.

### Render one reusable dashboard resource

Run, status, and dashboard tools reference the same versioned `ui://widget/workflow-studio-v1.html` resource. The widget uses host theme variables, supports compact and expanded layouts, and turns actions into visible chat messages rather than directly launching a second write.

Alternative considered: a separate widget per phase. Rejected because the workflow is best understood as one stateful sequence.

## Risks / Trade-offs

- **Long-running tool call** → Emit MCP progress notifications when available and always return a durable run id and journal-derived final state.
- **Ultracode CLI drift** → Pin fixed arguments, validate the discovered version at startup, and keep journal normalization tolerant of additive fields.
- **Plugin cache staleness** → Use the cachebuster/reinstall flow and require a new Codex thread after installation.
- **Widget host differences** → Return full text and structured content; keep the widget self-contained with an inlined Apps bridge and no external resources.
- **Path or link escape** → Reuse normalized relative-path checks, real parent resolution, pre/post `lstat`, `realpath`, and single-link requirements.
- **Unexpected external I/O** → Apply native network-off permission profiles to every child worker and expose no remote MCP tools.

## Migration Plan

1. Build and validate the plugin source and MCP server locally.
2. Add the personal marketplace entry and install `workflow-studio@personal`.
3. Start a new Codex thread so the Skill and MCP tools load.
4. Verify chat discovery, tools/list, resources/read, a guarded smoke run, and inline dashboard rendering.
5. Roll back by uninstalling the plugin; the existing global workflow remains unchanged.

## Open Questions

None required for the first local version. A future version may add live journal refresh inside the widget if the Codex host exposes a stable refresh lifecycle for local MCP Apps.
