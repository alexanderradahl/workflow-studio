export const meta = {
  name: "Change Workspace",
  description:
    "Plan, implement, review, repair, and verify a bounded multi-file local repository change with a Claude-style Codex workflow.",
  phases: [
    { title: "Discover", detail: "Independent read-only scouts map the repository, constraints, risks, and verification surface." },
    { title: "Plan", detail: "A typed read-only planner turns discovery into an explicit, scope-bound implementation plan." },
    { title: "Implement", detail: "One serialized workspace writer applies the approved change only inside the authorized scopes." },
    { title: "Review", detail: "Two independent read-only reviewers inspect the real workspace change from different lenses." },
    { title: "Repair", detail: "A serialized workspace writer applies only supported reviewer corrections when needed." },
    { title: "Verify", detail: "A final read-only verifier checks every changed path and the requested outcome." },
  ],
};

const MAX_TASK_LENGTH = 20_000;
const MAX_PATH_LENGTH = 1_024;
const MAX_WRITE_PATHS = 32;
const MAX_CONSTRAINTS = 20;
const MAX_CONSTRAINT_LENGTH = 2_000;
const MAX_SOURCE_CONTEXT_LENGTH = 50_000;
const MAX_RESULT_PATHS = 512;
const MAX_RESULT_PATH_LENGTH = 1_024;
const MAX_FINDINGS = 128;
const MAX_FINDING_LENGTH = 8_000;
const MAX_VERIFICATION_ITEMS = 64;
const MAX_VERIFICATION_LENGTH = 4_000;
const ALLOWED_ARGUMENTS = new Set([
  "task",
  "write_paths",
  "constraints",
  "source_context",
  "scouts",
  "baseline_status",
  "allow_research",
]);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

const findingArrayProperty = {
  type: "array",
  maxItems: MAX_FINDINGS,
  items: { type: "string", minLength: 1, maxLength: MAX_FINDING_LENGTH },
};

const baseReportProperties = {
  summary: { type: "string", minLength: 1, maxLength: 8_000 },
  recommended_actions: {
    type: "array",
    maxItems: MAX_FINDINGS,
    items: { type: "string", minLength: 1, maxLength: MAX_FINDING_LENGTH },
  },
  risks: { type: "array", maxItems: MAX_FINDINGS, items: { type: "string", minLength: 1, maxLength: MAX_FINDING_LENGTH } },
  verification: {
    type: "array",
    maxItems: MAX_VERIFICATION_ITEMS,
    items: { type: "string", minLength: 1, maxLength: MAX_VERIFICATION_LENGTH },
  },
  confidence: { type: "string", enum: ["low", "medium", "high"] },
};

const commonReportProperties = { ...baseReportProperties, findings: findingArrayProperty };
const executionReportProperties = { ...baseReportProperties, blocking_findings: findingArrayProperty };

const DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings", "recommended_actions", "risks", "verification", "confidence"],
  properties: commonReportProperties,
};

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "planned_paths",
    "acceptance_criteria",
    "validation",
    "findings",
    "recommended_actions",
    "risks",
    "verification",
    "confidence",
  ],
  properties: {
    ...commonReportProperties,
    planned_paths: { type: "array", minItems: 1, maxItems: MAX_RESULT_PATHS, items: { type: "string", minLength: 1, maxLength: MAX_RESULT_PATH_LENGTH } },
    acceptance_criteria: {
      type: "array",
      minItems: 1,
      maxItems: MAX_FINDINGS,
      items: { type: "string", minLength: 1, maxLength: MAX_FINDING_LENGTH },
    },
    validation: {
      type: "array",
      minItems: 1,
      maxItems: MAX_VERIFICATION_ITEMS,
      items: { type: "string", minLength: 1, maxLength: MAX_VERIFICATION_LENGTH },
    },
  },
};

const IMPLEMENTATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changed_paths", "blocking_findings", "recommended_actions", "risks", "verification", "confidence"],
  properties: {
    ...executionReportProperties,
    changed_paths: { type: "array", minItems: 1, maxItems: MAX_RESULT_PATHS, items: { type: "string", minLength: 1, maxLength: MAX_RESULT_PATH_LENGTH } },
  },
};

