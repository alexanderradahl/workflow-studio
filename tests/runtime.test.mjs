import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, link, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  WORKSPACE_WORKFLOW_SOURCE_PATH,
  WORKFLOW_SOURCE_PATH,
  compareWorkspaceSnapshots,
  getLatestWorkflowRun,
  getWorkflowRun,
  normalizeJournal,
  resolveGuardedOutput,
  resolveGuardedWorkspace,
  runBuildArtifact,
  runWorkspaceWorkflow,
  sha256File,
  snapshotWorkspace,
  validateRunArguments,
  validateWorkspaceRunArguments,
} from "../src/runtime.mjs";

const execFileP = promisify(execFile);

async function temporaryWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "artifacts"));
  return root;
}

async function git(cwd, ...args) {
  const result = await execFileP("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function temporaryGitWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-git-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "tests"));
  await writeFile(path.join(root, "src", "feature.js"), "export const feature = false;\n");
  await writeFile(path.join(root, "tests", "feature.test.js"), "// pending\n");
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await git(root, "init");
  await git(root, "config", "user.name", "Workflow Studio Tests");
  await git(root, "config", "user.email", "workflow-studio@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  return root;
}

function structured(findings = []) {
  return {
    summary: "complete",
    findings,
    recommended_actions: [],
    risks: [],
    verification: ["checked"],
    confidence: "high",
  };
}

function workspaceStructured(blockingFindings = []) {
  return {
    summary: "complete",
    blocking_findings: blockingFindings,
    recommended_actions: [],
    risks: [],
    verification: ["checked"],
    confidence: "high",
  };
}

function refreshHostDigest(record) {
  const withoutEvidence = { ...record };
  delete withoutEvidence.workflow_studio;
  record.workflow_studio.journal_digest_before = createHash("sha256")
    .update(JSON.stringify(withoutEvidence))
    .digest("hex");
  return record;
}

function workspaceJournal({ runId, workspace, codexHome, workflowHash, changedPaths, plannedPaths = changedPaths }) {
  const workers = [
    { label: "requirements", phase: "Discover", result: structured() },
    { label: "architecture", phase: "Discover", result: structured() },
    {
      label: "planner",
      phase: "Plan",
      result: { ...structured(), planned_paths: plannedPaths, acceptance_criteria: ["works"], validation: ["test"] },
    },
    { label: "implementer", phase: "Implement", result: { ...workspaceStructured(), changed_paths: changedPaths } },
    { label: "requirements-reviewer", phase: "Review", result: structured() },
    { label: "quality-reviewer", phase: "Review", result: structured() },
    { label: "final-verifier", phase: "Verify", result: { ...workspaceStructured(), verified_paths: changedPaths } },
  ].map((worker, index) => ({ id: `worker-${index + 1}`, status: "completed", ...worker }));
  return {
    id: runId,
    name: "Workspace Change",
    status: "completed",
    started_at: "2026-08-30T03:00:00.000Z",
    completed_at: "2026-08-30T03:00:02.000Z",
    duration_ms: 2000,
    cwd: workspace,
    state_path: path.join(codexHome, "ultracode", "runs", `${runId}.json`),
    source_path: WORKSPACE_WORKFLOW_SOURCE_PATH,
    source_hash: workflowHash,
    definition_ref: {
      id: "change-workspace",
      name: "Change Workspace",
      scope: "path",
      path: WORKSPACE_WORKFLOW_SOURCE_PATH,
      source_hash: workflowHash,
    },
    meta: {
      phases: ["Discover", "Plan", "Implement", "Review", "Repair", "Verify"].map((title) => ({
        title,
        detail: title,
      })),
    },
    workers,
    events: ["Discover", "Plan", "Implement", "Review", "Repair", "Verify"].map((phase) => ({
      type: "log",
      message: `phase: ${phase}`,
    })),
    aggregate_usage: { total_tokens: 321 },
    result: {
      accepted: true,
      task: "Implement the feature",
      write_paths: ["src", "tests"],
      planned_paths: plannedPaths,
      changed_paths: changedPaths,
      verified_paths: changedPaths,
      framing_workers_completed: 2,
      reviewers_completed: 2,
      review_findings: [],
      implementation_report: workers.find((worker) => worker.label === "implementer").result,
      repair_report: {
        ...workspaceStructured(),
        summary: "No repair needed.",
        changed_paths: [],
      },
      final_verification: workers.find((worker) => worker.label === "final-verifier").result,
    },
  };
}

test("run argument validation is fixed and bounded", () => {
  assert.deepEqual(
    validateRunArguments({
      task: "Create a note",
      workspace: "/tmp/example",
      output_path: "notes/result.md",
      scouts: 4,
    }),
    {
      task: "Create a note",
      workspace: "/tmp/example",
      output_path: "notes/result.md",
      artifact_type: undefined,
      constraints: [],
      source_context: undefined,
      scouts: 4,
    },
  );
  assert.throws(
    () => validateRunArguments({ task: "x", workspace: "/tmp", output_path: "x.md", command: "rm" }),
    /Unsupported workflow argument/,
  );
  assert.throws(
    () => validateRunArguments({ task: "x", workspace: "/tmp", output_path: "x.md", scouts: 5 }),
    /scouts must be an integer/,
  );
});

test("output guards reject traversal, missing parents, symlinks, and hard links", async (t) => {
  const workspace = await temporaryWorkspace(t);
  await assert.rejects(() => resolveGuardedOutput(workspace, "../escape.md"), /normalized relative/);
  await assert.rejects(() => resolveGuardedOutput(workspace, ".git/config"), /normalized relative/);
  await assert.rejects(() => resolveGuardedOutput(workspace, "missing/output.md"), /parent directory must already exist/);

  const external = path.join(workspace, "external.md");
  await writeFile(external, "external");
  await symlink(external, path.join(workspace, "artifacts", "symlink.md"));
  await assert.rejects(() => resolveGuardedOutput(workspace, "artifacts/symlink.md"), /symbolic link/);

  await link(external, path.join(workspace, "artifacts", "hardlink.md"));
  await assert.rejects(() => resolveGuardedOutput(workspace, "artifacts/hardlink.md"), /hard-linked/);

  const valid = await resolveGuardedOutput(workspace, "artifacts/result.md");
  const resolvedWorkspace = await realpath(workspace);
  assert.equal(valid.outputPath, "artifacts/result.md");
  assert.equal(valid.target, path.join(resolvedWorkspace, "artifacts", "result.md"));
});

test("workspace arguments and write scopes are fixed, bounded, and Git-rooted", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  assert.deepEqual(
    validateWorkspaceRunArguments({
      task: "Implement a feature",
      workspace,
      write_paths: ["src", "tests/feature.test.js"],
      scouts: 3,
    }),
    {
      task: "Implement a feature",
      workspace,
      write_paths: ["src", "tests/feature.test.js"],
      constraints: [],
      source_context: undefined,
      scouts: 3,
    },
  );
  assert.throws(
    () => validateWorkspaceRunArguments({ task: "x", workspace, write_paths: ["src"], command: "rm" }),
    /Unsupported workspace workflow argument/,
  );
  assert.throws(
    () => validateWorkspaceRunArguments({ task: "x", workspace, write_paths: [] }),
    /1 through 32/,
  );

  const guard = await resolveGuardedWorkspace(workspace, ["src", "tests/new-suite"]);
  assert.equal(guard.workspace, await realpath(workspace));
  assert.deepEqual(guard.writePaths, ["src", "tests/new-suite"]);
  assert.equal(guard.targets.length, 2);

  await assert.rejects(() => resolveGuardedWorkspace(workspace, ["."]), /workspace root/);
  await assert.rejects(() => resolveGuardedWorkspace(workspace, [".git/config"]), /.git/);
  await assert.rejects(() => resolveGuardedWorkspace(workspace, ["../outside"]), /normalized relative/);
  await assert.rejects(() => resolveGuardedWorkspace(workspace, ["missing/deep/file.js"]), /missing parent/);

  await symlink(path.join(workspace, "src"), path.join(workspace, "linked-src"));
  await assert.rejects(() => resolveGuardedWorkspace(workspace, ["linked-src"]), /symbolic link/);

  const hardlink = path.join(workspace, "hardlinked.js");
  await link(path.join(workspace, "src", "feature.js"), hardlink);
  await assert.rejects(() => resolveGuardedWorkspace(workspace, ["hardlinked.js"]), /hard-linked/);

  await assert.rejects(() => resolveGuardedWorkspace(path.join(workspace, "src"), ["feature.js"]), /Git worktree root/);
});

test("workspace snapshots detect ignored changes outside authorized scopes", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  await writeFile(path.join(workspace, ".gitignore"), "secret.env\n");
  await git(workspace, "add", ".gitignore");
  await git(workspace, "commit", "-m", "ignore fixture secret");
  await writeFile(path.join(workspace, "secret.env"), "before\n");
  const guard = await resolveGuardedWorkspace(workspace, ["src"]);
  const before = await snapshotWorkspace(guard);
  await writeFile(path.join(workspace, "secret.env"), "after\n");
  const after = await snapshotWorkspace(guard);
  assert.deepEqual(compareWorkspaceSnapshots(before, after).map((file) => file.path), ["secret.env"]);
});

