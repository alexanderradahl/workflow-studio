import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { resolveCodexBinary, resolveUltracodeCli } from "./runtime-dependencies.mjs";
import {
  assertGuardedWorkspaceLocation,
  compareWorkspaceSnapshots,
  pathWithinWritePaths,
  resolveGuardedWorkspace,
  snapshotWorkspace,
  validateWorkspaceRunArguments,
} from "./workspace-guard.mjs";

export {
  compareWorkspaceSnapshots,
  pathWithinWritePaths,
  resolveGuardedWorkspace,
  snapshotWorkspace,
  validateWorkspaceRunArguments,
} from "./workspace-guard.mjs";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(srcDir, "..");
export const WORKFLOW_SOURCE_PATH = path.join(PLUGIN_ROOT, "workflows", "build-artifact.js");
export const WORKSPACE_WORKFLOW_SOURCE_PATH = path.join(PLUGIN_ROOT, "workflows", "change-workspace.js");
export const WORKER_RUNNER_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-lean");
export const DEFAULT_PHASES = [
  { title: "Frame", detail: "Independent workers turn the brief into complementary build guidance." },
  { title: "Plan", detail: "A planner combines the strongest guidance into explicit acceptance criteria." },
  { title: "Build", detail: "One writable worker creates the requested artifact in the current workspace." },
  { title: "Review", detail: "Independent reviewers inspect the real artifact from different lenses." },
  { title: "Repair", detail: "One writable worker applies only supported corrections." },
  { title: "Verify", detail: "A final read-only worker checks the artifact against the original brief." },
];
export const WORKSPACE_PHASES = [
  { title: "Discover", detail: "Independent workers map requirements, repository patterns, and risks." },
  { title: "Plan", detail: "A planner defines the bounded file plan, acceptance criteria, and validation." },
  { title: "Implement", detail: "One writable worker changes files only inside the authorized scopes." },
  { title: "Review", detail: "Independent reviewers inspect the resulting repository changes." },
  { title: "Repair", detail: "One writable worker applies only supported corrections." },
  { title: "Verify", detail: "A final read-only worker checks every observed changed file." },
];

const RUN_ALLOWED_KEYS = new Set([
  "task",
  "workspace",
  "output_path",
  "artifact_type",
  "constraints",
  "source_context",
  "scouts",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, name, { max = 20_000 } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${name} exceeds the ${max}-character limit.`);
  return normalized;
}

function optionalString(value, name, { max = 20_000 } = {}) {
  if (value == null || value === "") return undefined;
  return requireString(value, name, { max });
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function maybeLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeExistingTarget(stats, label) {
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file when it already exists.`);
  if (stats.nlink !== 1) throw new Error(`${label} must not be a hard-linked file.`);
}

export function validateRunArguments(value) {
  if (!isPlainObject(value)) throw new Error("Workflow arguments must be an object.");
  const unknown = Object.keys(value).filter((key) => !RUN_ALLOWED_KEYS.has(key));
  if (unknown.length) throw new Error(`Unsupported workflow argument(s): ${unknown.join(", ")}.`);

  const constraints = value.constraints == null ? [] : value.constraints;
  if (!Array.isArray(constraints) || constraints.length > 20) {
    throw new Error("constraints must be an array containing at most 20 strings.");
  }
  const normalizedConstraints = constraints.map((constraint, index) =>
    requireString(constraint, `constraints[${index}]`, { max: 2_000 }),
  );
  const scouts = value.scouts == null ? 2 : Number(value.scouts);
  if (!Number.isInteger(scouts) || scouts < 2 || scouts > 4) {
    throw new Error("scouts must be an integer from 2 through 4.");
  }

  return {
    task: requireString(value.task, "task", { max: 20_000 }),
    workspace: requireString(value.workspace, "workspace", { max: 4_096 }),
    output_path: requireString(value.output_path, "output_path", { max: 1_024 }).replaceAll("\\", "/"),
    artifact_type: optionalString(value.artifact_type, "artifact_type", { max: 500 }),
    constraints: normalizedConstraints,
    source_context: optionalString(value.source_context, "source_context", { max: 50_000 }),
    scouts,
  };
}

export async function resolveGuardedOutput(workspaceInput, outputInput) {
  if (!path.isAbsolute(workspaceInput)) throw new Error("workspace must be an absolute path.");
  const workspace = await realpath(workspaceInput);
  assertGuardedWorkspaceLocation(workspace);
  if (!(await stat(workspace)).isDirectory()) throw new Error("workspace must resolve to an existing directory.");

  const outputPath = outputInput.replaceAll("\\", "/");
  const parts = outputPath.split("/");
  if (
    !outputPath ||
    outputPath.startsWith("/") ||
    outputPath.startsWith("~") ||
    /^[A-Za-z]:\//.test(outputPath) ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts.includes(".git") ||
    path.posix.normalize(outputPath) !== outputPath
  ) {
    throw new Error("output_path must be a normalized relative file path inside the workspace.");
  }

  const nominalTarget = path.join(workspace, ...parts);
  const nominalParent = path.dirname(nominalTarget);
  let parent;
  try {
    parent = await realpath(nominalParent);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("The output_path parent directory must already exist.");
    throw error;
  }
  if (!(await stat(parent)).isDirectory()) throw new Error("The output_path parent must resolve to a directory.");
  if (!inside(workspace, parent)) throw new Error("The output_path parent resolves outside the workspace.");

  const target = path.join(parent, path.basename(outputPath));
  if (!inside(workspace, target)) throw new Error("The output path resolves outside the workspace.");
  assertSafeExistingTarget(await maybeLstat(target), "The output path");
  return { workspace, outputPath, target };
}

