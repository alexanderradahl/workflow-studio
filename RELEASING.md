# Releasing Workflow Studio

The public repository is `alexanderradahl/workflow-studio`. Choose a license deliberately for new contributions; this project is distributed under MIT.

## Preflight

1. Update the version in `package.json`, `package-lock.json`, and `.codex-plugin/plugin.json` together. Update the changelog.
2. Run `npm ci` and `npm run check`. Confirm `git diff --check` passes and generated widget output is current.
3. Verify a live single-file run and a bounded multi-file run with the release code. For worker or sandbox changes, use a linked Git worktree and real test tooling. Record accepted run IDs and actual file/test results in the release notes; do not publish task prompts, private paths, or raw journals.
4. Review the tracked tree and history for credentials, private customer data, machine-specific paths, and unlicensed assets.
5. Keep local caches, smoke artifacts, and run journals out of the repository. Never publish a development cachebuster as a release.

## Publish an authorized release

```bash
git push origin main
git tag -a v<VERSION> -m "Workflow Studio v<VERSION>"
git push origin v<VERSION>
gh release create v<VERSION> --title "Workflow Studio v<VERSION>" --notes-file release-notes.md
```

Store the notes file outside the tracked tree or remove it after release. Wait for the exact release commit's GitHub Actions run to pass.

## Verify installation

```bash
codex plugin marketplace add alexanderradahl/workflow-studio
codex plugin add workflow-studio@workflow-studio
```

Start a new Codex chat and confirm both fixed workflows are available. Check the installed manifest version and bundled source against the release. Do not treat installation as proof that an already-running MCP server reloaded.

Fix a published mistake in a follow-up release; do not rewrite published tags.
