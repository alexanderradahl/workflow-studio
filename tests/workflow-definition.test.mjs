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

async function exerciseWorkspaceWorkflow({ invalidPath, blocked = false } = {}) {
  const source = (await readFile(workflowPaths[1], "utf8"))
    .replace("export const meta =", "const meta =")
    .replace("export default", "return");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction("args", "agent", "parallel", "phase", "log", source);
  const seen = [];
  const report = () => ({ summary: "checked", findings: [], recommended_actions: [], risks: [], verification: ["fixture passed"], confidence: "high" });
  const agent = async (prompt, spec) => {
    seen.push(spec.label);
    const value = report();
    if (spec.label === "planner") {
      Object.assign(value, { planned_paths: [invalidPath || "src/feature.js"], acceptance_criteria: ["works"], validation: ["test"] });
    } else if (["implementer", "repairer", "final-verifier"].includes(spec.label)) {
      delete value.findings;
      value.blocking_findings = blocked && spec.label === "implementer" ? ["Fixture runner could not create its cache"] : [];
      value[spec.label === "final-verifier" ? "verified_paths" : "changed_paths"] = ["src/feature.js"];
    }
    const pathKey = ["planned_paths", "changed_paths", "verified_paths"].find((key) => spec.schema.properties[key]);
    if (pathKey) {
      assert.match(prompt, /MUST use normalized repository-relative paths/);
      const pattern = new RegExp(spec.schema.properties[pathKey].items.pattern);
      assert.equal(pattern.test("src/feature.js"), true);
      for (const unsafe of ["/workspace/src/feature.js", "../src/file.js", "src/../secret", "src/.git/config", "other/file.js", "src-extra/a.js", "src//a.js", "src/a\\b.js", "src/a\u0000b"]) {
        assert.equal(pattern.test(unsafe), false, `schema must reject ${JSON.stringify(unsafe)}`);
      }
    }
    return value;
  };
  const result = await execute({ task: "Implement feature", write_paths: ["src"] }, agent,
    (lanes) => Promise.all(lanes.map((lane) => lane())), () => {}, () => {});
  return { result, seen };
}

test("workspace workflow executes its stages with scoped relative report schemas", async () => {
  const { result, seen } = await exerciseWorkspaceWorkflow();
  assert.equal(result.accepted, true);
  assert.deepEqual(result.verified_paths, ["src/feature.js"]);
  assert.deepEqual(seen, ["requirements", "architecture", "planner", "implementer", "requirements-reviewer", "quality-reviewer", "final-verifier"]);
});

test("workspace workflow still rejects unsafe planner reports before writing", async () => {
  for (const invalidPath of ["/workspace/src/feature.js", "../src/feature.js", "other/feature.js"]) {
    await assert.rejects(() => exerciseWorkspaceWorkflow({ invalidPath }), /planner.planned_paths/);
  }
});

test("workspace workflow preserves the implementation blocker in its thrown error", async () => {
  await assert.rejects(() => exerciseWorkspaceWorkflow({ blocked: true }), /Implementation blocked: Fixture runner could not create its cache/);
});
