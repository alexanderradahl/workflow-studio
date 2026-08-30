## MODIFIED Requirements

### Requirement: Inline workflow visualization
Each dashboard-capable tool SHALL reference a versioned MCP App resource that renders single-file or multi-file workflow state inline when the host supports MCP Apps.

#### Scenario: Completed multi-file run
- **WHEN** a tool returns a completed workspace workflow run
- **THEN** the widget displays overall status, acceptance, ordered phases, authorized scopes, planned/changed/verified files, review finding count, duration, and token usage

#### Scenario: Completed legacy artifact run
- **WHEN** a tool returns a single-file artifact run without the v2 file collection
- **THEN** the widget preserves the output path and renders it as one compatible planned, changed, and verified file when acceptance evidence supports that state

#### Scenario: Ready or failed state
- **WHEN** no run exists or a run fails before final acceptance
- **THEN** the widget renders an explicit ready or failed state and any observed changed files without implying verification or success

### Requirement: Safe widget actions
Widget controls MUST send visible conversational messages for follow-up actions and MUST NOT directly launch a writable workflow without a new user-visible request.

#### Scenario: Run another workflow
- **WHEN** the user clicks the run-again action
- **THEN** the widget sends a user message asking Codex to gather or use a workflow brief and appropriate write scope

#### Scenario: Open one output
- **WHEN** the run contains exactly one output file and the user clicks the output action
- **THEN** the widget sends a user message asking Codex to open that local file

#### Scenario: Inspect multiple changes
- **WHEN** the run contains multiple changed files and the user clicks the changes action
- **THEN** the widget sends a user message asking Codex to inspect the visible workspace changes for that run

### Requirement: Structured fallback
Every dashboard-capable tool MUST return meaningful text and structured content independently of the widget, including backward-compatible single-output fields and bounded multi-file evidence.

#### Scenario: Host without MCP Apps
- **WHEN** the host ignores the UI resource metadata
- **THEN** the conversation still receives an accurate text summary and machine-readable workflow state with file counts and paths