const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changed_paths", "blocking_findings", "recommended_actions", "risks", "verification", "confidence"],
  properties: {
    ...executionReportProperties,
    changed_paths: { type: "array", maxItems: MAX_RESULT_PATHS, items: { type: "string", minLength: 1, maxLength: MAX_RESULT_PATH_LENGTH } },
  },
};

const VERIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "verified_paths", "blocking_findings", "recommended_actions", "risks", "verification", "confidence"],
  properties: {
    ...executionReportProperties,
    verified_paths: { type: "array", maxItems: MAX_RESULT_PATHS, items: { type: "string", minLength: 1, maxLength: MAX_RESULT_PATH_LENGTH } },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character limit.`);
  return normalized;
}

function normalizeRelativePath(value, name, { maxLength = MAX_PATH_LENGTH } = {}) {
  const raw = requireString(value, name, maxLength).replaceAll("\\", "/");
  if (
    raw.includes("\0") ||
    raw.startsWith("/") ||
    raw.startsWith("~") ||
    /^[A-Za-z]:\//.test(raw) ||
    raw === "." ||
    raw === ".git" ||
    raw.startsWith(".git/")
  ) {
    throw new Error(`${name} must be a normalized relative path outside .git.`);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${name} must be a normalized relative path without empty or traversal components.`);
  }
  return raw;
}