test("journal normalization exposes bounded visual state", () => {
  const state = normalizeJournal({
    id: "ultra-20260830020000-abcdef-artifact",
    status: "completed",
    cwd: "/tmp/workspace",
    source_hash: "abc123",
    started_at: "2026-08-30T02:00:00.000Z",
    completed_at: "2026-08-30T02:00:01.000Z",
    duration_ms: 1000,
    meta: { phases: [{ title: "Frame", detail: "Frame the brief." }] },
    workers: [{ status: "completed", phase: "Frame" }],
    events: [{ type: "log", message: "phase: Frame" }],
    aggregate_usage: { total_tokens: 42 },
    result: {
      accepted: true,
      task: "Create a note",
      output_path: "note.md",
      review_findings: [],
      final_verification: { findings: [], verification: ["checked"] },
    },
  });
  assert.equal(state.state, "accepted");
  assert.equal(state.outputPath, "note.md");
  assert.equal(state.phases[0].status, "completed");
  assert.equal(state.usage.totalTokens, 42);
  assert.equal("workers" in state, false, "worker prompts/results must not leak into the widget payload");
});

test("journal normalization preserves legacy output and exposes multi-file evidence", () => {
  const legacy = normalizeJournal({
    id: "ultra-20260830020000-abcdef-artifact",
    status: "completed",
    cwd: "/tmp/workspace",
    result: {
      accepted: true,
      output_path: "note.md",
      review_findings: [],
      final_verification: { findings: [], verification: ["checked"] },
    },
  });
  assert.deepEqual(legacy.files, [
    { path: "note.md", planned: true, changed: true, verified: true, status: "modified" },
  ]);
  assert.deepEqual(legacy.fileCounts, { planned: 1, changed: 1, verified: 1 });

  const workspace = normalizeJournal({
    id: "ultra-20260830030000-abcdef-workspace",
    status: "completed",
    cwd: "/tmp/workspace",
    definition_ref: { id: "change-workspace" },
    result: {
      accepted: true,
      write_paths: ["src", "tests"],
      planned_paths: ["src/feature.js", "tests/feature.test.js", "docs/plan.md"],
      changed_paths: ["src/feature.js", "tests/feature.test.js"],
      verified_paths: ["src/feature.js", "tests/feature.test.js"],
      review_findings: [],
      final_verification: { findings: [], verification: ["checked"] },
    },
    workflow_studio: {
      schema_version: 1,
      workflow: "change-workspace",
      accepted: true,
      changed_files: [
        { path: "src/feature.js", status: "modified", before_hash: "a", after_hash: "b" },
        { path: "tests/feature.test.js", status: "modified", before_hash: "c", after_hash: "d" },
      ],
      blocking_findings: [],
    },
  });
  assert.equal(workspace.workflow, "change-workspace");
  assert.deepEqual(workspace.writePaths, ["src", "tests"]);
  assert.equal(workspace.outputPath, null);
  assert.deepEqual(workspace.fileCounts, { planned: 3, changed: 2, verified: 2 });
  assert.deepEqual(workspace.files.map((file) => file.path), [
    "docs/plan.md",
    "src/feature.js",
    "tests/feature.test.js",
  ]);
});

