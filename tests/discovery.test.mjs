import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { toolDefinitions } from "../mcp/server.mjs";

const skillPath = new URL("../skills/workflow-studio/SKILL.md", import.meta.url);
const yamlPath = new URL("../skills/workflow-studio/agents/openai.yaml", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);

test("implicit discovery names both the eligible job and its boundary", async () => {
  const skill = await readFile(skillPath, "utf8");
  const description = skill.match(/^description:\s*"([^"]+)"/m)?.[1] || "";

  assert.match(description, /single-file artifacts/i);
  assert.match(description, /multi-file repository changes/i);
  assert.match(description, /Do not use for simple edits/i);
  assert.match(skill, /substantial multi-file repository change/i);
  assert.match(skill, /run_workspace_workflow/);
  assert.match(skill, /When eligibility is borderline, keep the task on its ordinary Codex path/);
  assert.match(skill, /does not authorize a file write/i);
});

test("Skill UI keeps implicit invocation on and advertises explicit invocation", async () => {
  const yaml = await readFile(yamlPath, "utf8");
  assert.match(yaml, /allow_implicit_invocation:\s*true/);
  assert.match(yaml, /default_prompt:\s*"Use \$workflow-studio/);
});

test("writable MCP tools separate exact-file and multi-file routing", () => {
  const artifactTool = toolDefinitions().find((tool) => tool.name === "run_build_artifact");
  const workspaceTool = toolDefinitions().find((tool) => tool.name === "run_workspace_workflow");
  assert.ok(artifactTool);
  assert.ok(workspaceTool);
  assert.match(artifactTool.description, /one substantial local artifact/i);
  assert.match(workspaceTool.description, /substantial multi-file change/i);
  assert.match(workspaceTool.description, /Do not use for trivial edits/i);
  assert.equal(artifactTool.annotations.openWorldHint, false);
  assert.equal(workspaceTool.annotations.openWorldHint, false);
});

test("README provides an opt-in global routing fallback without broadening write authority", async () => {
  const readme = await readFile(readmePath, "utf8");
  assert.match(readme, /Reliable selection in crowded Codex profiles/);
  assert.match(readme, /add this bounded rule to `~\/.codex\/AGENTS\.md`/);
  assert.match(readme, /substantial single-file artifact or multi-file repository change/);
  assert.match(readme, /does not authorize a write/);
  assert.match(readme, /does not edit global Codex instructions during installation/);
});
