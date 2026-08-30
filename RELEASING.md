# Releasing Workflow Studio

Target release: `v0.2.0` at `github.com/alexanderradahl/workflow-studio`.

This checklist prepares publication; do not run the external GitHub commands until publication is explicitly authorized.

## 1. Resolve repository policy

- Choose a license, or deliberately decide to publish without one.
- If a license is selected, add `LICENSE` and set `.codex-plugin/plugin.json` `license` to its SPDX identifier.
- Decide whether the first remote should be public or private for an installation rehearsal.

## 2. Run local preflight

```bash
npm ci
npm run check
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/workflow-studio
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
openspec validate improve-discovery-and-github-release
openspec validate support-multifile-workflows --strict
git status --short
```

Require a clean tree and confirm the committed plugin version is `0.2.0` without a development cachebuster.

## 3. Create the GitHub repository

Only after explicit approval:

```bash
gh repo create alexanderradahl/workflow-studio --source=. --remote=origin --push --public
```

Use `--private` instead of `--public` for a private rehearsal.

## 4. Verify GitHub marketplace installation

```bash
codex plugin marketplace add alexanderradahl/workflow-studio
codex plugin add workflow-studio@workflow-studio
```

Start a fresh Codex chat and verify explicit `$workflow-studio` invocation for both one substantial artifact and one bounded multi-file repository change. Confirm the multi-file run changes only the requested scopes and the dashboard renders its file-level evidence. Then verify an eligible implicit-routing example and an ineligible simple-edit example. If a crowded skill catalog prevents reliable implicit selection, repeat with the bounded `~/.codex/AGENTS.md` routing rule documented in the README and disclose that requirement in the release notes.

## 5. Tag and publish

Only after installation verification:

```bash
git tag -a v0.2.0 -m "Workflow Studio v0.2.0"
git push origin v0.2.0
gh release create v0.2.0 --generate-notes --title "Workflow Studio v0.2.0"
```

Rollback before publication by deleting the local tag. After publication, use a follow-up patch release rather than rewriting the published tag.
