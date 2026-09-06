# Changelog

## 0.2.1 - 2026-09-06

- Require normalized repository-relative paths in worker schemas and prompts to prevent planner formatting failures.
- Preserve the actual workflow and worker errors in initial results and dashboard/history views.
- Scale workspace snapshots beyond ordinary dependency-tree sizes while preserving ignored-file change detection.
- Discover installed Codex and Ultracode directly, removing private helper and fixed app-path assumptions.
- Allow read-only linked-worktree metadata and exact ancestor discovery files; isolate scratch access to each worker's private temporary directory.
- Support temporary validation copies for tools that write caches next to source, and verify permissions with a native sandbox smoke check.
- Add regressions from real failed runs and prepare the MIT-licensed public distribution.

## 0.2.0 - 2026-08-30

- Added a guarded `change-workspace` workflow for substantial bounded multi-file repository changes.
- Added fixed multi-path permissions, active repository instructions, and host-observed changed-file acceptance evidence.
- Added a `run_workspace_workflow` MCP tool while preserving the exact-file `run_build_artifact` contract.
- Upgraded the inline dashboard to show write scopes plus planned, changed, and verified file states.
- Updated Skill discovery and Codex routing guidance so appropriate multi-file implementation requests can select Workflow Studio.

## 0.1.1 - 2026-08-29

Initial GitHub release candidate.

- Added selective implicit invocation for substantial single-artifact work.
- Added the guarded six-phase build-artifact workflow and exact-path worker controls.
- Added fixed MCP run/status/dashboard tools and a self-contained inline visual dashboard.
- Added public repository documentation, marketplace metadata, CI, and release validation.