test("fixed runner flow verifies child controls, journal evidence, and exact output", async (t) => {
  const workspace = await temporaryWorkspace(t);
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-codex-home-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(path.join(codexHome, "ultracode", "runs"), { recursive: true });
  const resolvedWorkspace = await realpath(workspace);
  const workflowHash = await sha256File(WORKFLOW_SOURCE_PATH);
  const runId = "ultra-20260830020100-abcdef-artifact";

  const fakeExecutor = async (file, argv, options) => {
    assert.equal(file, "/usr/bin/true");
    assert.equal(argv[0], `@${WORKFLOW_SOURCE_PATH}`);
    assert.equal(argv.includes("--no-auto-update"), true);
    assert.equal(argv.includes("--no-ui"), true);
    assert.equal(options.env.ULTRACODE_WORKSPACE_ROOT, resolvedWorkspace);
    assert.equal(options.env.ULTRACODE_ALLOWED_OUTPUT, path.join(resolvedWorkspace, "artifacts", "result.md"));
    assert.equal(options.env.CODEX_REAL_BIN, "/usr/bin/true");
    assert.match(options.env.PATH, /workflow-studio\/scripts/);
    await writeFile(path.join(workspace, "artifacts", "result.md"), "# Accepted\n");

    const structured = (findings = []) => ({
      summary: "complete",
      findings,
      recommended_actions: [],
      risks: [],
      verification: ["checked"],
      confidence: "high",
    });
    const workers = [
      ["requirements", "Frame"],
      ["structure", "Frame"],
      ["planner", "Plan"],
      ["builder", "Build"],
      ["brief-reviewer", "Review"],
      ["quality-reviewer", "Review"],
      ["final-verifier", "Verify"],
    ].map(([label, phase], index) => ({
      id: `worker-${index + 1}`,
      label,
      phase,
      status: "completed",
      result: structured(),
    }));
    const journal = {
      id: runId,
      name: "Artifact",
      status: "completed",
      started_at: "2026-08-30T02:01:00.000Z",
      completed_at: "2026-08-30T02:01:01.000Z",
      duration_ms: 1000,
      cwd: resolvedWorkspace,
      state_path: path.join(codexHome, "ultracode", "runs", `${runId}.json`),
      source_path: WORKFLOW_SOURCE_PATH,
      source_hash: workflowHash,
      definition_ref: {
        id: "build-artifact",
        name: "Build Artifact",
        scope: "path",
        path: WORKFLOW_SOURCE_PATH,
        source_hash: workflowHash,
      },
      meta: { phases: [
        { title: "Frame", detail: "Frame" },
        { title: "Plan", detail: "Plan" },
        { title: "Build", detail: "Build" },
        { title: "Review", detail: "Review" },
        { title: "Repair", detail: "Repair" },
        { title: "Verify", detail: "Verify" },
      ] },
      workers,
      events: ["Frame", "Plan", "Build", "Review", "Repair", "Verify"].map((phase) => ({
        type: "log",
        message: `phase: ${phase}`,
      })),
      aggregate_usage: { total_tokens: 123 },
      result: {
        accepted: true,
        task: "Create a note",
        output_path: "artifacts/result.md",
        artifact_type: "Markdown",
        framing_workers_completed: 2,
        reviewers_completed: 2,
        build_report: workers.find((worker) => worker.label === "builder").result,
        review_findings: [],
        repair_report: "No repair needed.",
        final_verification: structured(),
      },
    };
    await writeFile(journal.state_path, JSON.stringify(journal));
    return { error: null, exitCode: 0, stderr: "", stdout: JSON.stringify(journal) };
  };

  const state = await runBuildArtifact(
    {
      task: "Create a note",
      workspace,
      output_path: "artifacts/result.md",
      artifact_type: "Markdown",
      constraints: ["No external actions"],
      scouts: 2,
    },
    {
      codexHome,
      ultracodeBin: "/usr/bin/true",
      codexRealBin: "/usr/bin/true",
      executeFile: fakeExecutor,
    },
  );

  assert.equal(state.accepted, true);
  assert.equal(state.runId, runId);
  assert.equal(state.output.size > 0, true);

  const trusted = await getWorkflowRun(runId, { codexHome });
  assert.equal(trusted.accepted, true);
  const journalPath = path.join(codexHome, "ultracode", "runs", `${runId}.json`);
  const persisted = JSON.parse(await readFile(journalPath, "utf8"));
  persisted.workers.find((worker) => worker.label === "final-verifier").result.findings = ["forged blocker"];
  await writeFile(journalPath, JSON.stringify(persisted));
  await assert.rejects(() => getWorkflowRun(runId, { codexHome }), /trusted bundled Workflow Studio definition/);
});

