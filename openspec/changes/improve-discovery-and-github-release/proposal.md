## Why

Workflow Studio is installed and callable, but its current Skill description does not clearly distinguish when a multi-agent single-artifact workflow is worth using versus when ordinary Codex execution is simpler. The source also lacks the repository metadata, CI, marketplace entry, and release documentation needed for a deliberate public GitHub release.

## What Changes

- Add an explicit eligibility gate for implicit Workflow Studio selection, including positive triggers and clear non-goals.
- Add a bounded, opt-in global Codex routing fallback for profiles whose large skill catalog makes implicit discovery unreliable.
- Align Skill UI metadata, plugin copy, starter prompts, and MCP tool descriptions with that routing boundary.
- Add a public-repository README, contribution/security guidance, changelog, GitHub CI, and a repository marketplace manifest.
- Add deterministic release validation and packaging commands without publishing a GitHub repository or selecting a license.
- Initialize a local Git repository on `main` after release checks pass.

## Capabilities

### New Capabilities

- `appropriate-workflow-routing`: Defines when Codex should implicitly select Workflow Studio and when it must use ordinary execution instead.
- `github-release-readiness`: Defines the repository, CI, marketplace, documentation, and packaging state required before a public GitHub release.

### Modified Capabilities

None.

## Impact

Affected areas include the Workflow Studio Skill and UI metadata, plugin manifest and MCP descriptions, package scripts, repository documentation, GitHub Actions configuration, marketplace metadata, release-validation scripts, the current user's global Codex routing instructions, and local git metadata. Runtime workflow permissions and the accepted artifact execution contract remain unchanged.
