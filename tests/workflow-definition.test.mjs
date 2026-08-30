import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflowPaths = [
  new URL("../workflows/build-artifact.js", import.meta.url),
  new URL("../workflows/change-workspace.js", import.meta.url),
];

test("bundled Claude-compatible workflows avoid unavailable host globals", async () => {
  for (const workflowPath of workflowPaths) {
    const source = await readFile(workflowPath, "utf8");
    assert.doesNotMatch(source, /\bprocess\s*\./, `${workflowPath.pathname} must delegate host access to workers`);
    assert.doesNotMatch(source, /\brequire\s*\(/, `${workflowPath.pathname} must not use CommonJS host access`);
  }
});
