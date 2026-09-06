import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, link, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  compareWorkspaceSnapshots,
  resolveGuardedWorkspace,
  snapshotWorkspace,
} from "../src/workspace-guard.mjs";

const execFileP = promisify(execFile);

async function git(cwd, ...args) {
  const result = await execFileP("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function temporaryGitWorkspace(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-snapshot-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, ".gitignore"), "node_modules/\n");
  await writeFile(path.join(workspace, "src", "feature.js"), "export const feature = false;\n");
  await git(workspace, "init");
  await git(workspace, "config", "user.name", "Workflow Studio Tests");
  await git(workspace, "config", "user.email", "workflow-studio@example.invalid");
  await git(workspace, "add", ".");
  await git(workspace, "commit", "-m", "fixture");
  return workspace;
}

async function createFiles(directory, count) {
  let next = 0;
  const workers = Array.from({ length: 16 }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= count) return;
      await writeFile(path.join(directory, `fixture-${index}.txt`), "fixture\n");
    }
  });
  await Promise.all(workers);
}

test("scalable snapshots compact a large ignored tree and detect ignored mutation without following links", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const ignoredDirectory = path.join(workspace, "node_modules", "fixture");
  await mkdir(ignoredDirectory, { recursive: true });
  await createFiles(ignoredDirectory, 20_001);

  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-snapshot-external-"));
  t.after(() => rm(externalDirectory, { recursive: true, force: true }));
  const externalFile = path.join(externalDirectory, "outside.txt");
  await writeFile(externalFile, "outside-before\n");
  await symlink(externalFile, path.join(ignoredDirectory, "outside-link"));

  const guard = await resolveGuardedWorkspace(workspace, ["src"]);
  const started = performance.now();
  const before = await snapshotWorkspace(guard);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 30_000, `large ignored fixture took ${Math.round(elapsed)}ms to snapshot`);
  assert.equal(before.entries.has("node_modules"), true);
  assert.equal([...before.entries.keys()].some((entry) => entry.startsWith("node_modules/")), false);

  await writeFile(externalFile, "outside-after\n");
  const afterExternalMutation = await snapshotWorkspace(guard);
  assert.deepEqual(compareWorkspaceSnapshots(before, afterExternalMutation), []);

  await writeFile(path.join(ignoredDirectory, "fixture-10000.txt"), "changed\n");
  const afterIgnoredMutation = await snapshotWorkspace(guard);
  assert.deepEqual(compareWorkspaceSnapshots(before, afterIgnoredMutation).map((entry) => entry.path), ["node_modules"]);
});

test("scoped snapshots reject symbolic and hard links recursively", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  const guard = await resolveGuardedWorkspace(workspace, ["src"]);
  const external = path.join(workspace, "outside.txt");
  await writeFile(external, "outside\n");

  await symlink(external, path.join(workspace, "src", "linked.js"));
  await assert.rejects(() => snapshotWorkspace(guard), /Authorized write scope contains a symbolic link/);
  await rm(path.join(workspace, "src", "linked.js"));

  await link(external, path.join(workspace, "src", "hard-linked.js"));
  await assert.rejects(() => snapshotWorkspace(guard), /Authorized write scope contains a hard-linked file/);
});

test("ignored ancestor aggregates reserve missing authorized descendants", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  await mkdir(path.join(workspace, "node_modules"), { recursive: true });
  await writeFile(path.join(workspace, "node_modules", "dependency.txt"), "dependency\n");

  const guard = await resolveGuardedWorkspace(workspace, ["node_modules/generated"]);
  const before = await snapshotWorkspace(guard);
  await mkdir(path.join(workspace, "node_modules", "generated"));
  await writeFile(path.join(workspace, "node_modules", "generated", "output.txt"), "generated\n");
  const after = await snapshotWorkspace(guard);

  assert.deepEqual(compareWorkspaceSnapshots(before, after).map((entry) => entry.path), [
    "node_modules/generated/output.txt",
  ]);
});

test("ignored roots inside a broader authorized scope stay per-file", async (t) => {
  const workspace = await temporaryGitWorkspace(t);
  await writeFile(path.join(workspace, ".gitignore"), "node_modules/\nsrc/cache/\n");
  await git(workspace, "add", ".gitignore");
  await git(workspace, "commit", "-m", "ignore scoped cache");
  await mkdir(path.join(workspace, "src", "cache"));
  const ignoredFile = path.join(workspace, "src", "cache", "ignored.txt");
  await writeFile(ignoredFile, "before\n");

  const guard = await resolveGuardedWorkspace(workspace, ["src"]);
  const before = await snapshotWorkspace(guard);
  assert.equal(before.entries.has("src/cache"), false);
  await writeFile(ignoredFile, "after\n");
  const after = await snapshotWorkspace(guard);

  assert.deepEqual(compareWorkspaceSnapshots(before, after).map((entry) => entry.path), ["src/cache/ignored.txt"]);
});
