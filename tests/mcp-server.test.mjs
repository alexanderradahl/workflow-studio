import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WIDGET_MIME_TYPE,
  WIDGET_URI,
  handleRpc,
  resources,
  toolDefinitions,
} from "../mcp/server.mjs";

test("MCP server exposes three fixed tools and one inline app resource", () => {
  const tools = toolDefinitions();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "run_build_artifact",
    "show_workflow_dashboard",
    "get_workflow_run",
  ]);
  assert.equal(tools[0].inputSchema.additionalProperties, false);
  assert.equal(tools[0].annotations.openWorldHint, false);
  assert.equal(tools[0]._meta["ui/resourceUri"], WIDGET_URI);
  assert.equal(resources()[0].mimeType, WIDGET_MIME_TYPE);
});

test("initialize, tools/list, resources/list, and resources/read follow MCP contracts", async () => {
  const initialized = await handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(initialized.result.serverInfo.name, "workflow-studio");
  assert.equal(initialized.result.capabilities.tools.listChanged, false);

  const listedTools = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listedTools.result.tools.length, 3);

  const listedResources = await handleRpc({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} });
  assert.equal(listedResources.result.resources[0].uri, WIDGET_URI);

  const readResource = await handleRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: { uri: WIDGET_URI },
  });
  const content = readResource.result.contents[0];
  assert.equal(content.mimeType, WIDGET_MIME_TYPE);
  assert.match(content.text, /Workflow Studio/);
  assert.match(content.text, /@modelcontextprotocol\/ext-apps/);
  assert.doesNotMatch(content.text, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
  assert.deepEqual(content._meta["openai/widgetCSP"].connect_domains, []);
  assert.deepEqual(content._meta["openai/widgetCSP"].resource_domains, []);
});

test("dashboard tool returns a structured ready or trusted-run fallback", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "show_workflow_dashboard", arguments: {} },
  });
  assert.equal(response.result.isError, false);
  assert.equal(response.result._meta["ui/resourceUri"], WIDGET_URI);
  assert.equal(response.result.structuredContent.schemaVersion, 1);
  assert.ok(["ready", "accepted", "failed", "running"].includes(response.result.structuredContent.state));
});

test("writable tool rejects arbitrary arguments before launching a workflow", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "run_build_artifact",
      arguments: {
        task: "Create a note",
        workspace: "/tmp",
        output_path: "note.md",
        command: "echo unsafe",
      },
    },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.state, "failed");
  assert.match(response.result.structuredContent.summary, /Unsupported workflow argument/);
});