test("workspace runner accepts two authorized observed changes and persists host evidence", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-workspace-codex-home-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(path.join(codexHome, "ultracode", "runs"), { recursive: true });
  const resolvedWorkspace = await realpath(workspace);
  const workflowHash = await sha256File(WORKSPACE_WORKFLOW_SOURCE_PATH);
  const runId = "ultra-20260830030100-abcdef-workspace";
  const changedPaths = ["src/feature.js", "tests/feature.test.js"];

  const fakeExecutor = async (file, argv, options) => {
    assert.equal(file, "/usr/bin/true");
    assert.equal(argv[0], `@${WORKSPACE_WORKFLOW_SOURCE_PATH}`);
    assert.equal(options.env.ULTRACODE_WORKSPACE_ROOT, resolvedWorkspace);
    assert.equal(options.env.ULTRACODE_RESPECT_WORKSPACE_RULES, "1");
    assert.deepEqual(JSON.parse(options.env.ULTRACODE_ALLOWED_WRITE_PATHS_JSON), [
      path.join(resolvedWorkspace, "src"),
      path.join(resolvedWorkspace, "tests"),
    ]);
    assert.equal(options.env.ULTRACODE_PERMISSIONS_OVERRIDE, undefined);
    await writeFile(path.join(workspace, "src", "feature.js"), "export const feature = true;\n");
    await writeFile(path.join(workspace, "tests", "feature.test.js"), "// verified\n");
    const journal = workspaceJournal({ runId, workspace: resolvedWorkspace, codexHome, workflowHash, changedPaths });
    await writeFile(journal.state_path, JSON.stringify(journal));
    return { error: null, exitCode: 0, stderr: "", stdout: JSON.stringify(journal) };
  };

  const state = await runWorkspaceWorkflow(
    {
      task: "Implement the feature",
      workspace,
      write_paths: ["src", "tests"],
      constraints: ["Keep the change scoped"],
      scouts: 2,
    },
    {
      codexHome,
      ultracodeBin: "/usr/bin/true",
      codexRealBin: "/usr/bin/true",
      executeFile: fakeExecutor,
    },
  );

  assert.equal(state.accepted, true);
  assert.equal(state.runId, runId);
  assert.deepEqual(state.changedPaths, changedPaths);
  assert.deepEqual(state.fileCounts, { planned: 2, changed: 2, verified: 2 });
  const persisted = JSON.parse(await readFile(path.join(codexHome, "ultracode", "runs", `${runId}.json`), "utf8"));
  assert.equal(persisted.workflow_studio.accepted, true);
  assert.deepEqual(persisted.workflow_studio.changed_files.map((file) => file.path), changedPaths);

  const trusted = await getWorkflowRun(runId, { codexHome });
  assert.equal(trusted.accepted, true);
  assert.deepEqual(trusted.changedPaths, changedPaths);

  const unrelatedRunId = "ultra-zzzzzzzz-unknown";
  await writeFile(
    path.join(codexHome, "ultracode", "runs", `${unrelatedRunId}.json`),
    JSON.stringify({ id: unrelatedRunId, status: "completed", source_path: "/tmp/not-workflow-studio.js" }),
  );
  const latest = await getLatestWorkflowRun({ codexHome });
  assert.equal(latest.runId, runId, "latest lookup must ignore unrelated or untrusted journals");

  const forgedWorker = structuredClone(persisted);
  forgedWorker.workers.find((worker) => worker.label === "final-verifier").result.findings = ["unresolved blocker"];
  refreshHostDigest(forgedWorker);
  await writeFile(path.join(codexHome, "ultracode", "runs", `${runId}.json`), JSON.stringify(forgedWorker));
  await assert.rejects(() => getWorkflowRun(runId, { codexHome }), /trusted bundled Workflow Studio definition/);

  const duplicateRole = structuredClone(persisted);
  duplicateRole.workers[0].label = "planner";
  duplicateRole.workers[0].phase = "Plan";
  refreshHostDigest(duplicateRole);
  await writeFile(path.join(codexHome, "ultracode", "runs", `${runId}.json`), JSON.stringify(duplicateRole));
  await assert.rejects(() => getWorkflowRun(runId, { codexHome }), /trusted bundled Workflow Studio definition/);

  const wrongIdentity = structuredClone(persisted);
  wrongIdentity.definition_ref.id = "build-artifact";
  refreshHostDigest(wrongIdentity);
  await writeFile(path.join(codexHome, "ultracode", "runs", `${runId}.json`), JSON.stringify(wrongIdentity));
  await assert.rejects(() => getWorkflowRun(runId, { codexHome }), /trusted bundled Workflow Studio definition/);

  const mismatchedFileId = "ultra-zzzzzzzz-mismatched";
  await writeFile(
    path.join(codexHome, "ultracode", "runs", `${mismatchedFileId}.json`),
    JSON.stringify(persisted),
  );
  await assert.rejects(() => getWorkflowRun(mismatchedFileId, { codexHome }), /journal id does not match/i);
});

