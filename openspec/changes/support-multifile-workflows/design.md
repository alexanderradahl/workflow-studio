## Context

Workflow Studio v0.1.1 bundles one trusted `build-artifact` definition. Its MCP schema, runtime guard, worker permission profile, journal validator, normalized state, and widget all assume one exact `output_path`. Ultracode already supports sequential `workspace-write` workers and custom result schemas, but its workflow scripts cannot perform host filesystem or Git verification directly. Deterministic scope enforcement and changed-file proof therefore belong in the plugin runtime.

The correction must preserve the exact-file workflow, dirty-worktree safety, repository instructions, disabled worker networking, trusted exact-path workflow definitions, and a useful visual history after the immediate tool call completes.

## Goals / Non-Goals

**Goals:**

- Support substantial multi-file repository changes through one fixed bundled workflow.
- Bound every writable worker to 1–32 explicit relative file or directory scopes.
- Respect repository `AGENTS.md` instructions while ignoring unrelated user configuration.
- Detect tracked, untracked, and ignored file deltas across the repository while excluding only Git metadata.
- Persist host-verified changed-file evidence in the run journal for later dashboard reads.
- Keep `run_build_artifact` and legacy single-file dashboard payloads working.
- Ship the corrected release candidate as `v0.2.0`.

**Non-Goals:**

- Accept caller-provided workflow source, scripts, commands, environment variables, models, or arbitrary permissions.
- Permit networking, commits, pushes, deployments, sends, or other external actions from workers.
- Support non-Git workspaces in the first multi-file release.
- Use Ultracode worktree isolation, which does not preserve dirty workspace state or untracked files reliably.
- Turn Workflow Studio into a generic shell runner or replace ordinary Codex execution for trivial work.

## Decisions

### Add a second trusted workflow instead of weakening the artifact workflow

Add bundled `workflows/change-workspace.js` and an MCP tool named `run_workspace_workflow`. Keep `run_build_artifact` and its exact output guard unchanged. Both tools share the run queue and dashboard, while a runtime registry maps only known workflow IDs to exact plugin-local source paths, hashes, and phase metadata.

Alternative considered: replace `run_build_artifact` with a broad workspace tool. Rejected because it would remove the stronger least-privilege option and break existing callers.

### Require a canonical Git root and explicit write scopes

The workspace workflow requires an absolute existing Git worktree root with a valid `HEAD` and 1–32 normalized relative `write_paths`. `.` and `.git` are rejected. Existing scope components must not be symbolic links; existing exact files and all observed files must not be hard-linked. Missing final scope paths are allowed only when their immediate parent already exists, is safe, and is inside the workspace. Missing intermediate components are rejected; Codex must authorize the first missing directory or an existing parent scope.

Alternative considered: whole-workspace write access. Rejected because it makes accidental unrelated edits harder to prevent and review. Explicit directories still allow large refactors without enumerating every final file.

### Build the permission profile from structured host paths

The runtime passes only canonical authorized target paths. The worker wrapper revalidates their containment and path identity, synthesizes one fixed `artifact_guard` profile, grants workspace read, temporary-directory write, authorized-path write, and disabled networking, and rejects caller configuration, profile, add-directory, search, feature, and sandbox-bypass overrides. For workspace workflows it omits `--ignore-rules` so repository instructions load; for artifact workflows it retains the current isolated rule behavior.

Alternative considered: parse caller-provided permissions in the wrapper. Rejected because callers must not control the permission profile.

### Use shared-workspace serial writers and parallel read-only review

The bundled workflow uses parallel read-only framing, one read-only planner, one serialized shared-workspace implementer, parallel read-only reviewers, one conditional serialized repairer, and one final read-only verifier. Planner, writer, repairer, and verifier use custom JSON schemas, followed by explicit JavaScript validation because Ultracode can return best-effort schema-invalid output after retries.

Alternative considered: Ultracode worktree isolation. Rejected because the current implementation starts from `HEAD`, can fall back silently to the shared workspace, misses untracked files in its diff capture, and deletes the temporary worktree.

### Make host-observed file evidence authoritative

Before launch, the runtime records `HEAD`, Git porcelain state, and streamed hashes/modes for tracked, untracked, and ignored files across the repository, plus a recursive snapshot of every authorized scope. After launch it repeats the snapshot and computes added, modified, deleted, and mode-changed files. Any observed delta outside the authorized scopes fails acceptance. The observed set must match the workflow's reported changed paths, and the final verifier must report every observed changed path as verified.

The runtime atomically adds a `workflow_studio` evidence block to a trusted journal, including the workflow source hash, pre-evidence journal digest, requested scopes, before/after Git state, changed-file records, acceptance result, and verification timestamp. Dashboard reads bind the exact workflow id/path/hash and run filename, verify the digest, and revalidate worker and host evidence. If launch or journal loading fails, the runtime still takes the post-run snapshot and returns immediate rejected file evidence without assigning trust to a missing or suspect journal.

Alternative considered: trust worker-reported changed files. Rejected because model output is not a deterministic enforcement layer and cannot detect unrelated concurrent edits.

### Extend normalized state compatibly

Normalized schema v2 adds `writePaths`, `files: [{path, planned, changed, verified, status}]`, and `fileCounts`. `outputPath` and `absoluteOutputPath` remain for legacy and single-file runs. Accepted legacy artifact journals synthesize one planned/changed/verified file row; failed or running legacy runs never infer verification.

The widget adds a compact Files panel, a verified-file metric, and an `Open changes` conversational action for multi-file runs. It retains `Open output` for one file and never launches a write directly.

## Risks / Trade-offs

- **Large repositories make snapshotting expensive** → Limit visible snapshot entries and fail before starting a writer when the bound is exceeded; stream file hashes instead of loading files into memory.
- **Write scopes are too narrow** → Fail closed and let Codex request a revised visible scope rather than silently broadening permissions.
- **A concurrent process changes an unrelated visible file** → Reject acceptance and show the observed outside-scope delta, even if the worker was not the cause.
- **Ignored dependency trees make snapshotting expensive** → Include them in the same bounded snapshot and fail closed before a writer starts when the entry limit is exceeded.
- **Historical files change after a run** → Display persisted host evidence and do not claim the current workspace still matches the completed run.
- **Repository rules conflict with the workflow prompt** → Nearest repository instructions win; the workflow remains blocked or reports findings rather than bypassing them.

## Migration Plan

1. Add failing tests for multi-scope validation, wrapper permissions, journal evidence, normalization, MCP routing, and legacy compatibility.
2. Add the trusted workspace workflow, guarded runtime path, and journal registry.
3. Update the Skill, global awareness rule, dashboard, documentation, screenshot, and version to `0.2.0`.
4. Run unit, wrapper, MCP, Skill, plugin, release, and OpenSpec validation.
5. Reinstall the personal plugin and run isolated fresh-chat tests that modify two files inside authorized scopes while rejecting a trivial edit route.
6. Commit the corrected release candidate without creating a remote, tag, or GitHub release.

Rollback is the prior `v0.1.1` local commit; the additive tool leaves the original single-file runtime available throughout development.

## Open Questions

None for `v0.2.0`. Non-Git workspaces, configurable bundled workflow catalogs, and broader write-scope UX can be considered separately after the guarded repository workflow is proven.
