## ADDED Requirements

### Requirement: Run a fixed multi-file workspace workflow
Workflow Studio SHALL expose one schema-bound writable tool that launches only the bundled trusted workspace-change workflow from its exact plugin-local source path.

#### Scenario: Authorized repository change
- **WHEN** Codex has an explicit substantial implementation request, an absolute canonical Git worktree root, and valid relative write scopes
- **THEN** the tool launches the bundled multi-file workflow and returns its trusted journal state

#### Scenario: Arbitrary execution input
- **WHEN** a caller supplies a workflow path, command, binary, flags, environment variable, model override, networking option, or another unsupported argument
- **THEN** the tool rejects the request before launching a child process

### Requirement: Enforce bounded repository write scopes
The workspace workflow MUST grant writable workers access only to 1–32 validated relative file or directory scopes inside the canonical Git worktree, while keeping the rest of the workspace read-only and worker networking disabled.

#### Scenario: Multiple authorized scopes
- **WHEN** a request authorizes several safe files or directories
- **THEN** the implementation and repair workers can modify descendants of those scopes and cannot modify sibling or parent paths

#### Scenario: Unsafe scope
- **WHEN** a scope is absolute, traversing, the workspace root, `.git`, outside the worktree, symlinked, hard-linked as an exact file, or missing a safe existing parent
- **THEN** the tool fails before any workflow worker starts

### Requirement: Preserve repository instructions and external-effect boundaries
Workspace workflow workers SHALL load applicable repository instructions, MUST run with command networking disabled, and MUST NOT commit, push, deploy, publish, send, or mutate external systems.

#### Scenario: Repository AGENTS instructions exist
- **WHEN** workers run inside a repository containing applicable `AGENTS.md` instructions
- **THEN** the workers receive those instructions instead of bypassing them

#### Scenario: Task requires an external action
- **WHEN** the requested outcome requires authority outside local workspace changes
- **THEN** the workflow stops at a local reviewable result or fails rather than performing the external action

### Requirement: Prove the observed changed-file set
The host runtime MUST compute deterministic pre/post repository and authorized-scope snapshots, reject observed changes outside the requested scopes, and require the workflow-reported and final-verified path sets to match the observed final delta before acceptance.

#### Scenario: Clean multi-file completion
- **WHEN** the workflow changes two or more files inside authorized scopes, all required workers complete, reviewers have no unresolved findings, and final verification covers every observed file
- **THEN** the run is accepted with persisted added, modified, deleted, or mode-changed file evidence

#### Scenario: Outside-scope or unverified change
- **WHEN** any tracked, untracked, or ignored file changes outside the authorized scopes, or any observed changed file is missing from writer or verifier evidence
- **THEN** the run is rejected and the dashboard identifies the blocking file evidence

### Requirement: Preserve the single-file workflow
The existing exact-path artifact tool SHALL remain available and SHALL retain its one-file permission and verification contract.

#### Scenario: Single artifact request
- **WHEN** Codex receives an eligible substantial request whose intended result is one file
- **THEN** Codex can continue to use `run_build_artifact` without granting multi-file workspace write access
