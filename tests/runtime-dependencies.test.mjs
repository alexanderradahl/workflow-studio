import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveCodexBinary, resolveUltracodeCli } from "../src/runtime-dependencies.mjs";

test("Codex discovery uses an installed PATH executable without a fixed app location", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "codex");
  await writeFile(binary, "#!/bin/sh\nexit 0\n");
  await chmod(binary, 0o755);
  assert.equal(await resolveCodexBinary({ PATH: `relative:${root}` }), await realpath(binary));
});

test("Ultracode discovery works without a private shell helper and reports missing installation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-studio-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => resolveUltracodeCli(root), /codex plugin add ultracode@just-every/);
  for (const version of ["0.3.9", "0.3.10", "0.4.0"]) {
    const scripts = path.join(root, "plugins/cache/just-every/ultracode", version, "scripts");
    await mkdir(scripts, { recursive: true });
    if (version !== "0.4.0") await writeFile(path.join(scripts, "ultracode-cli.js"), "// fixture\n");
  }
  assert.equal(await resolveUltracodeCli(root), await realpath(path.join(root, "plugins/cache/just-every/ultracode/0.3.10/scripts/ultracode-cli.js")));
});
