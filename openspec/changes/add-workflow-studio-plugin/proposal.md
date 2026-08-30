## Why

The guarded `build-artifact` workflow can currently be launched only through a local CLI command, so it is not discoverable or directly usable from a Codex conversation. Packaging it as a personal Codex plugin can make invocation conversational while giving each run a persistent visual summary inside chat.

## What Changes

- Add a personal `workflow-studio` Codex plugin with UI metadata and starter prompts.
- Add a `$workflow-studio` Skill that routes conversational requests to local workflow tools.
- Add a local stdio MCP server that can inspect and launch the guarded `build-artifact` workflow.
- Add an MCP App resource that renders workflow phases, status, output, review findings, duration, and token usage inline in chat.
- Preserve the existing fail-closed path, permission-profile, network, and output validation boundaries.
- Return meaningful structured text when the host does not render MCP App resources.

## Capabilities

### New Capabilities

- `chat-workflow-execution`: Invoke and inspect the guarded artifact workflow from a Codex conversation through a discoverable Skill and local MCP tools.
- `workflow-dashboard`: Render current or completed workflow state as an inline, host-themed visual component with a structured-text fallback.

### Modified Capabilities

None.

## Impact

- New personal marketplace entry at `~/.agents/plugins/marketplace.json`.
- New plugin source under `~/plugins/workflow-studio`.
- New Node.js dependencies for MCP and MCP Apps support.
- Local subprocess integration with the installed `ultracode` command and its run journals.
- No remote service, account, deployment, or external-send capability is added.
