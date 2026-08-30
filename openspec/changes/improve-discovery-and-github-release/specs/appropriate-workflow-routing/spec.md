## ADDED Requirements

### Requirement: Select Workflow Studio only for eligible artifact work
Codex SHALL implicitly select Workflow Studio only when the user requests creation of one local artifact and independent framing, planning, review, repair, and verification materially improve the result.

#### Scenario: Substantial single-artifact request
- **WHEN** the user asks Codex to create one substantial local document or artifact that benefits from independent review
- **THEN** Codex selects Workflow Studio and gathers the fixed run inputs before calling the writable tool

#### Scenario: Simple or multi-file work
- **WHEN** the request is a simple edit, direct answer, read-only analysis, command-only task, multi-file implementation, or external action
- **THEN** Codex does not select Workflow Studio implicitly and uses the ordinary owning workflow instead

### Requirement: Preserve explicit invocation without inferring write authority
Codex SHALL recognize `$workflow-studio` as explicit plugin intent but MUST NOT launch a writable workflow unless the user also requests creation of a concrete local artifact.

#### Scenario: Explicit creation request
- **WHEN** the user invokes `$workflow-studio` with a concrete artifact brief and valid destination context
- **THEN** Codex routes the request to `run_build_artifact`

#### Scenario: Explicit capability question
- **WHEN** the user invokes `$workflow-studio` only to ask what it does or to inspect status
- **THEN** Codex explains the capability or uses a read-only dashboard tool without creating a file

### Requirement: Use a discriminating fallback
Codex SHALL prefer ordinary execution when Workflow Studio eligibility is ambiguous.

#### Scenario: Borderline request
- **WHEN** Codex cannot establish that the request is one substantial writable artifact benefiting from independent review
- **THEN** Codex keeps the request on the normal path or asks for the smallest missing detail rather than silently launching the workflow

### Requirement: Support crowded Codex profiles without automatic global mutation
The release SHALL document a bounded global routing hint for users whose installed Skill catalog makes implicit discovery unreliable, and the plugin SHALL NOT edit global Codex instructions during installation.

#### Scenario: User opts into reliable local routing
- **WHEN** a user adds the documented rule to `~/.codex/AGENTS.md`
- **THEN** fresh Codex chats consider `$workflow-studio` for eligible single-artifact work and retain the same explicit exclusions

#### Scenario: Plugin installation
- **WHEN** Workflow Studio is installed from a marketplace
- **THEN** installation does not change the user's global Codex instructions
