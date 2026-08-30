## Context

Workflow Studio already ships an implicitly invokable Skill, three local MCP tools, and an inline MCP App. Its selection text currently emphasizes explicit workflow language rather than the underlying decision: whether one substantial local artifact merits independent framing, planning, build, review, repair, and verification. Fresh-chat testing also showed that a crowded installed-skill catalog can shorten discovery descriptions enough for another domain Skill to win routing. The plugin source is not a git repository and has no public README, CI, repository marketplace manifest, or release checklist.

The public release target is `github.com/alexanderradahl/workflow-studio`, which does not exist yet. Publishing, selecting an open-source license, and creating the remote repository remain deliberate follow-up actions.

## Goals / Non-Goals

**Goals:**

- Make implicit invocation selective, useful, and legible to Codex.
- Provide a reliable opt-in local awareness fallback without silently modifying other users' global instructions.
- Keep ordinary/simple work on the normal Codex path.
- Prepare a clean `v0.1.1` repository with documentation, CI, marketplace metadata, and deterministic release validation.
- Preserve the current guarded runtime and visual dashboard behavior.
- Leave the local project in a reviewed git repository on `main`.

**Non-Goals:**

- Publish or push a GitHub repository.
- Choose a license or claim the project is open source.
- Generalize Workflow Studio to arbitrary workflows, multi-file coding, remote execution, deployment, or external actions.
- Add new runtime dependencies or change the worker permission model.

## Decisions

### Put primary automatic-selection judgment in the Skill

The Skill frontmatter will carry a concise positive trigger and negative boundary, while the body will define an eligibility gate. The gate requires an explicit create/write request for one local artifact whose quality materially benefits from independent review. Borderline requests remain on ordinary Codex execution.

Fresh-chat validation showed that Skill discovery alone is not reliable on this machine when the installed catalog exceeds the available description budget. The current user's `~/.codex/AGENTS.md` will therefore receive the same bounded eligibility rule, and the README will document it as an opt-in fallback for other users. The plugin will not edit global instructions automatically during installation.

Alternative considered: add a global rule that always prefers Workflow Studio. Rejected because it would over-apply the workflow. The chosen fallback repeats both the positive conditions and the explicit exclusions.

### Align all discovery surfaces

The plugin manifest, starter prompts, Skill UI metadata, MCP tool description, and server instructions will describe the same eligibility boundary. `allow_implicit_invocation` remains true, and explicit `$workflow-studio` invocation remains supported.

Alternative considered: add another routing Skill. Rejected because one focused Skill can express the decision without another layer.

### Publish as a root plugin with a repository marketplace

The repository will remain the plugin root. Its marketplace manifest will reference the future GitHub repository URL as a URL-sourced plugin, avoiding a disruptive `plugins/workflow-studio` directory migration.

Alternative considered: restructure the repository into a multi-plugin marketplace layout. Rejected because this release contains one plugin and the move would create duplicated or deeply nested source paths without improving runtime behavior.

### Keep release automation minimal

GitHub CI will run the existing build/tests plus a deterministic release validator. A release checklist will document the future `gh repo create`, install verification, tag, and `gh release create` commands. No tag-triggered publishing workflow will be added before the user deliberately creates the remote and selects a license.

Alternative considered: automatically publish releases on tags. Rejected because that would make a future tag an external publication action before repository policy is settled.

### Use a clean release version

The public-preparation version will be `0.1.1`, replacing the local development cachebuster. The personal marketplace will be reinstalled from that version so source and installed state match.

## Risks / Trade-offs

- **Implicit selection becomes too broad** → Require all eligibility conditions and state explicit exclusions in frontmatter and body.
- **A crowded Skill catalog hides the plugin's discovery text** → Keep explicit `$workflow-studio` invocation as the portable baseline and document a bounded global routing hint for users who want reliable local automatic selection.
- **The future repository URL is not live yet** → Label install commands as post-publish steps and validate only their deterministic shape locally.
- **No license is selected** → Keep license metadata absent and make license choice a named pre-publication checklist item.
- **CI cannot use local Codex plugin validators** → Keep local validator checks in the development handoff and add a repository-owned validator for portable CI invariants.
- **Generated smoke artifacts leak into the release** → Ignore local smoke/preview outputs while committing only the runtime widget and curated screenshot.

## Migration Plan

1. Update discovery text and release metadata.
2. Run unit, MCP, Skill, plugin, and release validation.
3. Reinstall `workflow-studio@personal` at version `0.1.1`, add the bounded local awareness rule, and forward-test fresh-chat routing.
4. Initialize the local git repository on `main`, review tracked files, and create a local release-preparation commit if git identity is available.
5. Later, after the user selects a license, create and push `alexanderradahl/workflow-studio`, verify marketplace installation from GitHub, then tag and publish `v0.1.1`.

## Open Questions

- Which license, if any, should govern the public repository?
- Should the eventual GitHub repository be public immediately or start private for an installation rehearsal?