test("workspace runner rejects worker paths that do not match the observed authorized delta", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-mismatch-codex-home-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(path.join(codexHome, "ultracode", "runs"), { recursive: true });
  const resolvedWorkspace = await realpath(workspace);
  const workflowHash = await sha256File(WORKSPACE_WORKFLOW_SOURCE_PATH);
  const runId = "ultra-20260830030130-abcdef-workspace";

  const fakeExecutor = async () => {
    await writeFile(path.join(workspace, "src", "feature.js"), "export const feature = true;\n");
    await writeFile(path.join(workspace, "tests", "feature.test.js"), "// verified\n");
    const journal = workspaceJournal({
      runId,
      workspace: resolvedWorkspace,
      codexHome,
      workflowHash,
      changedPaths: ["src/feature.js"],
    });
    await writeFile(journal.state_path, JSON.stringify(journal));
    return { error: null, exitCode: 0, stderr: "", stdout: JSON.stringify(journal) };
  };

  const state = await runWorkspaceWorkflow(
    { task: "Implement the feature", workspace, write_paths: ["src", "tests"], scouts: 2 },
    {
      codexHome,
      ultracodeBin: "/usr/bin/true",
      codexRealBin: "/usr/bin/true",
      executeFile: fakeExecutor,
    },
  );
  assert.equal(state.accepted, false);
  assert.match(state.summary, /reported changed paths do not match the host-observed delta/i);
  assert.deepEqual(state.changedPaths, ["src/feature.js", "tests/feature.test.js"]);
});

