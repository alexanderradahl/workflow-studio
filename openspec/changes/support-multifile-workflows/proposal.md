## Why

Workflow Studio currently reproduces multi-agent orchestration but restricts every writable run to one exact output file. That is useful for artifact creation, but it does not match the expected Claude-style workflow capability for substantial repository changes that legitimately create and modify multiple files.

## What Changes

- Add a second fixed MCP workflow tool for substantial multi-file workspace changes while retaining `run_build_artifact` as the strict single-file template.
- Bundle a trusted `change-workspace` workflow with discovery, planning, implementation, independent review, repair, and final verification phases.
- Require 1–32 normalized relative write scopes, enforce those scopes in worker permissions, preserve repository instructions, disable worker networking, and expose no arbitrary workflow path, command, binary, flags, or environment surface.
- Capture deterministic pre/post file evidence and reject accepted journals that report changed paths outside the authorized scopes or unsafe linked paths.
- Generalize trusted run lookup and the visual dashboard to show both single-output artifact runs and multi-file workspace runs.
- Update Skill routing and the local Codex awareness rule so substantial multi-file features, refactors, and migrations can select Workflow Studio while trivial, read-only, command-only, and external-action work remains excluded.
- Prepare the corrected release candidate as `v0.2.0` and preserve backward compatibility for `v0.1.1` single-file runs.

## Capabilities

### New Capabilities

- `workspace-workflow-execution`: Runs one trusted, guarded multi-file workspace workflow and proves its authorized changed-file set before acceptance.

### Modified Capabilities

- `workflow-dashboard`: Extends normalized run state and the inline visual dashboard from one output path to planned, changed, and verified file sets while preserving legacy single-file rendering.
- `appropriate-workflow-routing`: Routes substantial multi-file implementation work to the workspace workflow instead of explicitly excluding it.

## Impact

Affected areas include the bundled workflows, worker wrapper, runtime guards and journal validation, MCP schemas/tools, normalized dashboard state, widget UI, Skill and global Codex routing instructions, tests, screenshot, release documentation, plugin/package metadata, and the personal plugin installation. The existing single-file tool and its exact-path safety contract remain supported.