export async function verifyOutputFile(target, workspace) {
  const stats = await maybeLstat(target);
  if (!stats) throw new Error("The workflow did not create the requested output file.");
  assertSafeExistingTarget(stats, "The output path");
  if (stats.size <= 0) throw new Error("The workflow output file is empty.");
  const resolvedTarget = await realpath(target);
  if (resolvedTarget !== path.resolve(target)) throw new Error("The workflow output changed link identity during execution.");
  if (!inside(workspace, resolvedTarget)) throw new Error("The workflow output resolves outside the workspace.");
  return { size: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export async function sha256File(filePath) {
  const contents = await readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function codexHomeFor(environment) {
  return path.resolve(environment.CODEX_HOME || path.join(environment.HOME || os.homedir(), ".codex"));
}

function executeFile(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({
        error,
        stdout: typeof stdout === "string" ? stdout : String(stdout || ""),
        stderr: typeof stderr === "string" ? stderr : String(stderr || ""),
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      });
    });
  });
}

function parseRecordOutput(stdout) {
  const text = stdout.trim();
  if (!text) throw new Error("Ultracode returned no workflow record.");
  try {
    const value = JSON.parse(text);
    if (!isPlainObject(value) || typeof value.id !== "string") throw new Error("The returned value was not a workflow record.");
    return value;
  } catch (error) {
    throw new Error(`Could not parse the Ultracode workflow record: ${error.message}`);
  }
}

function validRunId(value) {
  return typeof value === "string" && /^ultra-[A-Za-z0-9-]{8,160}$/.test(value);
}

function journalPathFor(codexHome, runId) {
  if (!validRunId(runId)) throw new Error("run_id is invalid.");
  return path.join(codexHome, "ultracode", "runs", `${runId}.json`);
}

async function readJson(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (!isPlainObject(parsed)) throw new Error(`Expected an object in ${filePath}.`);
  return parsed;
}

function normalizeReportedPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} contains an invalid path.`);
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.length > 1_024) throw new Error(`${label} contains a path longer than 1024 characters.`);
  const parts = normalized.split("/");
  if (
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:\//.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts.includes(".git") ||
    path.posix.normalize(normalized) !== normalized
  ) {
    throw new Error(`${label} contains an unsafe path: ${normalized}`);
  }
  return normalized;
}

function reportedPathList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of relative paths.`);
  if (value.length > 512) throw new Error(`${label} must not contain more than 512 paths.`);
  const normalized = value.map((item, index) => normalizeReportedPath(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized.sort();
}

function displayPathList(value) {
  if (!Array.isArray(value)) return [];
  const paths = [];
  for (const item of value.slice(0, 512)) {
    try {
      paths.push(normalizeReportedPath(item, "display path"));
    } catch {
      // Unsafe or malformed journal paths are not exposed to the dashboard.
    }
  }
  return [...new Set(paths)].sort();
}

function samePaths(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function workflowIdFor(record) {
  if (record?.definition_ref?.id === "change-workspace") return "change-workspace";
  if (record?.definition_ref?.id === "build-artifact") return "build-artifact";
  if (typeof record?.source_path === "string" && path.basename(record.source_path) === "change-workspace.js") return "change-workspace";
  return "build-artifact";
}

function findingList(record) {
  const result = isPlainObject(record.result) ? record.result : {};
  const review = Array.isArray(result.review_findings) ? result.review_findings : [];
  const final = isPlainObject(result.final_verification)
    ? Array.isArray(result.final_verification.blocking_findings)
      ? result.final_verification.blocking_findings
      : Array.isArray(result.final_verification.findings) ? result.final_verification.findings : []
    : [];
  const host = isPlainObject(record.workflow_studio) && Array.isArray(record.workflow_studio.blocking_findings)
    ? record.workflow_studio.blocking_findings
    : [];
  const error = typeof record.error === "string" ? record.error : record.error?.message;
  const workerFailures = (Array.isArray(record.workers) ? record.workers : []).flatMap((worker) => {
    const workerError = typeof worker?.error === "string" ? worker.error : worker?.error?.message;
    const blocking = Array.isArray(worker?.result?.blocking_findings) ? worker.result.blocking_findings : [];
    return [workerError, ...blocking]
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => `${worker.label || "Worker"}: ${item}`);
  });
  return [...new Set([...workerFailures, error, ...host, ...review, ...final].filter((item) => typeof item === "string" && item.trim()))];
}

function phaseState(record, phase, index, phases, accepted) {
  const events = Array.isArray(record.events) ? record.events : [];
  const seen = events
    .filter((event) => event?.type === "log" && typeof event.message === "string" && event.message.startsWith("phase: "))
    .map((event) => event.message.slice(7));
  const currentIndex = seen.length ? phases.findIndex((candidate) => candidate.title === seen.at(-1)) : -1;
  const phaseWasSeen = seen.includes(phase.title);
  if (accepted && phaseWasSeen) return "completed";
  if (!phaseWasSeen) return "pending";
  if (record.status === "running" && index === currentIndex) return "active";
  if (index < currentIndex) return "completed";
  if (index === currentIndex && record.status !== "running") return "failed";
  return "pending";
}

function normalizedFiles(record, { accepted, outputPath, workflow }) {
  const result = isPlainObject(record.result) ? record.result : {};
  if (workflow === "build-artifact") {
    if (!outputPath) return [];
    return [{ path: outputPath, planned: true, changed: accepted, verified: accepted, status: accepted ? "modified" : null }];
  }
  const plannerPaths = Array.isArray(record.workers)
    ? record.workers.find((worker) => worker?.label === "planner")?.result?.planned_paths
    : [];
  const planned = new Set(displayPathList(
    Array.isArray(result.planned_paths) && result.planned_paths.length ? result.planned_paths : plannerPaths,
  ));
  const reportedChanged = new Set(displayPathList(result.changed_paths));
  const verified = new Set(displayPathList(result.verified_paths));
  const evidenceFiles = [];
  if (isPlainObject(record.workflow_studio) && Array.isArray(record.workflow_studio.changed_files)) {
    for (const file of record.workflow_studio.changed_files.slice(0, 512)) {
      if (!isPlainObject(file)) continue;
      try {
        evidenceFiles.push({ ...file, path: normalizeReportedPath(file.path, "workflow_studio.changed_files") });
      } catch {
        // Unsafe or malformed evidence paths stay out of the visual payload.
      }
    }
  }
  const changed = new Map(evidenceFiles.map((file) => [file.path, file.status || null]));
  for (const changedPath of reportedChanged) if (!changed.has(changedPath)) changed.set(changedPath, null);
  const paths = [...new Set([...planned, ...changed.keys(), ...verified])].sort();
  return paths.map((filePath) => ({
    path: filePath,
    planned: planned.has(filePath),
    changed: changed.has(filePath),
    verified: verified.has(filePath),
    status: changed.get(filePath) || null,
  }));
}

export function normalizeJournal(record, { workflowId } = {}) {
  if (!record) {
    return {
      schemaVersion: 2,
      workflow: "workflow-studio",
      state: "ready",
      status: "ready",
      accepted: null,
      title: "Ready for a guarded workflow",
      summary: "Ask Codex to create one artifact or implement a scoped multi-file repository change.",
      runId: null,
      task: null,
      workspace: null,
      outputPath: null,
      absoluteOutputPath: null,
      writePaths: [],
      changedPaths: [],
      files: [],
      fileCounts: { planned: 0, changed: 0, verified: 0 },
      sourceHash: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      findings: [],
      reviewFindingCount: 0,
      workerCount: 0,
      completedWorkerCount: 0,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
      phases: WORKSPACE_PHASES.map((phase) => ({ ...phase, status: "pending", workerCount: 0 })),
    };
  }

  const result = isPlainObject(record.result) ? record.result : {};
  const workflow = workflowId || workflowIdFor(record);
  const hostAccepted = workflow === "change-workspace" ? record.workflow_studio?.accepted === true : true;
  const accepted = record.status === "completed" && result.accepted === true && hostAccepted;
  const state = record.status === "running" ? "running" : accepted ? "accepted" : "failed";
  const phases = Array.isArray(record.meta?.phases) && record.meta.phases.length
    ? record.meta.phases
    : workflow === "change-workspace" ? WORKSPACE_PHASES : DEFAULT_PHASES;
  const workers = Array.isArray(record.workers) ? record.workers : [];
  const findings = findingList(record);
  const usage = isPlainObject(record.aggregate_usage) ? record.aggregate_usage : {};
  const framedOutputPath = Array.isArray(record.events)
    ? record.events.find((event) => event?.type === "log" && typeof event?.data?.output_path === "string")?.data?.output_path
    : null;
  const outputPath = typeof result.output_path === "string" ? result.output_path : framedOutputPath || null;
  const files = normalizedFiles(record, { accepted, outputPath, workflow });
  const fileCounts = {
    planned: files.filter((file) => file.planned).length,
    changed: files.filter((file) => file.changed).length,
    verified: files.filter((file) => file.verified).length,
  };
  const evidenceWritePaths = isPlainObject(record.workflow_studio) ? record.workflow_studio.requested_write_paths : [];
  const writePaths = workflow === "change-workspace"
    ? displayPathList(Array.isArray(result.write_paths) && result.write_paths.length ? result.write_paths : evidenceWritePaths)
    : outputPath ? [outputPath] : [];
  const changedPaths = files.filter((file) => file.changed).map((file) => file.path);
  const recordError = typeof record.error === "string" ? record.error : record.error?.message;
  const acceptedTarget = workflow === "change-workspace"
    ? `${fileCounts.changed} changed file${fileCounts.changed === 1 ? "" : "s"}`
    : outputPath || "the requested artifact";
  const summary = state === "accepted"
    ? `Accepted ${acceptedTarget} after independent implementation, review, and verification.`
    : state === "running"
      ? "The guarded workflow is still running."
      : findings[0] || recordError || "The workflow did not satisfy its final acceptance checks.";

  return {
    schemaVersion: 2,
    workflow,
    state,
    status: record.status || "unknown",
    accepted,
    title: state === "accepted"
      ? workflow === "change-workspace" ? "Workspace changes accepted" : "Artifact accepted"
      : state === "running" ? "Workflow running" : "Workflow blocked",
    summary,
    runId: record.id || null,
    task: typeof result.task === "string"
      ? result.task
      : typeof record.workflow_studio?.requested_task === "string" ? record.workflow_studio.requested_task : null,
    workspace: typeof record.cwd === "string" ? record.cwd : null,
    outputPath,
    absoluteOutputPath: outputPath && typeof record.cwd === "string" ? path.join(record.cwd, outputPath) : null,
    writePaths,
    changedPaths,
    files,
    fileCounts,
    sourceHash: typeof record.source_hash === "string" ? record.source_hash : null,
    startedAt: record.started_at || null,
    completedAt: record.completed_at || null,
    durationMs: Number.isFinite(record.duration_ms) ? record.duration_ms : null,
    findings,
    reviewFindingCount: Array.isArray(result.review_findings) ? result.review_findings.length : findings.length,
    workerCount: workers.length,
    completedWorkerCount: workers.filter((worker) => worker?.status === "completed").length,
    usage: {
      inputTokens: Number(usage.input_tokens) || 0,
      cachedInputTokens: Number(usage.cached_input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      reasoningTokens: Number(usage.reasoning_output_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || 0,
    },
    phases: phases.map((phase, index) => ({
      title: String(phase.title || `Phase ${index + 1}`),
      detail: String(phase.detail || ""),
      status: phaseState(record, phase, index, phases, accepted),
      workerCount: workers.filter((worker) => worker?.phase === phase.title).length,
    })),
  };
}

async function assertTrustedJournal(record, { workflowId, workflowPath, workflowHash, expectedWorkspace, expectedStatePath } = {}) {
  if (!validRunId(record.id)) throw new Error("The journal has an invalid run id.");
  const resolvedSource = await realpath(record.source_path);
  const resolvedWorkflow = await realpath(workflowPath);
  if (resolvedSource !== resolvedWorkflow) throw new Error("The journal did not use the bundled workflow source.");
  if (record.definition_ref?.id !== workflowId) throw new Error("The journal workflow id does not match the bundled definition.");
  if (typeof record.definition_ref?.path !== "string" || (await realpath(record.definition_ref.path)) !== resolvedWorkflow) {
    throw new Error("The journal definition path does not match the bundled workflow source.");
  }
  if (record.source_hash !== workflowHash || record.definition_ref?.source_hash !== workflowHash) {
    throw new Error("The workflow definition hash does not match the bundled source.");
  }
  if (record.definition_ref?.scope !== "path") throw new Error("The workflow was not launched by exact source path.");
  if (expectedStatePath) {
    if (typeof record.state_path !== "string" || (await realpath(record.state_path)) !== (await realpath(expectedStatePath))) {
      throw new Error("The journal state path does not match the requested run file.");
    }
  }
  if (expectedWorkspace && (await realpath(record.cwd)) !== expectedWorkspace) {
    throw new Error("The journal workspace does not match the requested workspace.");
  }
}

function assertStringArray(value, label, { minItems = 0, maxItems = 512, maxItemLength = 8_000 } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  if (value.length < minItems) throw new Error(`${label} must contain at least ${minItems} item(s).`);
  if (value.length > maxItems) throw new Error(`${label} must not contain more than ${maxItems} items.`);
  if (value.some((item) => item.length > maxItemLength)) {
    throw new Error(`${label} contains an item longer than ${maxItemLength} characters.`);
  }
  return value;
}

function assertStructuredReport(value, label, { clean = false, findingKey = "findings" } = {}) {
  if (!isPlainObject(value) || typeof value.summary !== "string" || !value.summary.trim()) {
    throw new Error(`${label} did not provide a structured summary.`);
  }
  if (value.summary.length > 8_000) throw new Error(`${label}.summary is too long.`);
  const findings = assertStringArray(value[findingKey], `${label}.${findingKey}`);
  assertStringArray(value.recommended_actions, `${label}.recommended_actions`);
  assertStringArray(value.risks, `${label}.risks`);
  assertStringArray(value.verification, `${label}.verification`, { minItems: 1 });
  if (!new Set(["low", "medium", "high"]).has(value.confidence)) {
    throw new Error(`${label}.confidence is invalid.`);
  }
  if (clean && findings.length) throw new Error(`${label} contains blocking findings.`);
  return value;
}

function requireWorker(workers, label, phase) {
  const matches = workers.filter((worker) => worker?.label === label);
  if (matches.length !== 1) throw new Error(`Required worker evidence must contain exactly one ${label}.`);
  const worker = matches[0];
  if (worker.status !== "completed") throw new Error(`Required worker did not complete: ${label}.`);
  if (worker.phase !== phase) throw new Error(`Required worker ${label} used the wrong phase.`);
  if (worker.schema_valid === false) throw new Error(`Required worker ${label} returned schema-invalid evidence.`);
  return worker;
}

function requireExactWorkerSet(workers, expected) {
  if (!Array.isArray(workers) || workers.length !== expected.length) {
    throw new Error(`Expected exactly ${expected.length} workflow workers, received ${Array.isArray(workers) ? workers.length : 0}.`);
  }
  const labels = workers.map((worker) => worker?.label);
  if (labels.some((label) => typeof label !== "string") || new Set(labels).size !== labels.length) {
    throw new Error("Workflow worker labels must be present and unique.");
  }
  const ids = workers.map((worker) => worker?.id).filter((id) => id != null);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new Error("Workflow worker ids must be unique when present.");
  }
  return new Map(expected.map(({ label, phase }) => [label, requireWorker(workers, label, phase)]));
}

function requireExactCount(value, expected, label) {
  if (!Number.isInteger(value) || value !== expected) throw new Error(`${label} must equal ${expected}.`);
}

function assertDeepMatch(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label} does not match its worker evidence.`);
}

function assertArtifactAcceptanceEvidence(record, request) {
  const result = record.result;
  if (record.status !== "completed" || result?.accepted !== true) throw new Error("The workflow did not return an accepted final result.");
  if (result.output_path !== request.output_path) throw new Error("The journal output path does not match the request.");
  const workers = Array.isArray(record.workers) ? record.workers : [];
  const briefReview = assertStructuredReport(requireWorker(workers, "brief-reviewer", "Review").result, "brief-reviewer");
  const qualityReview = assertStructuredReport(requireWorker(workers, "quality-reviewer", "Review").result, "quality-reviewer");
  const reviewFindings = [...briefReview.findings, ...qualityReview.findings];
  assertStringArray(result.review_findings, "result.review_findings");
  assertDeepMatch(result.review_findings, reviewFindings, "result.review_findings");
  const expected = [
    ...["requirements", "structure", "risk", "user-value"].slice(0, request.scouts).map((label) => ({ label, phase: "Frame" })),
    { label: "planner", phase: "Plan" },
    { label: "builder", phase: "Build" },
    { label: "brief-reviewer", phase: "Review" },
    { label: "quality-reviewer", phase: "Review" },
    ...(reviewFindings.length ? [{ label: "repairer", phase: "Repair" }] : []),
    { label: "final-verifier", phase: "Verify" },
  ];
  const workerMap = requireExactWorkerSet(workers, expected);
  for (const { label } of expected) assertStructuredReport(workerMap.get(label).result, label);
  const builder = assertStructuredReport(workerMap.get("builder").result, "builder", { clean: true });
  const finalVerifier = assertStructuredReport(workerMap.get("final-verifier").result, "final-verifier", { clean: true });
  assertDeepMatch(result.build_report, builder, "result.build_report");
  assertDeepMatch(result.final_verification, finalVerifier, "result.final_verification");
  if (reviewFindings.length) {
    const repairer = assertStructuredReport(workerMap.get("repairer").result, "repairer", { clean: true });
    assertDeepMatch(result.repair_report, repairer, "result.repair_report");
  } else if (typeof result.repair_report !== "string" || !result.repair_report.trim()) {
    throw new Error("result.repair_report must explain why no repair worker ran.");
  }
  requireExactCount(result.framing_workers_completed, request.scouts, "result.framing_workers_completed");
  requireExactCount(result.reviewers_completed, 2, "result.reviewers_completed");
}

function assertPathsInsideScopes(paths, writePaths, label) {
  for (const reportedPath of paths) {
    if (!pathWithinWritePaths(reportedPath, writePaths)) {
      throw new Error(`${label} reported a path outside the authorized write scopes: ${reportedPath}`);
    }
  }
}

function assertWorkspaceAcceptanceEvidence(record, request, observedPaths) {
  const result = record.result;
  if (record.status !== "completed" || result?.accepted !== true) throw new Error("The workspace workflow did not return an accepted final result.");
  const writePaths = reportedPathList(result.write_paths, "result.write_paths");
  if (!samePaths(writePaths, [...request.write_paths].sort())) throw new Error("The journal write scopes do not match the request.");
  const plannedPaths = reportedPathList(result.planned_paths, "result.planned_paths");
  if (!plannedPaths.length) throw new Error("The planner must report at least one planned path.");
  const changedPaths = reportedPathList(result.changed_paths, "result.changed_paths");
  const verifiedPaths = reportedPathList(result.verified_paths, "result.verified_paths");
  assertPathsInsideScopes(plannedPaths, request.write_paths, "The planner");
  assertPathsInsideScopes(changedPaths, request.write_paths, "The writer");
  assertPathsInsideScopes(verifiedPaths, request.write_paths, "The verifier");
  if (!observedPaths.length) throw new Error("The workspace workflow produced no observed file changes.");
  if (!samePaths(changedPaths, observedPaths)) throw new Error("The reported changed paths do not match the host-observed delta.");
  if (!samePaths(verifiedPaths, observedPaths)) throw new Error("The final verifier did not cover every host-observed changed file.");
  const workers = Array.isArray(record.workers) ? record.workers : [];
  const requirementsReview = assertStructuredReport(
    requireWorker(workers, "requirements-reviewer", "Review").result,
    "requirements-reviewer",
  );
  const qualityReview = assertStructuredReport(requireWorker(workers, "quality-reviewer", "Review").result, "quality-reviewer");
  const reviewFindings = [
    ...requirementsReview.findings.map((finding) => `requirements-reviewer: ${finding}`),
    ...qualityReview.findings.map((finding) => `quality-reviewer: ${finding}`),
  ];
  assertStringArray(result.review_findings, "result.review_findings");
  assertDeepMatch(result.review_findings, reviewFindings, "result.review_findings");
  const expected = [
    ...["requirements", "architecture", "risk", "verification"].slice(0, request.scouts).map((label) => ({ label, phase: "Discover" })),
    { label: "planner", phase: "Plan" },
    { label: "implementer", phase: "Implement" },
    { label: "requirements-reviewer", phase: "Review" },
    { label: "quality-reviewer", phase: "Review" },
    ...(reviewFindings.length ? [{ label: "repairer", phase: "Repair" }] : []),
    { label: "final-verifier", phase: "Verify" },
  ];
  const workerMap = requireExactWorkerSet(workers, expected);
  const executionLabels = new Set(["implementer", "repairer", "final-verifier"]);
  for (const { label } of expected) {
    assertStructuredReport(workerMap.get(label).result, label, {
      findingKey: executionLabels.has(label) ? "blocking_findings" : "findings",
    });
  }
  const planner = workerMap.get("planner").result;
  const workerPlannedPaths = reportedPathList(planner.planned_paths, "planner.planned_paths");
  if (!workerPlannedPaths.length) throw new Error("planner.planned_paths must not be empty.");
  assertStringArray(planner.acceptance_criteria, "planner.acceptance_criteria", { minItems: 1 });
  assertStringArray(planner.validation, "planner.validation", { minItems: 1 });
  if (!samePaths(workerPlannedPaths, plannedPaths)) throw new Error("The top-level planned paths do not match the planner evidence.");
  const implementer = assertStructuredReport(workerMap.get("implementer").result, "implementer", {
    clean: true,
    findingKey: "blocking_findings",
  });
  assertDeepMatch(result.implementation_report, implementer, "result.implementation_report");
  const workerChangedPaths = reportedPathList(implementer.changed_paths, "implementer.changed_paths");
  if (reviewFindings.length) {
    const repairer = assertStructuredReport(workerMap.get("repairer").result, "repairer", {
      clean: true,
      findingKey: "blocking_findings",
    });
    assertDeepMatch(result.repair_report, repairer, "result.repair_report");
    workerChangedPaths.push(...reportedPathList(repairer.changed_paths, "repairer.changed_paths"));
  } else {
    const noRepair = assertStructuredReport(result.repair_report, "result.repair_report", {
      clean: true,
      findingKey: "blocking_findings",
    });
    const noRepairPaths = reportedPathList(noRepair.changed_paths, "result.repair_report.changed_paths");
    if (noRepairPaths.length) throw new Error("A no-op repair report must not claim changed paths.");
  }
  const combinedWorkerPaths = [...new Set(workerChangedPaths)].sort();
  if (!samePaths(combinedWorkerPaths, observedPaths)) {
    throw new Error("The writable workers did not report a changed-file set matching the observed delta.");
  }
  const finalVerifier = assertStructuredReport(workerMap.get("final-verifier").result, "final-verifier", {
    clean: true,
    findingKey: "blocking_findings",
  });
  assertDeepMatch(result.final_verification, finalVerifier, "result.final_verification");
  const workerVerifiedPaths = reportedPathList(finalVerifier.verified_paths, "final-verifier.verified_paths");
  if (!samePaths(workerVerifiedPaths, observedPaths)) throw new Error("The final verifier worker did not cover the observed delta.");
  requireExactCount(result.framing_workers_completed, request.scouts, "result.framing_workers_completed");
  requireExactCount(result.reviewers_completed, 2, "result.reviewers_completed");
}

async function prepareRuntime(options, workflowPath, workflowId) {
  const environment = { ...process.env, ...(options.environment || {}) };
  const codexHome = options.codexHome || codexHomeFor(environment);
  const workerRunner = options.workerRunner || WORKER_RUNNER_PATH;
  const ultracodeBin = options.ultracodeBin || process.execPath;
  const ultracodeArgs = options.ultracodeBin ? [] : [await resolveUltracodeCli(codexHome)];
  const codexRealBin = options.codexRealBin || await resolveCodexBinary(environment);
  await access(workflowPath, fsConstants.R_OK);
  await access(workerRunner, fsConstants.R_OK | fsConstants.X_OK);
  await access(ultracodeBin, fsConstants.R_OK | fsConstants.X_OK);
  await access(codexRealBin, fsConstants.R_OK | fsConstants.X_OK);
  return {
    environment, codexHome, workerRunner, ultracodeBin, ultracodeArgs, codexRealBin, workflowId, workflowPath,
    workflowHash: await sha256File(workflowPath),
    executor: options.executeFile || executeFile,
  };
}

function workflowProcessError(child) {
  const stderr = typeof child?.stderr === "string" ? child.stderr.trim() : "";
  if (stderr) return stderr.slice(-1_500);
  const message = typeof child?.error?.message === "string" ? child.error.message.trim() : "";
  if (message) return message.slice(-1_500);
  if (child?.exitCode != null && child.exitCode !== 0) return `Ultracode exited with status ${child.exitCode}.`;
  return "Ultracode returned no workflow record.";
}

async function executeWorkflowProcess(runtime, { workspace, workflowArguments, extraEnvironment = {}, maxAgents = 10 }) {
  const childEnvironment = {
    ...runtime.environment,
    HOME: runtime.environment.HOME || os.homedir(),
    CODEX_HOME: runtime.codexHome,
    PATH: [path.dirname(runtime.workerRunner), path.join(runtime.environment.HOME || os.homedir(), ".local", "bin"), runtime.environment.PATH]
      .filter(Boolean).join(path.delimiter),
    ULTRACODE_WORKSPACE_ROOT: workspace,
    ULTRACODE_NO_AUTO_UPDATE: "1",
    ULTRACODE_UI: "0",
    CODEX_REAL_BIN: runtime.codexRealBin,
    ...extraEnvironment,
  };
  let child;
  try {
    child = await runtime.executor(
      runtime.ultracodeBin,
      [
        ...runtime.ultracodeArgs,
        `@${runtime.workflowPath}`, "--cwd", workspace, "--codex-home", runtime.codexHome,
        "--args", JSON.stringify(workflowArguments), "--concurrency", "2", "--max-agents", String(maxAgents),
        "--max-retries", "1", "--no-auto-update", "--no-ui",
      ],
      {
        cwd: workspace, env: childEnvironment, encoding: "utf8", timeout: 30 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      },
    );
  } catch (error) {
    child = { error, exitCode: 1, stdout: "", stderr: error?.message || String(error) };
  }
  return { child, childEnvironment };
}

async function loadWorkflowJournal(runtime, child, workspace) {
  if (!child?.stdout?.trim()) throw new Error(workflowProcessError(child));
  const returnedRecord = parseRecordOutput(child.stdout);
  const statePath = journalPathFor(runtime.codexHome, returnedRecord.id);
  const journal = await readJson(statePath);
  if (journal.id !== returnedRecord.id) throw new Error("The returned run id does not match its journal.");
  await assertTrustedJournal(journal, {
    workflowId: runtime.workflowId,
    workflowPath: runtime.workflowPath,
    workflowHash: runtime.workflowHash,
    expectedWorkspace: workspace,
    expectedStatePath: statePath,
  });
  return { journal, statePath };
}

async function launchWorkflow(runtime, options) {
  const executed = await executeWorkflowProcess(runtime, options);
  const loaded = await loadWorkflowJournal(runtime, executed.child, options.workspace);
  return { ...executed, ...loaded };
}

export async function runBuildArtifact(rawArguments, options = {}) {
  const request = validateRunArguments(rawArguments);
  const guard = await resolveGuardedOutput(request.workspace, request.output_path);
  const runtime = await prepareRuntime(options, options.workflowPath || WORKFLOW_SOURCE_PATH, "build-artifact");
  const workflowArguments = {
    task: request.task, output_path: request.output_path, artifact_type: request.artifact_type,
    constraints: request.constraints, source_context: request.source_context, scouts: request.scouts, allow_research: false,
  };
  for (const [key, value] of Object.entries(workflowArguments)) if (value === undefined) delete workflowArguments[key];
  const launched = await launchWorkflow(runtime, {
    workspace: guard.workspace,
    workflowArguments,
    extraEnvironment: {
      ULTRACODE_ALLOWED_OUTPUT: guard.target,
    },
  });
  const normalized = normalizeJournal(launched.journal, { workflowId: "build-artifact" });
  if (launched.child.exitCode !== 0) {
    return {
      ...normalized, state: "failed", accepted: false, title: "Workflow process failed",
      summary: launched.child.stderr.trim().slice(-1_500) || `Ultracode exited with status ${launched.child.exitCode}.`,
    };
  }
  if (!normalized.accepted) return normalized;
  assertArtifactAcceptanceEvidence(launched.journal, request);
  return { ...normalized, output: await verifyOutputFile(guard.target, guard.workspace) };
}

async function writeJournalEvidence(statePath, journal, evidence) {
  const updated = { ...journal, workflow_studio: evidence };
  const temporary = `${statePath}.workflow-studio-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, statePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return updated;
}

function rejectedWorkspaceRecord({ request, runtime, before, after, changedFiles, blocking, startedAt, journal = null }) {
  const completedAt = new Date();
  const evidence = {
    schema_version: 1,
    workflow: "change-workspace",
    workflow_source_hash: runtime.workflowHash,
    journal_digest_before: journal
      ? crypto.createHash("sha256").update(JSON.stringify(journal)).digest("hex")
      : null,
    requested_write_paths: request.write_paths,
    requested_task: request.task,
    before_head: before.head,
    after_head: after?.head || null,
    before_git_status: before.status,
    after_git_status: after?.status || [],
    changed_files: changedFiles,
    blocking_findings: blocking,
    accepted: false,
    verified_at: completedAt.toISOString(),
  };
  return {
    ...(journal || {}),
    id: null,
    name: "Workspace Change",
    status: "failed",
    started_at: journal?.started_at || startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: journal?.duration_ms || Math.max(0, completedAt.getTime() - startedAt.getTime()),
    cwd: request.workspace,
    state_path: null,
    source_path: runtime.workflowPath,
    source_hash: runtime.workflowHash,
    definition_ref: {
      id: "change-workspace",
      name: "Change Workspace",
      scope: "path",
      path: runtime.workflowPath,
      source_hash: runtime.workflowHash,
    },
    meta: journal?.meta || { phases: WORKSPACE_PHASES },
    workers: Array.isArray(journal?.workers) ? journal.workers : [],
    events: Array.isArray(journal?.events) ? journal.events : [],
    aggregate_usage: isPlainObject(journal?.aggregate_usage) ? journal.aggregate_usage : {},
    error: blocking[0] || "The workspace workflow was rejected.",
    result: isPlainObject(journal?.result)
      ? journal.result
      : {
          accepted: false,
          task: request.task,
          write_paths: request.write_paths,
          planned_paths: [],
          changed_paths: [],
          verified_paths: [],
          framing_workers_completed: 0,
          reviewers_completed: 0,
          review_findings: [],
          final_verification: { findings: [], verification: [] },
        },
    workflow_studio: evidence,
  };
}

export async function runWorkspaceWorkflow(rawArguments, options = {}) {
  const validated = validateWorkspaceRunArguments(rawArguments);
  const guard = await resolveGuardedWorkspace(validated.workspace, validated.write_paths);
  const request = { ...validated, workspace: guard.workspace, write_paths: guard.writePaths };
  const before = await snapshotWorkspace(guard);
  const runtime = await prepareRuntime(
    options,
    options.workspaceWorkflowPath || options.workflowPath || WORKSPACE_WORKFLOW_SOURCE_PATH,
    "change-workspace",
  );
  const workflowArguments = {
    task: request.task, write_paths: request.write_paths, constraints: request.constraints,
    source_context: request.source_context, scouts: request.scouts, baseline_status: before.status, allow_research: false,
  };
  for (const [key, value] of Object.entries(workflowArguments)) if (value === undefined) delete workflowArguments[key];
  const startedAt = new Date();
  const executed = await executeWorkflowProcess(runtime, {
    workspace: guard.workspace,
    workflowArguments,
    maxAgents: 12,
    extraEnvironment: {
      ULTRACODE_ALLOWED_WRITE_PATHS_JSON: JSON.stringify(guard.targets),
    },
  });

  const blocking = [];
  let launched = null;
  try {
    launched = {
      ...executed,
      ...(await loadWorkflowJournal(runtime, executed.child, guard.workspace)),
    };
  } catch (error) {
    blocking.push(error?.message || String(error));
  }
  let after = null;
  let changedFiles = [];
  try {
    after = await snapshotWorkspace(guard);
    changedFiles = compareWorkspaceSnapshots(before, after);
  } catch (error) {
    blocking.push(error?.message || String(error));
  }
  if (launched && executed.child.exitCode !== 0) {
    blocking.push(workflowProcessError(executed.child));
  }
  if (launched && (launched.journal.status !== "completed" || launched.journal.result?.accepted !== true)) {
    const failures = findingList(launched.journal);
    blocking.push(...(failures.length ? failures : ["The workspace workflow did not return an accepted final result."]));
  }
  if (after && before.head !== after.head) blocking.push("The workflow changed Git HEAD, which is not permitted.");
  const outsideScopes = changedFiles.filter((file) => !pathWithinWritePaths(file.path, request.write_paths));
  if (outsideScopes.length) blocking.push(`Observed changes outside the authorized write scopes: ${outsideScopes.map((file) => file.path).join(", ")}`);
  if (!changedFiles.length && !blocking.length) blocking.push("The workspace workflow produced no observed file changes.");
  const observedPaths = changedFiles.map((file) => file.path).sort();
  if (launched && !blocking.length) {
    try {
      assertWorkspaceAcceptanceEvidence(launched.journal, request, observedPaths);
    } catch (error) {
      blocking.push(error?.message || String(error));
    }
  }

  const evidence = {
    schema_version: 1,
    workflow: "change-workspace",
    workflow_source_hash: runtime.workflowHash,
    journal_digest_before: launched
      ? crypto.createHash("sha256").update(JSON.stringify(launched.journal)).digest("hex")
      : null,
    requested_write_paths: request.write_paths,
    requested_task: request.task,
    before_head: before.head,
    after_head: after?.head || null,
    before_git_status: before.status,
    after_git_status: after?.status || [],
    changed_files: changedFiles,
    blocking_findings: blocking,
    accepted: blocking.length === 0,
    verified_at: new Date().toISOString(),
  };
  if (!launched) {
    return normalizeJournal(rejectedWorkspaceRecord({
      request, runtime, before, after, changedFiles, blocking, startedAt,
    }), { workflowId: "change-workspace" });
  }
  try {
    return normalizeJournal(await writeJournalEvidence(launched.statePath, launched.journal, evidence), {
      workflowId: "change-workspace",
    });
  } catch (error) {
    blocking.push(`Could not persist Workflow Studio host evidence: ${error?.message || String(error)}`);
    return normalizeJournal(rejectedWorkspaceRecord({
      request, runtime, before, after, changedFiles, blocking, startedAt, journal: launched.journal,
    }), { workflowId: "change-workspace" });
  }
}

async function trustedWorkflowContext(options = {}) {
  const environment = { ...process.env, ...(options.environment || {}) };
  const codexHome = options.codexHome || codexHomeFor(environment);
  const definitions = [
    { id: "build-artifact", path: options.workflowPath || WORKFLOW_SOURCE_PATH },
    { id: "change-workspace", path: options.workspaceWorkflowPath || WORKSPACE_WORKFLOW_SOURCE_PATH },
  ];
  for (const definition of definitions) definition.hash = await sha256File(definition.path);
  return { codexHome, definitions };
}

function journalDigestWithoutHostEvidence(record) {
  const copy = { ...record };
  delete copy.workflow_studio;
  return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

async function validateWorkspaceHostEvidence(record, definition) {
  const evidence = record.workflow_studio;
  if (!isPlainObject(evidence) || evidence.schema_version !== 1 || evidence.workflow !== "change-workspace") {
    throw new Error("The workspace journal is missing trusted host evidence.");
  }
  if (evidence.workflow_source_hash !== definition.hash) throw new Error("The workspace host evidence uses the wrong source hash.");
  if (evidence.journal_digest_before !== journalDigestWithoutHostEvidence(record)) {
    throw new Error("The workspace journal changed after host evidence was recorded.");
  }
  const blocking = assertStringArray(evidence.blocking_findings, "workflow_studio.blocking_findings");
  const requested = reportedPathList(evidence.requested_write_paths, "workflow_studio.requested_write_paths");
  if (!requested.length) throw new Error("The workspace host evidence has no requested write scopes.");
  if (!Array.isArray(evidence.changed_files)) throw new Error("The workspace changed-file evidence is malformed.");
  const observed = [];
  const statuses = new Set(["added", "modified", "deleted", "mode-changed"]);
  for (const file of evidence.changed_files) {
    if (!isPlainObject(file) || !statuses.has(file.status)) throw new Error("The workspace changed-file evidence is malformed.");
    const filePath = normalizeReportedPath(file.path, "workflow_studio.changed_files");
    if (observed.includes(filePath)) throw new Error("The workspace changed-file evidence contains duplicate paths.");
    observed.push(filePath);
    if (evidence.accepted === true && !pathWithinWritePaths(filePath, requested)) {
      throw new Error("Accepted host evidence contains a changed file outside its write scopes.");
    }
  }
  observed.sort();
  if (typeof evidence.accepted !== "boolean") throw new Error("The workspace host evidence acceptance flag is malformed.");
  if (evidence.accepted) {
    if (blocking.length) throw new Error("Accepted workspace host evidence contains blocking findings.");
    if (!observed.length) throw new Error("Accepted workspace host evidence contains no changed files.");
    if (typeof evidence.before_head !== "string" || evidence.before_head !== evidence.after_head) {
      throw new Error("Accepted workspace host evidence did not preserve Git HEAD.");
    }
    const scouts = record.result?.framing_workers_completed;
    if (!Number.isInteger(scouts) || scouts < 2 || scouts > 4) throw new Error("The workspace scout count is invalid.");
    assertWorkspaceAcceptanceEvidence(record, { write_paths: requested, scouts }, observed);
  } else if (!blocking.length) {
    throw new Error("Rejected workspace host evidence must contain a blocking finding.");
  }
}

async function validateArtifactReadEvidence(record) {
  if (record.status !== "completed" || record.result?.accepted !== true) return;
  const outputPath = normalizeReportedPath(record.result.output_path, "result.output_path");
  const scouts = record.result?.framing_workers_completed;
  if (!Number.isInteger(scouts) || scouts < 2 || scouts > 4) throw new Error("The artifact scout count is invalid.");
  assertArtifactAcceptanceEvidence(record, { output_path: outputPath, scouts });
  const guard = await resolveGuardedOutput(record.cwd, outputPath);
  await verifyOutputFile(guard.target, guard.workspace);
}

async function trustedDefinitionForRecord(record, context, { expectedStatePath } = {}) {
  for (const definition of context.definitions) {
    try {
      await assertTrustedJournal(record, {
        workflowId: definition.id,
        workflowPath: definition.path,
        workflowHash: definition.hash,
        expectedStatePath,
      });
      if (definition.id === "change-workspace" && record.status !== "running") {
        await validateWorkspaceHostEvidence(record, definition);
      } else if (definition.id === "build-artifact") {
        await validateArtifactReadEvidence(record);
      }
      return definition;
    } catch {
      // Try the next exact bundled definition.
    }
  }
  throw new Error("The journal does not match a trusted bundled Workflow Studio definition.");
}

export async function getWorkflowRun(runId, options = {}) {
  const context = await trustedWorkflowContext(options);
  const statePath = journalPathFor(context.codexHome, runId);
  const journal = await readJson(statePath);
  if (journal.id !== runId) throw new Error("The journal id does not match the requested run file.");
  const definition = await trustedDefinitionForRecord(journal, context, { expectedStatePath: statePath });
  return normalizeJournal(journal, { workflowId: definition.id });
}

export async function getLatestWorkflowRun(options = {}) {
  const context = await trustedWorkflowContext(options);
  const runsDir = path.join(context.codexHome, "ultracode", "runs");
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return normalizeJournal(null);
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && /^ultra-[A-Za-z0-9-]+\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of names) {
    try {
      const statePath = path.join(runsDir, name);
      const journal = await readJson(statePath);
      const expectedId = name.slice(0, -".json".length);
      if (journal.id !== expectedId) throw new Error("The journal id does not match its run filename.");
      const definition = await trustedDefinitionForRecord(journal, context, { expectedStatePath: statePath });
      return normalizeJournal(journal, { workflowId: definition.id });
    } catch {
      // Ignore unrelated, stale, or malformed Ultracode journals.
    }
  }
  return normalizeJournal(null);
}
