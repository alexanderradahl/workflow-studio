import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(srcDir, "..");
export const WORKFLOW_SOURCE_PATH = path.join(PLUGIN_ROOT, "workflows", "build-artifact.js");
export const WORKER_RUNNER_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-lean");
export const DEFAULT_CODEX_REAL_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
export const DEFAULT_PHASES = [
  { title: "Frame", detail: "Independent workers turn the brief into complementary build guidance." },
  { title: "Plan", detail: "A planner combines the strongest guidance into explicit acceptance criteria." },
  { title: "Build", detail: "One writable worker creates the requested artifact in the current workspace." },
  { title: "Review", detail: "Independent reviewers inspect the real artifact from different lenses." },
  { title: "Repair", detail: "One writable worker applies only supported corrections." },
  { title: "Verify", detail: "A final read-only worker checks the artifact against the original brief." },
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
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
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
  const workspaceStats = await stat(workspace);
  if (!workspaceStats.isDirectory()) throw new Error("workspace must resolve to an existing directory.");

  const outputPath = outputInput.replaceAll("\\", "/");
  const parts = outputPath.split("/");
  if (
    !outputPath ||
    outputPath.startsWith("/") ||
    outputPath.startsWith("~") ||
    /^[A-Za-z]:\//.test(outputPath) ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
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
  const parentStats = await stat(parent);
  if (!parentStats.isDirectory()) throw new Error("The output_path parent must resolve to a directory.");
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

function ultracodeBinaryFor(environment) {
  return path.join(environment.HOME || os.homedir(), ".local", "bin", "ultracode");
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
    if (!isPlainObject(value) || typeof value.id !== "string") {
      throw new Error("The returned value was not a workflow record.");
    }
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

function findingList(record) {
  const result = isPlainObject(record.result) ? record.result : {};
  const review = Array.isArray(result.review_findings) ? result.review_findings : [];
  const final = isPlainObject(result.final_verification) && Array.isArray(result.final_verification.findings)
    ? result.final_verification.findings
    : [];
  return [...new Set([...review, ...final].filter((item) => typeof item === "string" && item.trim()))];
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

export function normalizeJournal(record) {
  if (!record) {
    return {
      schemaVersion: 1,
      workflow: "build-artifact",
      state: "ready",
      status: "ready",
      accepted: null,
      title: "Ready for a guarded build",
      summary: "Ask Codex to create one local artifact through the six-phase workflow.",
      runId: null,
      workspace: null,
      outputPath: null,
      absoluteOutputPath: null,
      sourceHash: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      findings: [],
      reviewFindingCount: 0,
      workerCount: 0,
      completedWorkerCount: 0,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
      phases: DEFAULT_PHASES.map((phase) => ({ ...phase, status: "pending", workerCount: 0 })),
    };
  }

  const result = isPlainObject(record.result) ? record.result : {};
  const accepted = record.status === "completed" && result.accepted === true;
  const state = record.status === "running" ? "running" : accepted ? "accepted" : "failed";
  const phases = Array.isArray(record.meta?.phases) && record.meta.phases.length
    ? record.meta.phases
    : DEFAULT_PHASES;
  const workers = Array.isArray(record.workers) ? record.workers : [];
  const findings = findingList(record);
  const usage = isPlainObject(record.aggregate_usage) ? record.aggregate_usage : {};
  const framedOutputPath = Array.isArray(record.events)
    ? record.events.find((event) => event?.type === "log" && typeof event?.data?.output_path === "string")?.data?.output_path
    : null;
  const outputPath = typeof result.output_path === "string" ? result.output_path : framedOutputPath || null;
  const recordError = typeof record.error === "string" ? record.error : record.error?.message;
  const summary = state === "accepted"
    ? `Accepted ${outputPath || "the requested artifact"} after independent build, review, and verification.`
    : state === "running"
      ? "The guarded workflow is still running."
      : findings[0] || recordError || "The workflow did not satisfy its final acceptance checks.";

  return {
    schemaVersion: 1,
    workflow: "build-artifact",
    state,
    status: record.status || "unknown",
    accepted,
    title: state === "accepted" ? "Artifact accepted" : state === "running" ? "Workflow running" : "Workflow blocked",
    summary,
    runId: record.id || null,
    task: typeof result.task === "string" ? result.task : null,
    workspace: typeof record.cwd === "string" ? record.cwd : null,
    outputPath,
    absoluteOutputPath: outputPath && typeof record.cwd === "string" ? path.join(record.cwd, outputPath) : null,
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

async function assertTrustedJournal(record, { workflowPath, workflowHash, expectedWorkspace } = {}) {
  if (!validRunId(record.id)) throw new Error("The journal has an invalid run id.");
  const resolvedSource = await realpath(record.source_path);
  const resolvedWorkflow = await realpath(workflowPath);
  if (resolvedSource !== resolvedWorkflow) throw new Error("The journal did not use the bundled workflow source.");
  if (record.source_hash !== workflowHash || record.definition_ref?.source_hash !== workflowHash) {
    throw new Error("The workflow definition hash does not match the bundled source.");
  }
  if (record.definition_ref?.scope !== "path") throw new Error("The workflow was not launched by exact source path.");
  if (expectedWorkspace && (await realpath(record.cwd)) !== expectedWorkspace) {
    throw new Error("The journal workspace does not match the requested workspace.");
  }
}

function assertAcceptanceEvidence(record, request) {
  const result = record.result;
  if (record.status !== "completed" || result?.accepted !== true) {
    throw new Error("The workflow did not return an accepted final result.");
  }
  if (result.output_path !== request.output_path) throw new Error("The journal output path does not match the request.");
  if (Number(result.framing_workers_completed) < request.scouts) throw new Error("The framing evidence is incomplete.");
  if (Number(result.reviewers_completed) < 2) throw new Error("The reviewer evidence is incomplete.");
  const verification = result.final_verification;
  if (
    !isPlainObject(verification) ||
    !Array.isArray(verification.findings) ||
    verification.findings.length !== 0 ||
    !Array.isArray(verification.verification) ||
    verification.verification.length === 0
  ) {
    throw new Error("The final verification evidence is incomplete or contains blocking findings.");
  }
  const workers = Array.isArray(record.workers) ? record.workers : [];
  if (workers.length < request.scouts + 5 || workers.some((worker) => worker?.status !== "completed")) {
    throw new Error("One or more required workers did not complete.");
  }
  for (const label of ["planner", "builder", "brief-reviewer", "quality-reviewer", "final-verifier"]) {
    if (!workers.some((worker) => worker?.label === label)) throw new Error(`Required worker evidence is missing: ${label}.`);
  }
  const builder = workers.find((worker) => worker?.label === "builder")?.result;
  if (!isPlainObject(builder) || !Array.isArray(builder.verification) || builder.verification.length === 0 || builder.findings?.length) {
    throw new Error("The builder did not provide clean structured verification evidence.");
  }
  if (Array.isArray(result.review_findings) && result.review_findings.length) {
    const repairer = workers.find((worker) => worker?.label === "repairer")?.result;
    if (!isPlainObject(repairer) || !Array.isArray(repairer.verification) || repairer.verification.length === 0 || repairer.findings?.length) {
      throw new Error("Review findings were present without clean repair evidence.");
    }
  }
}

export async function runBuildArtifact(rawArguments, options = {}) {
  const request = validateRunArguments(rawArguments);
  const guard = await resolveGuardedOutput(request.workspace, request.output_path);
  const environment = { ...process.env, ...(options.environment || {}) };
  const codexHome = options.codexHome || codexHomeFor(environment);
  const workflowPath = options.workflowPath || WORKFLOW_SOURCE_PATH;
  const workerRunner = options.workerRunner || WORKER_RUNNER_PATH;
  const ultracodeBin = options.ultracodeBin || ultracodeBinaryFor(environment);
  const codexRealBin = options.codexRealBin || DEFAULT_CODEX_REAL_BIN;
  const executor = options.executeFile || executeFile;

  await access(workflowPath, fsConstants.R_OK);
  await access(workerRunner, fsConstants.R_OK | fsConstants.X_OK);
  await access(ultracodeBin, fsConstants.R_OK | fsConstants.X_OK);
  await access(codexRealBin, fsConstants.R_OK | fsConstants.X_OK);
  const workflowHash = await sha256File(workflowPath);

  const workflowArguments = {
    task: request.task,
    output_path: request.output_path,
    artifact_type: request.artifact_type,
    constraints: request.constraints,
    source_context: request.source_context,
    scouts: request.scouts,
    allow_research: false,
  };
  for (const [key, value] of Object.entries(workflowArguments)) {
    if (value === undefined) delete workflowArguments[key];
  }

  const childEnvironment = {
    ...environment,
    HOME: environment.HOME || os.homedir(),
    CODEX_HOME: codexHome,
    PATH: [path.dirname(workerRunner), path.join(environment.HOME || os.homedir(), ".local", "bin"), environment.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    ULTRACODE_WORKSPACE_ROOT: guard.workspace,
    ULTRACODE_ALLOWED_OUTPUT: guard.target,
    ULTRACODE_NO_AUTO_UPDATE: "1",
    ULTRACODE_UI: "0",
    CODEX_REAL_BIN: codexRealBin,
  };

  const child = await executor(
    ultracodeBin,
    [
      `@${workflowPath}`,
      "--cwd",
      guard.workspace,
      "--codex-home",
      codexHome,
      "--args",
      JSON.stringify(workflowArguments),
      "--concurrency",
      "2",
      "--max-agents",
      "10",
      "--max-retries",
      "1",
      "--no-auto-update",
      "--no-ui",
    ],
    {
      cwd: guard.workspace,
      env: childEnvironment,
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );

  const returnedRecord = parseRecordOutput(child.stdout);
  const statePath = journalPathFor(codexHome, returnedRecord.id);
  const journal = await readJson(statePath);
  if (journal.id !== returnedRecord.id) throw new Error("The returned run id does not match its journal.");
  await assertTrustedJournal(journal, {
    workflowPath,
    workflowHash,
    expectedWorkspace: guard.workspace,
  });

  const normalized = normalizeJournal(journal);
  if (child.exitCode !== 0) {
    return {
      ...normalized,
      state: "failed",
      accepted: false,
      title: "Workflow process failed",
      summary: child.stderr.trim().slice(-1_500) || `Ultracode exited with status ${child.exitCode}.`,
    };
  }
  if (!normalized.accepted) return normalized;

  assertAcceptanceEvidence(journal, request);
  const output = await verifyOutputFile(guard.target, guard.workspace);
  return { ...normalized, output };
}

async function trustedWorkflowContext(options = {}) {
  const environment = { ...process.env, ...(options.environment || {}) };
  const codexHome = options.codexHome || codexHomeFor(environment);
  const workflowPath = options.workflowPath || WORKFLOW_SOURCE_PATH;
  return { codexHome, workflowPath, workflowHash: await sha256File(workflowPath) };
}

export async function getWorkflowRun(runId, options = {}) {
  const context = await trustedWorkflowContext(options);
  const journal = await readJson(journalPathFor(context.codexHome, runId));
  await assertTrustedJournal(journal, context);
  return normalizeJournal(journal);
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
      const journal = await readJson(path.join(runsDir, name));
      await assertTrustedJournal(journal, context);
      return normalizeJournal(journal);
    } catch {
      // Ignore unrelated, stale, or malformed Ultracode journals.
    }
  }
  return normalizeJournal(null);
}
