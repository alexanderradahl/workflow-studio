// Opt-in native macOS check: requires installed Codex, but makes no model calls.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveCodexBinary } from "../src/runtime-dependencies.mjs";

const exec = promisify(execFile);
const codex = await resolveCodexBinary(process.env);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "workflow-studio-native-")));
try {
  const home = path.join(root, "home");
  const repository = path.join(root, "repository");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex/auth.json"), "{}\n");
  await mkdir(repository);
  await writeFile(path.join(repository, "allowed.txt"), "before\n");
  await writeFile(path.join(repository, "protected.txt"), "protected\n");
  const git = (...args) => exec("git", ["-C", repository, ...args]);
  await git("init");
  await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  await git("worktree", "add", "--detach", workspace);
  const capture = path.join(root, "result.json");
  const fakeCodex = path.join(root, "sandbox-driver.mjs");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const permissions = argv.find((arg) => arg.startsWith("permissions={"));
const probe = ${JSON.stringify(`
    const fs = require('node:fs');
    const {execFileSync} = require('node:child_process');
    const path = require('node:path');
    execFileSync('git', ['status', '--porcelain']);
    execFileSync('git', ['diff', '--', 'allowed.txt']);
    fs.writeFileSync('allowed.txt', 'after\\n');
    fs.writeFileSync(path.join(process.env.TMPDIR, 'cache.txt'), 'scratch');
    const denied = [];
    for (const target of ['protected.txt', ${JSON.stringify(path.join(repository, '.git/config'))}]) {
      try { fs.appendFileSync(target, 'forbidden'); }
      catch (error) { if (['EPERM', 'EACCES', 'EROFS'].includes(error.code)) denied.push(target); else throw error; }
    }
    process.stdout.write(JSON.stringify({denied}));
  `)};
const output = execFileSync(process.env.SANDBOX_CODEX, ['sandbox', '-c', permissions, '-P', 'artifact_guard', '-C', process.env.ULTRACODE_WORKSPACE_ROOT, process.execPath, '-e', probe], {encoding:'utf8'});
writeFileSync(process.env.CAPTURE_PATH, output);
`);
  await chmod(fakeCodex, 0o755);
  await exec(new URL("../scripts/codex-lean", import.meta.url).pathname,
    ["exec", "--sandbox", "workspace-write", "--cd", workspace, "probe"], {
      env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, ".codex"), CODEX_REAL_BIN: fakeCodex,
        SANDBOX_CODEX: codex, CAPTURE_PATH: capture, ULTRACODE_WORKSPACE_ROOT: workspace,
        ULTRACODE_LEAN_USER_HOME: path.join(root, "lean"),
        ULTRACODE_ALLOWED_WRITE_PATHS_JSON: JSON.stringify([path.join(workspace, "allowed.txt")]),
        ULTRACODE_RESPECT_WORKSPACE_RULES: "1" },
    });
  assert.equal(JSON.parse(await readFile(capture, "utf8")).denied.length, 2);
  assert.equal(await readFile(path.join(workspace, "allowed.txt"), "utf8"), "after\n");
  assert.equal(await readFile(path.join(workspace, "protected.txt"), "utf8"), "protected\n");
  console.log("Native sandbox passed: linked Git reads, scoped writes and private scratch work; sibling and Git metadata writes denied.");
} finally {
  await rm(root, { recursive: true, force: true });
}