test("workspace runner snapshots and persists partial changes when launch produces no journal", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-launch-failure-codex-home-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(path.join(codexHome, "ultracode", "runs"), { recursive: true });

  const fakeExecutor = async () => {
    await writeFile(path.join(workspace, "src", "feature.js"), "export const feature = 'partial';\n");
    return {
      error: new Error("compiler failed"),
      exitCode: 1,
      stdout: "",
      stderr: "Unsupported Claude workflow syntax: process is not available",
    };
  };

  const state = await runWorkspaceWorkflow(
    { task: "Implement the feature", workspace, write_paths: ["src"], scouts: 2 },
    {
      codexHome,
      ultracodeBin: "/usr/bin/true",
      codexRealBin: "/usr/bin/true",
      executeFile: fakeExecutor,
    },
  );
  assert.equal(state.accepted, false);
  assert.match(state.summary, /Unsupported Claude workflow syntax: process is not available/);
  assert.deepEqual(state.changedPaths, ["src/feature.js"]);
  assert.equal(state.runId, null, "an untrusted or missing child journal must not acquire a trusted run id");
});

test("workspace runner rejects an observed change outside the authorized scopes", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-outside-codex-home-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(path.join(codexHome, "ultracode", "runs"), { recursive: true });
  const resolvedWorkspace = await realpath(workspace);
  const workflowHash = await sha256File(WORKSPACE_WORKFLOW_SOURCE_PATH);
  const runId = "ultra-20260830030200-abcdef-workspace";
  const reportedPaths = ["src/feature.js"];

  const fakeExecutor = async () => {
    await writeFile(path.join(workspace, "src", "feature.js"), "export const feature = true;\n");
    await writeFile(path.join(workspace, "README.md"), "# Unauthorized change\n");
    const journal = workspaceJournal({
      runId,
      workspace: resolvedWorkspace,
      codexHome,
      workflowHash,
      changedPaths: reportedPaths,
      plannedPaths: reportedPaths,
    });
    journal.result.write_paths = ["src"];
    await writeFile(journal.state_path, JSON.stringify(journal));
    return { error: null, exitCode: 0, stderr: "", stdout: JSON.stringify(journal) };
  };

  const state = await runWorkspaceWorkflow(
    { task: "Implement the feature", workspace, write_paths: ["src"], scouts: 2 },
    {
      codexHome,
      ultracodeBin: "/usr/bin/true",
      codexRealBin: "/usr/bin/true",
      executeFile: fakeExecutor,
    },
  );
  assert.equal(state.accepted, false);
  assert.match(state.summary, /outside the authorized write scopes/i);
  assert.equal(state.files.some((file) => file.path === "README.md" && file.changed), true);
});
