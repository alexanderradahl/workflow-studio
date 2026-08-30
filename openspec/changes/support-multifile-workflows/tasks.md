## 1. Contract Tests

- [x] 1.1 Add multi-file argument, Git-root, and write-scope guard tests
- [x] 1.2 Add worker-wrapper tests for multiple writable paths, disabled networking, and repository-rule loading
- [x] 1.3 Add trusted multi-file journal, outside-scope delta, evidence persistence, and legacy normalization tests
- [x] 1.4 Add MCP tool and discovery-routing tests for single-file versus multi-file selection

## 2. Guarded Workspace Runtime

- [x] 2.1 Add the fixed `change-workspace` workflow with typed planner, writer, repair, and verifier evidence
- [x] 2.2 Add canonical Git workspace and 1–32 relative write-scope validation
- [x] 2.3 Add host-generated multi-path permission profiles and conditional repository-rule loading
- [x] 2.4 Add bounded pre/post repository snapshots, changed-file comparison, and outside-scope rejection
- [x] 2.5 Add atomic host evidence persistence and a trusted bundled-workflow registry
- [x] 2.6 Add `run_workspace_workflow` while preserving the exact-file artifact path and shared write queue

## 3. Visual and Discovery Surfaces

- [x] 3.1 Extend normalized state with compatible file collections, counts, scopes, and workflow identity
- [x] 3.2 Update the widget with planned/changed/verified files and single-output versus multi-change actions
- [x] 3.3 Update the Skill, MCP descriptions, plugin copy, starter prompts, and global Codex routing rule
- [x] 3.4 Update README, changelog, release checklist, screenshot, and release validation for `v0.2.0`

## 4. Validation and Handoff

- [x] 4.1 Run unit, wrapper, MCP, build, Skill, plugin, release, and strict OpenSpec validation
- [x] 4.2 Reinstall `workflow-studio@personal` and verify installed source parity
- [x] 4.3 Forward-test an isolated two-file repository change and a trivial-edit non-routing case in fresh Codex chats
- [x] 4.4 Review the diff subtractively, confirm no remote/tag/release occurred, and commit the corrected release candidate
