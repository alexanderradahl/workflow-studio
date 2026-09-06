# Contributing

Workflow Studio intentionally owns two fixed workflows: creating and independently verifying one substantial local artifact, and implementing a bounded multi-file change in a Git repository. Keep contributions within those boundaries.

## Development setup

```bash
npm ci
npm run check
```

For worker permission changes, run `npm run smoke:sandbox` on macOS with Codex installed. It makes no model calls: the native sandbox must allow linked-worktree Git reads, the exact source write, and private scratch files while denying sibling and Git-metadata writes. Live model workflow checks remain a separate release step.

For plugin-specific local validation, also run:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/workflow-studio
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

## Change expectations

- Preserve fixed-schema MCP tools; do not add arbitrary command or script execution.
- Preserve exact-file and bounded multi-path guards, repository-instruction loading, host-observed change evidence, and network-disabled workers.
- Keep implicit invocation selective. Simple edits, read-only work, command-only tasks, external actions, and latency-sensitive work are not Workflow Studio tasks.
- Add or update tests for behavior-changing edits.
- Keep generated build output (`dist/workflow-studio-widget.html`) current.
- Do not commit `node_modules`, local run journals, or smoke artifacts.

Pull requests should explain the user-visible outcome, relevant safety boundary, and checks run.
