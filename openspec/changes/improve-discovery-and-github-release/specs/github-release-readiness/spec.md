## ADDED Requirements

### Requirement: Repository includes public usage and contribution documentation
The project SHALL include a README with purpose, eligibility boundaries, installation, usage, architecture, safety, development, and post-publish release instructions, plus contribution, security, changelog, and release-checklist documents.

#### Scenario: GitHub visitor evaluates the plugin
- **WHEN** a user opens the repository
- **THEN** they can determine what Workflow Studio does, when to use it, how to install it after publication, and how to validate changes

### Requirement: Repository exposes a Codex marketplace manifest
The project SHALL include `.agents/plugins/marketplace.json` that identifies the Workflow Studio marketplace and references the intended GitHub plugin source.

#### Scenario: Marketplace repository is published
- **WHEN** the repository becomes available at the documented GitHub location
- **THEN** Codex can add the marketplace and discover the `workflow-studio` plugin through its repository manifest

### Requirement: Portable CI validates release invariants
The repository MUST include GitHub CI and a repository-owned validation command that builds the widget, runs tests, and verifies release-critical manifests and assets without depending on user-local Codex skill paths.

#### Scenario: Pull request changes plugin files
- **WHEN** GitHub Actions runs on a push or pull request
- **THEN** CI installs locked dependencies and fails if tests or release invariants fail

### Requirement: Publication remains deliberate
Release preparation MUST NOT create a GitHub repository, push commits, choose a license, tag a release, or publish an asset without a separate explicit user request.

#### Scenario: Local preparation completes
- **WHEN** all local release checks pass
- **THEN** the project is left as a reviewed local git repository with the remaining license and publication choices documented
