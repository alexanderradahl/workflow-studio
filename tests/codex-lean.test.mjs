import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileP = promisify(execFile);
const wrapper = new URL("../scripts/codex-lean", import.meta.url).pathname;

test("worker wrapper applies host-generated multi-path permissions and preserves repository rules", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-wrapper-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const codexHome = path.join(home, ".codex");
  const workspace = path.join(root, "workspace");
  const capture = path.join(root, "captured.json");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  const poisonedPath = path.join(root, "untrusted-bin");
  await mkdir(codexHome, { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "tests"), { recursive: true });
  await mkdir(poisonedPath, { recursive: true });
  await writeFile(path.join(codexHome, "auth.json"), "{}\n");
  await writeFile(
    fakeCodex,
    "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), path: process.env.PATH }));\n",
  );
  await chmod(fakeCodex, 0o755);
  await execFileP(wrapper, [
    "exec",
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="never"',
    "-c",
    'model_reasoning_effort="medium"',
    "--cd",
    workspace,
    "--json",
    "task",
  ], {
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_REAL_BIN: fakeCodex,
      CAPTURE_PATH: capture,
      PATH: `${poisonedPath}:${process.env.PATH}`,
      ULTRACODE_LEAN_USER_HOME: path.join(root, "lean"),
      ULTRACODE_WORKSPACE_ROOT: workspace,
      ULTRACODE_ALLOWED_WRITE_PATHS_JSON: JSON.stringify([
        path.join(workspace, "src"),
        path.join(workspace, "tests"),
      ]),
      ULTRACODE_PERMISSIONS_OVERRIDE: 'web_search="live"',
      ULTRACODE_RESPECT_WORKSPACE_RULES: "1",
    },
  });

  const captured = JSON.parse(await readFile(capture, "utf8"));
  const { argv } = captured;
  assert.equal(argv[0], "exec");
  assert.equal(argv.includes("--ignore-user-config"), true);
  assert.equal(argv.includes("--ignore-rules"), false);
  assert.equal(argv.includes("--sandbox"), false);
  assert.equal(argv.includes("workspace-write"), false);
  assert.equal(argv.includes('model_reasoning_effort="medium"'), true);
  const permissionConfig = argv.find((value) => value.startsWith("permissions={ artifact_guard="));
  assert.match(permissionConfig, /enabled=false/);
  assert.match(permissionConfig, /\/System\/Library\/OpenSSL/);
  assert.match(permissionConfig, new RegExp(path.join(workspace, "src").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(permissionConfig, new RegExp(path.join(workspace, "tests").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(permissionConfig.includes('web_search="live"'), false);
  assert.equal(argv.includes('default_permissions="artifact_guard"'), true);
  assert.equal(argv.includes('web_search="disabled"'), true);
  assert.equal(captured.path.split(path.delimiter).includes(poisonedPath), false);
  assert.equal(captured.path.split(path.delimiter).includes("/usr/bin"), true);
});

test("worker wrapper rejects caller configuration that could override the guard", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-wrapper-poison-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const codexHome = path.join(home, ".codex");
  const workspace = path.join(root, "workspace");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await mkdir(codexHome, { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(codexHome, "auth.json"), "{}\n");
  await writeFile(fakeCodex, "#!/usr/bin/env node\nprocess.exit(0);\n");
  await chmod(fakeCodex, 0o755);

  await assert.rejects(
    () => execFileP(
      wrapper,
      ["exec", "--sandbox", "workspace-write", "-c", 'web_search="live"', "--json", "task"],
      {
        env: {
          ...process.env,
          HOME: home,
          CODEX_HOME: codexHome,
          CODEX_REAL_BIN: fakeCodex,
          ULTRACODE_LEAN_USER_HOME: path.join(root, "lean"),
          ULTRACODE_WORKSPACE_ROOT: workspace,
          ULTRACODE_ALLOWED_WRITE_PATHS_JSON: JSON.stringify([path.join(workspace, "src")]),
        },
      },
    ),
    (error) => /reject caller-supplied Codex configuration/.test(error.stderr),
  );

  const guardedEnv = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_REAL_BIN: fakeCodex,
    ULTRACODE_LEAN_USER_HOME: path.join(root, "lean"),
    ULTRACODE_WORKSPACE_ROOT: workspace,
    ULTRACODE_ALLOWED_WRITE_PATHS_JSON: JSON.stringify([path.join(workspace, "src")]),
  };
  const attachedOverrides = [
    {
      args: ["-cweb_search=\"live\""],
      error: /reject caller-supplied Codex configuration/,
    },
    {
      args: [`-C${root}`],
      error: /reject attached working-directory overrides/,
    },
    {
      args: ["-pattacker"],
      error: /reject profile, add-dir, and provider overrides/,
    },
    {
      args: ["-sread-only"],
      error: /reject attached sandbox overrides/,
    },
  ];
  for (const override of attachedOverrides) {
    await assert.rejects(
      () => execFileP(
        wrapper,
        ["exec", "--sandbox", "workspace-write", "--cd", workspace, ...override.args, "--json", "task"],
        { env: guardedEnv },
      ),
      (error) => override.error.test(error.stderr),
    );
  }
});

test("worker permissions allow linked Git metadata and exact ancestor discovery files read-only", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "workflow-studio-linked-wrapper-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const repository = path.join(root, "repository");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex/auth.json"), "{}\n");
  await mkdir(repository);
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "AGENTS.md"), "Fixture instructions\n");
  const git = (...args) => execFileP("git", ["-C", repository, ...args]);
  await git("init");
  await writeFile(path.join(repository, "source.js"), "// fixture\n");
  await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  await git("worktree", "add", "--detach", workspace);
  const capture = path.join(root, "captured.json");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await writeFile(fakeCodex, "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CAPTURE_PATH, JSON.stringify({ argv: process.argv.slice(2), locks: process.env.GIT_OPTIONAL_LOCKS }));\n");
  await chmod(fakeCodex, 0o755);
  await execFileP(wrapper, ["exec", "--sandbox", "read-only", "--cd", workspace, "--json", "inspect"], {
    env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, ".codex"), CODEX_REAL_BIN: fakeCodex,
      CAPTURE_PATH: capture, ULTRACODE_LEAN_USER_HOME: path.join(root, "lean"),
      ULTRACODE_WORKSPACE_ROOT: workspace, ULTRACODE_RESPECT_WORKSPACE_RULES: "1" },
  });
  const captured = JSON.parse(await readFile(capture, "utf8"));
  const permissions = captured.argv.find((arg) => arg.startsWith("permissions={"));
  for (const target of [path.join(repository, ".git"), path.join(repository, ".git/worktrees/workspace"), path.join(root, "package.json"), path.join(root, "AGENTS.md")]) {
    assert.ok(permissions.includes(`${JSON.stringify(target)}="read"`), `missing exact read access for ${target}`);
    assert.ok(!permissions.includes(`${JSON.stringify(target)}="write"`));
  }
  assert.equal(captured.locks, "0");
  assert.ok(!permissions.includes(`${JSON.stringify(root)}="read"`), "do not grant the entire ancestor directory");
});