function validateStringArray(value, name, { maxItems, maxItemLength, required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of strings.`);
  if (value.length > maxItems) throw new Error(`${name} may contain at most ${maxItems} items.`);
  return value.map((item, index) => requireString(item, `${name}[${index}]`, maxItemLength));
}

function validateWritePaths(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WRITE_PATHS) {
    throw new Error(`write_paths must contain between 1 and ${MAX_WRITE_PATHS} normalized relative paths.`);
  }
  const normalized = value.map((item, index) => normalizeRelativePath(item, `write_paths[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error("write_paths must not contain duplicates.");
  return normalized;
}

function validateArguments(value) {
  if (!isPlainObject(value)) throw new Error("Workflow arguments must be an object.");
  const unsupported = Object.keys(value).filter((key) => !ALLOWED_ARGUMENTS.has(key));
  if (unsupported.length) throw new Error(`Unsupported workflow argument(s): ${unsupported.join(", ")}.`);
  if (value.allow_research !== undefined && value.allow_research !== false) {
    throw new Error("allow_research must be false; network research is disabled for workspace workflows.");
  }

  const scouts = value.scouts === undefined ? 2 : value.scouts;
  if (!Number.isInteger(scouts) || scouts < 2 || scouts > 4) {
    throw new Error("scouts must be an integer from 2 through 4.");
  }

  return {
    task: requireString(value.task, "task", MAX_TASK_LENGTH),
    write_paths: validateWritePaths(value.write_paths),
    constraints: validateStringArray(value.constraints, "constraints", {
      maxItems: MAX_CONSTRAINTS,
      maxItemLength: MAX_CONSTRAINT_LENGTH,
      required: false,
    }),
    source_context:
      value.source_context === undefined
        ? "No additional source context was supplied."
        : requireString(value.source_context, "source_context", MAX_SOURCE_CONTEXT_LENGTH),
    baseline_status: validateStringArray(value.baseline_status, "baseline_status", {
      maxItems: 4_096,
      maxItemLength: 4_096,
      required: false,
    }),
    scouts,
  };
}

function isWithinWriteScope(candidate, writePaths) {
  return writePaths.some((scope) => candidate === scope || candidate.startsWith(`${scope}/`));
}

function validateResultPaths(value, name, writePaths, { required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of normalized relative paths.`);
  if (value.length > MAX_RESULT_PATHS) throw new Error(`${name} may contain at most ${MAX_RESULT_PATHS} paths.`);
  const paths = value.map((item, index) => normalizeRelativePath(item, `${name}[${index}]`, { maxLength: MAX_RESULT_PATH_LENGTH }));
  if (new Set(paths).size !== paths.length) throw new Error(`${name} must not contain duplicate paths.`);
  const outside = paths.filter((item) => !isWithinWriteScope(item, writePaths));
  if (outside.length) throw new Error(`${name} contains paths outside authorized write_paths: ${outside.join(", ")}.`);
  return paths;
}

function validateReport(
  value,
  label,
  writePaths,
  pathKey,
  { requirePaths = true, requireVerification = true, extraKeys = [], findingKey = "findings" } = {},
) {
  if (!isPlainObject(value)) throw new Error(`${label} did not return a structured object.`);
  const allowedKeys = new Set(["summary", findingKey, "recommended_actions", "risks", "verification", "confidence"]);
  if (pathKey) allowedKeys.add(pathKey);
  for (const key of extraKeys) allowedKeys.add(key);
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unsupported.length) throw new Error(`${label} returned unsupported field(s): ${unsupported.join(", ")}.`);
  const summary = requireString(value.summary, `${label}.summary`, 8_000);
  const findings = validateStringArray(value[findingKey], `${label}.${findingKey}`, {
    maxItems: MAX_FINDINGS,
    maxItemLength: MAX_FINDING_LENGTH,
  });
  const recommendedActions = validateStringArray(value.recommended_actions, `${label}.recommended_actions`, {
    maxItems: MAX_FINDINGS,
    maxItemLength: MAX_FINDING_LENGTH,
  });
  const risks = validateStringArray(value.risks, `${label}.risks`, {
    maxItems: MAX_FINDINGS,
    maxItemLength: MAX_FINDING_LENGTH,
  });
  const verification = validateStringArray(value.verification, `${label}.verification`, {
    maxItems: MAX_VERIFICATION_ITEMS,
    maxItemLength: MAX_VERIFICATION_LENGTH,
  });
  if (requireVerification && verification.length === 0) throw new Error(`${label}.verification must contain evidence.`);
  if (typeof value.confidence !== "string" || !CONFIDENCE_VALUES.has(value.confidence)) {
    throw new Error(`${label}.confidence must be one of low, medium, or high.`);
  }
  const paths = pathKey
    ? validateResultPaths(value[pathKey], `${label}.${pathKey}`, writePaths, { required: requirePaths })
    : [];
  const report = {
    summary,
    recommended_actions: recommendedActions,
    risks,
    verification,
    confidence: value.confidence,
  };
  report[findingKey] = findings;
  if (pathKey) report[pathKey] = paths;
  for (const key of extraKeys) report[key] = value[key];
  return report;
}

function validatePlanner(value, writePaths) {
  const report = validateReport(value, "planner", writePaths, "planned_paths", {
    requirePaths: true,
    extraKeys: ["acceptance_criteria", "validation"],
  });
  report.acceptance_criteria = validateStringArray(value.acceptance_criteria, "planner.acceptance_criteria", {
    maxItems: MAX_FINDINGS,
    maxItemLength: MAX_FINDING_LENGTH,
  });
  report.validation = validateStringArray(value.validation, "planner.validation", {
    maxItems: MAX_VERIFICATION_ITEMS,
    maxItemLength: MAX_VERIFICATION_LENGTH,
  });
  if (report.acceptance_criteria.length === 0) throw new Error("planner.acceptance_criteria must contain at least one criterion.");
  if (report.validation.length === 0) throw new Error("planner.validation must contain at least one check.");
  return report;
}

function samePathSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((item) => expected.has(item));
}

const workflowArgs = typeof args === "undefined" ? undefined : args;
const request = validateArguments(workflowArgs);
const workspace = "the current workspace";
const codexBin = "codex-lean";
const constraintText = request.constraints.length
  ? request.constraints.map((constraint, index) => `${index + 1}. ${constraint}`).join("\n")
  : "No extra constraints were supplied. Preserve the stated scope and do not infer external authority.";
const writePathText = request.write_paths.map((item, index) => `${index + 1}. ${item}`).join("\n");
const baselineStatusText = request.baseline_status.length
  ? request.baseline_status.map((entry, index) => `${index + 1}. ${entry}`).join("\n")
  : "No pre-existing repository status was supplied.";
const repositoryRules =
  "Load and follow the nearest applicable repository AGENTS.md or equivalent project instructions. " +
  "Those instructions govern the implementation; do not bypass them or invent replacements.";
const externalBoundary =
  "This is a local-only change. Do not browse the web or use network access, send messages, publish, deploy, " +
  "commit, push, or mutate any external system. Keep every write inside the authorized write_paths.";

phase("Discover");
log(`discovering a bounded workspace change with ${request.scouts} independent scouts`, {
  write_paths: request.write_paths,
  scouts: request.scouts,
});

const discoveryLenses = [
  {
    label: "requirements",
    prompt:
      "Translate the implementation request into concrete acceptance criteria. Identify ambiguities and safe assumptions, " +
      "and distinguish required behavior from tempting scope expansion. Inspect relevant local files only; do not edit.",
  },
  {
    label: "architecture",
    prompt:
      "Map the existing repository entry points, patterns, dependencies, tests, and likely files involved. Recommend the " +
      "smallest coherent implementation shape. Inspect only; do not edit or run external actions.",
  },
  {
    label: "risk",
    prompt:
      "Look for concrete correctness, compatibility, safety, permission, and migration risks in the requested change. " +
      "Call out repository instructions and files that must remain untouched. Inspect only; do not edit.",
  },
  {
    label: "verification",
    prompt:
      "Design focused verification for the requested change: meaningful tests, checks, fixtures, and observable evidence. " +
      "Prefer existing repository commands and direct checks. Inspect only; do not edit.",
  },
];

const discoveryResults = await parallel(
  discoveryLenses.slice(0, request.scouts).map(({ label, prompt }) => () =>
    agent(
      `${prompt}\n\n` +
        `Task: ${request.task}\nWorkspace: ${workspace}\nAuthorized write_paths:\n${writePathText}\n` +
        `Constraints:\n${constraintText}\nSource context:\n${request.source_context}\n` +
        `${repositoryRules}\n${externalBoundary}\n` +
        "Return JSON matching the supplied schema. Put concise, concrete observations in findings and no more than " +
        "eight findings. This worker is strictly read-only.",
      {
        label,
        model: "gpt-5.6-luna",
        reasoning_effort: "low",
        sandbox: "read-only",
        codex_bin: codexBin,
        schema: DISCOVERY_SCHEMA,
      },
    ),
  ),
);
const discoveries = discoveryResults.map((result, index) =>
  validateReport(result, discoveryLenses[index].label, request.write_paths, null, { requireVerification: true }),
);
if (discoveries.length !== request.scouts) {
  throw new Error(`Discovery failed closed: expected ${request.scouts} structured scout results, received ${discoveries.length}.`);
}

phase("Plan");
const planner = await agent(
  `Create one implementation-ready plan for the requested repository change. Resolve conflicts among the independent ` +
    `scouts, keep the scope narrow, and list every likely file or directory the implementation may touch in ` +
    `planned_paths. Every planned path must be inside the authorized write_paths. Include concrete acceptance criteria ` +
    `and focused verification. You are read-only: do not modify files, do not treat the lack of write access as a blocker.\n\n` +
    `Task: ${request.task}\nWorkspace: ${workspace}\nAuthorized write_paths:\n${writePathText}\n` +
    `Constraints:\n${constraintText}\nSource context:\n${request.source_context}\n` +
    `Pre-existing repository status (do not count these paths as your change unless you modify them):\n${baselineStatusText}\n` +
    `${repositoryRules}\n${externalBoundary}\n\n` +
    `Independent discovery results:\n${JSON.stringify(discoveries, null, 2)}\n\nReturn JSON matching the supplied schema.`,
  {
    label: "planner",
    model: "gpt-5.6-terra",
    reasoning_effort: "medium",
    sandbox: "read-only",
    codex_bin: codexBin,
    schema: PLANNER_SCHEMA,
  },
);
const plan = validatePlanner(planner, request.write_paths);

phase("Implement");
const implementation = await agent(
  `Implement the approved repository change in the current shared workspace. You may write only files inside these ` +
    `authorized write_paths:\n${writePathText}\nDo not create or modify anything outside them, including temporary ` +
    `repository files. Preserve all applicable repository instructions. Do not commit or push. Do not send, publish, ` +
    `deploy, browse, or use network access. Read local source and tests as needed. Run focused checks that directly ` +
    `support the brief, and report every file actually added, modified, deleted, or mode-changed in changed_paths. ` +
    `Return JSON matching the supplied schema. Put ordinary change details in summary and verification. ` +
    `blocking_findings must be empty unless a write or required validation actually failed.\n\n` +
    `Task: ${request.task}\nWorkspace: ${workspace}\nConstraints:\n${constraintText}\nSource context:\n${request.source_context}\n` +
    `Pre-existing repository status (do not count these paths as your change unless you modify them):\n${baselineStatusText}\n` +
    `${repositoryRules}\n${externalBoundary}\n\nApproved plan:\n${JSON.stringify(plan, null, 2)}`,
  {
    label: "implementer",
    model: "gpt-5.6-sol",
    reasoning_effort: "medium",
    sandbox: "workspace-write",
    codex_bin: codexBin,
    schema: IMPLEMENTATION_SCHEMA,
  },
);
const implementationReport = validateReport(implementation, "implementer", request.write_paths, "changed_paths", {
  requirePaths: true,
  findingKey: "blocking_findings",
});
if (implementationReport.blocking_findings.length > 0 || implementationReport.verification.length === 0) {
  throw new Error("The implementation worker returned blocking findings or incomplete verification evidence.");
}

phase("Review");
const reviewLenses = [
  {
    label: "requirements-reviewer",
    prompt:
      "Inspect the real workspace change against the original task, constraints, repository rules, and approved plan. " +
      "Report only actionable gaps or errors in findings; use an empty findings array when the change is ready.",
  },
  {
    label: "quality-reviewer",
    prompt:
      "Inspect the real workspace change for internal correctness, regressions, compatibility, tests, and maintainability. " +
      "Report only concrete, fixable issues in findings; use an empty findings array when the change is ready.",
  },
];
const reviews = await parallel(
  reviewLenses.map(({ label, prompt }) => () =>
    agent(
      `${prompt}\n\nTask: ${request.task}\nWorkspace: ${workspace}\nAuthorized write_paths:\n${writePathText}\n` +
        `Constraints:\n${constraintText}\nSource context:\n${request.source_context}\n${repositoryRules}\n${externalBoundary}\n` +
        `Inspect all relevant changed files directly but do not edit anything. Do not run repository-wide or Git ` +
        `mutations. Review only this requested change.\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n` +
        `Implementation report:\n${JSON.stringify(implementationReport, null, 2)}\n\nReturn JSON matching the supplied schema.`,
      {
        label,
        model: "gpt-5.6-luna",
        reasoning_effort: "low",
        sandbox: "read-only",
        codex_bin: codexBin,
        schema: DISCOVERY_SCHEMA,
      },
    ),
  ),
);
const validReviews = reviews.map((result, index) =>
  validateReport(result, reviewLenses[index].label, request.write_paths, null, { requireVerification: true }),
);
if (validReviews.length !== reviewLenses.length) {
  throw new Error(`Review failed closed: expected ${reviewLenses.length} structured reviewer results, received ${validReviews.length}.`);
}
const reviewFindings = validReviews.flatMap((review, index) =>
  review.findings.map((finding) => `${reviewLenses[index].label}: ${finding}`),
);
log(`review produced ${reviewFindings.length} actionable finding(s)`, {
  valid_reviews: validReviews.length,
  findings: reviewFindings.length,
});

phase("Repair");
let repairReport = {
  summary: "No repair pass was needed because both reviewers returned no actionable findings.",
  changed_paths: [],
  blocking_findings: [],
  recommended_actions: [],
  risks: [],
  verification: ["Both read-only reviewers returned empty findings; no repair worker was started."],
  confidence: "high",
};
if (reviewFindings.length > 0) {
  const repair = await agent(
    `Re-open the real workspace change and assess every review finding below against the task, constraints, plan, and ` +
      `repository rules. Apply only corrections supported by the brief or observable files, and write only inside ` +
      `authorized write_paths:\n${writePathText}\nDo not expand scope. Do not commit, push, send, publish, deploy, browse, ` +
      `or use network access. Re-run focused checks, report every path you changed in changed_paths, and put any actual ` +
      `actual write or required-validation failure in blocking_findings. Put ordinary correction details in summary ` +
      `and verification. Return JSON matching the supplied schema.\n\n` +
      `Task: ${request.task}\nWorkspace: ${workspace}\nConstraints:\n${constraintText}\nSource context:\n${request.source_context}\n` +
      `${repositoryRules}\n${externalBoundary}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n` +
      `Implementation report:\n${JSON.stringify(implementationReport, null, 2)}\n\nReview findings:\n` +
      reviewFindings.map((finding, index) => `${index + 1}. ${finding}`).join("\n"),
    {
      label: "repairer",
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
      sandbox: "workspace-write",
      codex_bin: codexBin,
      schema: REPAIR_SCHEMA,
    },
  );
  repairReport = validateReport(repair, "repairer", request.write_paths, "changed_paths", {
    requirePaths: false,
    findingKey: "blocking_findings",
  });
  if (repairReport.blocking_findings.length > 0 || repairReport.verification.length === 0) {
    throw new Error("The repair worker returned blocking findings or incomplete verification evidence.");
  }
}

const changedPaths = [...new Set([...implementationReport.changed_paths, ...repairReport.changed_paths])];
if (changedPaths.length === 0) throw new Error("The workspace workflow produced no changed paths; acceptance is blocked.");

phase("Verify");
const verification = await agent(
  `Perform a final read-only acceptance check of the real shared workspace change. Inspect every path in the observed ` +
    `workflow change set below, confirm each remains inside authorized write_paths, and run direct focused checks for ` +
    `the requested outcome. Return verified_paths containing exactly every changed path listed below, with no extras or ` +
    `omissions. Put any blocking issue in blocking_findings; otherwise return an empty blocking_findings array and ` +
    `concrete evidence in verification. Do not edit files. Do not commit, push, send, publish, deploy, browse, or use ` +
    `network access.\n\n` +
    `Task: ${request.task}\nWorkspace: ${workspace}\nAuthorized write_paths:\n${writePathText}\nConstraints:\n${constraintText}\n` +
    `Source context:\n${request.source_context}\n${repositoryRules}\n${externalBoundary}\n\n` +
    `Planned paths:\n${JSON.stringify(plan.planned_paths)}\nChanged paths to verify:\n${JSON.stringify(changedPaths)}\n` +
    `Implementation report:\n${JSON.stringify(implementationReport, null, 2)}\nRepair report:\n${JSON.stringify(repairReport, null, 2)}\n` +
    `Review findings:\n${JSON.stringify(reviewFindings, null, 2)}\n\nReturn JSON matching the supplied schema.`,
  {
    label: "final-verifier",
    model: "gpt-5.6-luna",
    reasoning_effort: "low",
    sandbox: "read-only",
    codex_bin: codexBin,
    schema: VERIFIER_SCHEMA,
  },
);
const finalVerification = validateReport(verification, "final-verifier", request.write_paths, "verified_paths", {
  requirePaths: true,
  findingKey: "blocking_findings",
});
if (finalVerification.blocking_findings.length > 0) {
  throw new Error(`Final verification blocked acceptance: ${finalVerification.blocking_findings.join(" | ")}`);
}
if (!samePathSet(finalVerification.verified_paths, changedPaths)) {
  throw new Error("Final verification did not cover exactly every changed path reported by the writable workers.");
}

export default {
  accepted: true,
  task: request.task,
  write_paths: request.write_paths,
  planned_paths: plan.planned_paths,
  changed_paths: changedPaths,
  verified_paths: finalVerification.verified_paths,
  framing_workers_completed: discoveries.length,
  reviewers_completed: validReviews.length,
  review_findings: reviewFindings,
  implementation_report: implementationReport,
  repair_report: repairReport,
  final_verification: finalVerification,
};
