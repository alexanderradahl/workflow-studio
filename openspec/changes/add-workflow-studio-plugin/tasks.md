## 1. Plugin Foundation

- [x] 1.1 Replace the scaffold manifest with production plugin metadata, MCP wiring, icons, and a personal marketplace entry
- [x] 1.2 Add package scripts and dependencies for a bundled stdio MCP server and self-contained MCP App widget
- [x] 1.3 Bundle the guarded build-artifact workflow and its isolated Codex worker launcher

## 2. Conversational Invocation

- [x] 2.1 Implement the workflow-studio Skill with explicit and implicit invocation guidance
- [x] 2.2 Add Codex Skill UI metadata, starter prompts, and tool-routing instructions

## 3. Guarded Workflow Runtime

- [x] 3.1 Implement fixed-schema run, latest-dashboard, and named-run MCP tools
- [x] 3.2 Add normalized relative-path validation and pre/post no-follow output checks
- [x] 3.3 Launch Ultracode with fixed local controls and normalize the matching journal into typed workflow state
- [x] 3.4 Return accurate text and structured fallbacks for ready, accepted, and failed states

## 4. Inline Workflow Dashboard

- [x] 4.1 Build a self-contained MCP App resource with host-native light and dark styling
- [x] 4.2 Render workflow status, phases, output, findings, duration, and token usage accessibly
- [x] 4.3 Add safe widget actions that send visible follow-up messages without directly starting writes

## 5. Verification and Installation

- [x] 5.1 Add unit and protocol tests for path guards, tool/resource discovery, and journal normalization
- [x] 5.2 Build and validate the plugin and Skill manifests
- [x] 5.3 Install workflow-studio from the personal marketplace and verify a new Codex session loads it
- [x] 5.4 Run a guarded smoke workflow and verify its structured result and inline widget resource
