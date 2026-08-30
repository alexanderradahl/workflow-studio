## ADDED Requirements

### Requirement: Conversational workflow discovery
The plugin SHALL provide a discoverable Skill named `workflow-studio` that can be invoked explicitly with `$workflow-studio` and selected implicitly for requests to run or inspect the guarded artifact workflow.

#### Scenario: Explicit invocation
- **WHEN** the user asks `$workflow-studio` to create an artifact
- **THEN** Codex routes the request through the plugin's fixed workflow tool rather than reconstructing a shell command in chat

#### Scenario: Natural-language invocation
- **WHEN** the user asks to run or show Workflow Studio without naming the Skill token
- **THEN** the Skill provides the current tool and safety contract to Codex

### Requirement: Fixed guarded execution
The MCP server MUST expose a fixed `run_build_artifact` operation that accepts only the task, workspace, relative output path, artifact type, constraints, source context, and bounded scout count.

#### Scenario: Valid workflow run
- **WHEN** the user supplies a valid existing workspace and normalized relative output path
- **THEN** the server launches the bundled workflow with fixed Ultracode controls and returns its journal-derived accepted or blocked result

#### Scenario: Invalid output path
- **WHEN** the output path is absolute, traverses a parent, targets a symbolic or hard link, or has a missing parent directory
- **THEN** the operation fails before launching a writable worker

### Requirement: Least-privilege subprocesses
The plugin MUST preserve the workflow's native permission profiles so all worker command networking is disabled, read-only workers cannot modify the workspace, and writable workers can modify only the exact output file.

#### Scenario: Unauthorized write attempt
- **WHEN** a worker attempts to modify another workspace path
- **THEN** the sandbox rejects the operation and the workflow cannot return accepted

#### Scenario: Network attempt
- **WHEN** any workflow worker attempts outbound command networking
- **THEN** the permission profile blocks the attempt

### Requirement: Deterministic final acceptance
The tool MUST locate the matching run journal, require structured worker evidence, and independently verify a non-empty, non-linked regular output file inside the workspace before reporting success.

#### Scenario: Accepted result
- **WHEN** the journal reports accepted, all required workers completed, and the output passes the no-follow file check
- **THEN** the tool returns `accepted: true` with run id, output path, review findings, duration, and usage

#### Scenario: Missing journal or output
- **WHEN** the subprocess exits without a matching journal or valid output
- **THEN** the tool returns a blocking error and does not fabricate success

### Requirement: Read-only inspection
The MCP server SHALL expose read-only operations for showing the latest workflow dashboard and retrieving a named run without launching a new workflow.

#### Scenario: Existing run inspection
- **WHEN** the user requests a known workflow run id
- **THEN** the server returns normalized journal state without modifying files

#### Scenario: No prior runs
- **WHEN** the user opens Workflow Studio before any matching run exists
- **THEN** the server returns a ready-state dashboard with the available phases and invocation guidance
