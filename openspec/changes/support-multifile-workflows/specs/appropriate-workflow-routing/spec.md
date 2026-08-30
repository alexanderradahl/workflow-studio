## MODIFIED Requirements

### Requirement: Select Workflow Studio only for eligible substantial workflow work
Codex SHALL implicitly select Workflow Studio when the user explicitly requests either one substantial local artifact or a substantial multi-file repository change and independent framing, planning, review, repair, and verification materially improve the result.

#### Scenario: Substantial single-artifact request
- **WHEN** the user asks Codex to create one substantial local document or artifact that benefits from independent review
- **THEN** Codex selects Workflow Studio and routes the request to `run_build_artifact`

#### Scenario: Substantial multi-file repository request
- **WHEN** the user asks Codex to implement a non-trivial feature, refactor, or migration across multiple local repository files and provides or permits a bounded write scope
- **THEN** Codex selects Workflow Studio and routes the request to `run_workspace_workflow`

#### Scenario: Ineligible work
- **WHEN** the request is a simple edit, direct answer, read-only analysis, command-only task, status check, or external action
- **THEN** Codex does not select Workflow Studio implicitly and uses the ordinary owning workflow instead

### Requirement: Preserve explicit invocation without inferring write authority
Codex SHALL recognize `$workflow-studio` as explicit plugin intent but MUST NOT launch a writable workflow unless the user also requests a concrete local creation or implementation outcome.

#### Scenario: Explicit single-file creation request
- **WHEN** the user invokes `$workflow-studio` with a concrete one-file artifact brief and valid destination context
- **THEN** Codex routes the request to `run_build_artifact`

#### Scenario: Explicit multi-file implementation request
- **WHEN** the user invokes `$workflow-studio` with a concrete repository change and valid write scopes
- **THEN** Codex routes the request to `run_workspace_workflow`

#### Scenario: Explicit capability question
- **WHEN** the user invokes `$workflow-studio` only to ask what it does or inspect status
- **THEN** Codex explains the capability or uses a read-only dashboard tool without creating or modifying files

### Requirement: Use a discriminating fallback
Codex SHALL prefer ordinary execution when Workflow Studio eligibility or write scope is ambiguous.

#### Scenario: Borderline request
- **WHEN** Codex cannot establish a substantial writable result that benefits from independent multi-agent review or cannot establish bounded write scopes
- **THEN** Codex keeps the request on the normal path or asks for the smallest missing detail rather than silently launching the workflow

### Requirement: Support crowded Codex profiles without automatic global mutation
The release SHALL document a bounded global routing hint for users whose installed Skill catalog makes implicit discovery unreliable, and the plugin SHALL NOT edit global Codex instructions during installation.

#### Scenario: User opts into reliable local routing
- **WHEN** a user adds the documented rule to `~/.codex/AGENTS.md`
- **THEN** fresh Codex chats consider `$workflow-studio` for eligible single-file and multi-file work and retain the explicit exclusions

#### Scenario: Plugin installation
- **WHEN** Workflow Studio is installed from a marketplace
- **THEN** installation does not change the user's global Codex instructions
