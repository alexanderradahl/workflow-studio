import assert from "node:assert/strict";
import { mkdtemp, mkdir, link, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  WORKFLOW_SOURCE_PATH,
  normalizeJournal,
  resolveGuardedOutput,
  runBuildArtifact,
  sha256File,
  validateRunArguments,
} from "../src/runtime.mjs";

async function temporaryWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "artifacts"));
  return root;
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
        review_findings: [],
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
});
