## ADDED Requirements

### Requirement: Inline workflow visualization
Each dashboard-capable tool SHALL reference a versioned MCP App resource that renders workflow state inline when the host supports MCP Apps.

#### Scenario: Completed run
- **WHEN** a tool returns a completed workflow run
- **THEN** the widget displays overall status, acceptance, ordered phases, output path, review finding count, duration, and token usage

#### Scenario: Ready or failed state
- **WHEN** no run exists or a run failed before producing an accepted artifact
- **THEN** the widget renders an explicit ready or failed state without implying success

### Requirement: Accessible host-native presentation
The widget MUST use a transparent background, host style variables, light and dark themes, semantic status text, keyboard-accessible controls, and automatic height resizing.

#### Scenario: Theme change
- **WHEN** the host switches between light and dark themes
- **THEN** the widget updates its theme without losing readable contrast

#### Scenario: Variable content height
- **WHEN** findings or phase details change the rendered height
- **THEN** the widget asks the host to resize automatically rather than clipping content

### Requirement: Safe widget actions
Widget controls MUST send visible conversational messages for follow-up actions and MUST NOT directly launch a writable workflow without a new user-visible request.

#### Scenario: Run another workflow
- **WHEN** the user clicks the run-again action
- **THEN** the widget sends a user message asking Codex to gather or use a workflow brief

#### Scenario: Open output request
- **WHEN** the user clicks the output action
- **THEN** the widget sends a user message asking Codex to open the local artifact

### Requirement: Structured fallback
Every dashboard-capable tool MUST return meaningful text and structured content independently of the widget.

#### Scenario: Host without MCP Apps
- **WHEN** the host ignores the UI resource metadata
- **THEN** the conversation still receives an accurate text summary and machine-readable workflow state

### Requirement: Self-contained UI resource
The widget MUST inline its Apps bridge and all styling, declare no external resource or connection domains, and avoid direct navigation or arbitrary network access.

#### Scenario: Resource read
- **WHEN** the host requests the widget resource
- **THEN** the server returns `text/html;profile=mcp-app` content with no external script, stylesheet, font, or image dependencies
