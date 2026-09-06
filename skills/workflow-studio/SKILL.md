---
name: workflow-studio
description: "Run and visualize guarded multi-agent workflows for substantial single-file artifacts or multi-file repository changes. Use for explicit $workflow-studio requests and substantial local write work that benefits from separate discovery, planning, implementation, review, repair, and verification. Do not use for simple edits, read-only analysis, command-only work, external actions, or requests prioritizing minimum latency or cost."
---

# Workflow Studio

Workflow Studio owns two fixed local workflows:

- `build-artifact` creates and independently verifies one substantial file.
- `change-workspace` plans, implements, reviews, repairs, and verifies a bounded multi-file change in a Git repository.

Both workflows return the same inline visual dashboard. They expose fixed arguments only and do not accept arbitrary workflow paths, commands, flags, environment variables, networking, or research toggles.

## Eligibility gate

Select Workflow Studio implicitly only when all of the following are true:

- The user explicitly asks Codex to create, write, or implement a local result.
- The work is substantial enough that independent planning and review materially improve quality.
- The requested result fits one of the two bounded modes below.
- The destination and write boundary can be inferred safely from the current workspace.

Typical eligible work includes:

- A substantial single-file artifact such as a decision brief, implementation plan, launch checklist, research synthesis, or specification.
- A substantial multi-file repository change such as a feature, refactor, or migration with a concrete task and a narrow set of writable file or directory scopes.

Do not select Workflow Studio implicitly for:

- A direct answer, explanation, brainstorming session, plan discussion, or read-only review.
- A small or obvious edit that ordinary Codex execution can complete directly.
- Command-only work, test execution, debugging, or status checks not asking for an implementation.
- Sending, publishing, deploying, browser mutation, provider actions, or any other external effect.
- Requests prioritizing minimum latency or cost over independent multi-agent review.

When eligibility is borderline, keep the task on its ordinary Codex path. Explicit `$workflow-studio` invocation establishes workflow intent, but it does not authorize a file write; require a concrete artifact brief and destination, or a concrete repository implementation request and bounded write scopes, before calling a writable tool.

## Route the request

- Use `run_build_artifact` when the requested primary result is exactly one substantial local file.
- Use `run_workspace_workflow` for a substantial multi-file change in an existing Git repository.
- Use `show_workflow_dashboard` for “show Workflow Studio,” latest-run, status, history, or visual-dashboard requests.
- Use `get_workflow_run` for a specific run id.
- The MCP result already carries the inline visual resource. Do not create a second visualization unless the user asks for a different artifact.

## Single-file run contract

Before `run_build_artifact`, establish:

- `task`: the concrete artifact brief.
- `workspace`: an absolute existing local directory. Use the current workspace only when it is positively available in runtime context.
- `output_path`: one normalized relative file path whose parent directory already exists.
- Optional `artifact_type`, `constraints`, `source_context`, and `scouts` from 2 through 4.

## Multi-file run contract

Before `run_workspace_workflow`, establish:

- `task`: the concrete repository change requested by the user.
- `workspace`: the absolute root of an existing Git worktree with a valid `HEAD`.
- `write_paths`: 1 through 32 normalized relative file or directory scopes that cover the intended change. Derive these from inspected repository structure and the request. A missing final path is allowed only under an existing safe immediate parent. Never use `.` or `.git`, and never broaden the scopes merely to avoid a boundary failure.
- Optional bounded `constraints`, `source_context`, and `scouts` from 2 through 4.

The workspace workflow respects repository instructions, serializes writable workers, and independently verifies the host-observed changed-file set. A failed run can leave local changes inside the authorized scopes, so report the file-level outcome accurately.

Prepare the repository's existing dependencies and focused validation commands before starting a run, within the user's authorized scope. Workers have no command networking and cannot install missing dependencies. They can use disposable validation copies under `TMPDIR` when test runners require config or cache writes outside the repository write scopes; the original source remains protected. Read-only Git inspection also works for linked worktrees.

If a required value cannot be inferred safely, ask only for the smallest missing detail. A general plan or capability question is not authorization to create or modify files.

## Safety and reporting

- Never pass arbitrary binaries, command flags, script paths, environment variables, or research toggles.
- Never translate an absolute, parent-traversing, symbolic-link, hard-link, `.git`, whole-workspace, or otherwise unsafe path into a workaround. A single-file output still requires an existing safe parent. Report the boundary and ask for a valid relative path or bounded scope.
- Treat `accepted: true` plus the tool's verified file state as the only success condition.
- If a workflow is blocked or rejected, name the blocking finding and keep the result failed; do not imply that the requested work was accepted.
- After an accepted run, report the run id and verified output path or changed-file set. Do not start another write without a new visible request.
