# Contributing

Workflow Studio intentionally owns one workflow: creating and independently verifying one substantial local artifact. Keep contributions within that boundary.

## Development setup

```bash
npm ci
npm run check
```

For plugin-specific local validation, also run:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/workflow-studio
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

## Change expectations

- Preserve fixed-schema MCP tools; do not add arbitrary command or script execution.
- Preserve exact-path output guards and network-disabled workers.
- Keep implicit invocation selective. Simple edits, read-only work, multi-file coding, and external actions are not Workflow Studio tasks.
- Add or update tests for behavior-changing edits.
- Keep generated build output (`dist/workflow-studio-widget.html`) current.
- Do not commit `node_modules`, local run journals, or smoke artifacts.

Pull requests should explain the user-visible outcome, relevant safety boundary, and checks run.
