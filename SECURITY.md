# Security policy

Supported release line: **0.2.x**.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/alexanderradahl/workflow-studio/security/advisories/new). Do not put exploit details, credentials, or private workflow journals in public issues.

Relevant reports include writes outside requested scopes, Git metadata mutation, path-validation failures, sandbox escape, unintended command networking, credential exposure, and misleading acceptance evidence.

Workflow Studio launches local Codex workers and relies on Codex's operating-system sandbox for filesystem and command-network enforcement. Host snapshots and structured report checks add independent acceptance evidence; they are not a substitute for the sandbox. Model-provider requests still use Codex authentication. Run journals and prompts remain in the local Codex data directory and can contain sensitive task context.

Writable work remains local and scoped. Failed runs may leave partial changes and are never presented as rolled back. Install plugins and dependencies only from sources you trust.
