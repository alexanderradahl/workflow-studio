---
name: workflow-studio
description: "Create and independently verify one substantial local artifact through a guarded visual multi-agent workflow, or inspect its dashboard. Use for explicit $workflow-studio requests and substantial single-file deliverables that benefit from separate framing, planning, build, review, repair, and verification. Do not use for simple edits, read-only analysis, multi-file implementation, command-only work, or external actions."
---

# Workflow Studio

Workflow Studio owns one fixed local workflow: `build-artifact`. It frames a brief with independent workers, plans the artifact, gives one least-privilege worker the exact output path, reviews the real file, repairs supported findings, and performs a final read-only verification.

## Eligibility gate

Select Workflow Studio implicitly only when all of the following are true:

- The user explicitly asks Codex to create or write an artifact.
- The requested primary result is one local file.
- The artifact is substantial enough that independent framing and review materially improve quality.
- The destination can be expressed as a normalized relative path in an existing local workspace.

Typical eligible work includes a decision brief, implementation plan, launch checklist, research synthesis, specification, or other single-file deliverable where independent review is useful.

Do not select Workflow Studio implicitly for:

- A direct answer, explanation, brainstorming session, plan discussion, or read-only review.
- A small or obvious edit that ordinary Codex execution can complete directly.
- Multi-file coding, feature implementation, refactoring, migrations, or repository-wide changes.
- Command-only work, test execution, debugging, or status checks not asking for a new artifact.
- Sending, publishing, deploying, browser mutation, provider actions, or any other external effect.
- Requests prioritizing minimum latency or cost over independent multi-agent review.

When eligibility is borderline, keep the task on its ordinary Codex path. Explicit `$workflow-studio` invocation establishes plugin intent, but it does not authorize a file write unless the user also requests creation of a concrete artifact.

## Route the request

- For a request to create or run an artifact, call `run_build_artifact`. Do not reconstruct or invoke an Ultracode shell command yourself.
- For “show Workflow Studio”, “show the latest run”, status, history, or visual-dashboard requests, call `show_workflow_dashboard`.
- For a specific run id, call `get_workflow_run`.
- The MCP result already carries the inline visual resource. Do not create a second visualization unless the user asks for a different artifact.

## Run contract

Before `run_build_artifact`, establish:

- `task`: the concrete artifact brief.
- `workspace`: an absolute existing local directory. Use the current workspace only when it is positively available in runtime context.
- `output_path`: one normalized relative file path whose parent directory already exists.
- Optional `artifact_type`, `constraints`, `source_context`, and `scouts` from 2 through 4.

If a required value cannot be inferred safely, ask only for the smallest missing detail. A general plan or capability question is not authorization to create a file. Call the writable tool only after the user asks to run or create the artifact.

## Safety and reporting

- Never pass arbitrary binaries, command flags, script paths, environment variables, or research toggles.
- Never translate an absolute, parent-traversing, symbolic-link, hard-link, or missing-parent output into a workaround. Report the boundary and ask for a valid relative path.
- Treat `accepted: true` plus the tool's verified output state as the only success condition.
- If the workflow is blocked or rejected, name the blocking finding and keep the result failed; do not imply that an artifact was produced.
- After an accepted run, report the run id and relative output path. Offer to open the output or run another workflow, but do not start another write without a new visible request.
