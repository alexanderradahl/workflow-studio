import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PHASES,
  PLUGIN_ROOT,
  WORKSPACE_PHASES,
  getLatestWorkflowRun,
  getWorkflowRun,
  runBuildArtifact,
  runWorkspaceWorkflow,
} from "../src/runtime.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
export const SERVER_NAME = "workflow-studio";
export const SERVER_VERSION = manifest.version || "0.1.0";
export const WIDGET_URI = `ui://widget/workflow-studio-${encodeURIComponent(SERVER_VERSION)}.html`;
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";
const WIDGET_PATH = path.resolve(serverDir, "..", "dist", "workflow-studio-widget.html");
const WIDGET_DESCRIPTION = "An inline Workflow Studio dashboard showing guarded workflow phases, authorized scopes, planned and changed files, verification, findings, duration, and token usage.";
const ICON_SVG = readFileSync(path.join(PLUGIN_ROOT, "assets", "workflow-studio-small.svg"), "utf8");
const ICON = {
  src: `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["24x24"],
};

const runSchema = {
  type: "object",
  additionalProperties: false,
  required: ["task", "workspace", "output_path"],
  properties: {
    task: {
      type: "string",
      minLength: 1,
      maxLength: 20000,
      description: "Concrete brief for the one artifact Workflow Studio should create and verify.",
    },
    workspace: {
      type: "string",
      minLength: 1,
      maxLength: 4096,
      description: "Absolute path to an existing local workspace directory.",
    },
    output_path: {
      type: "string",
      minLength: 1,
      maxLength: 1024,
      description: "Normalized relative file path inside the workspace. Its parent directory must already exist.",
    },
    artifact_type: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "Optional artifact format or reader-facing deliverable type.",
    },
    constraints: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 2000 },
      description: "Optional exact scope, safety, content, or validation constraints.",
    },
    source_context: {
      type: "string",
      minLength: 1,
      maxLength: 50000,
      description: "Optional bounded source context supplied directly to the workflow workers.",
    },
    scouts: {
      type: "integer",
      minimum: 2,
      maximum: 4,
      default: 2,
      description: "Number of independent framing lanes, from 2 through 4.",
    },
  },
};

const workspaceRunSchema = {
  type: "object",
  additionalProperties: false,
  required: ["task", "workspace", "write_paths"],
  properties: {
    task: {
      type: "string",
      minLength: 1,
      maxLength: 20000,
      description: "Concrete brief for the substantial multi-file repository change Workflow Studio should implement and verify.",
    },
    workspace: {
      type: "string",
      minLength: 1,
      maxLength: 4096,
      description: "Absolute path to the canonical root of an existing local Git worktree with a valid HEAD.",
    },
    write_paths: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: { type: "string", minLength: 1, maxLength: 1024 },
      description: "One through 32 normalized relative file or directory scopes. The workspace root, .git, traversal, and links are rejected.",
    },
    constraints: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 2000 },
      description: "Optional exact scope, compatibility, safety, and validation constraints.",
    },
    source_context: {
      type: "string",
      minLength: 1,
      maxLength: 50000,
      description: "Optional bounded source context supplied directly to the workflow workers.",
    },
    scouts: {
      type: "integer",
      minimum: 2,
      maximum: 4,
      default: 2,
      description: "Number of independent read-only discovery lanes, from 2 through 4.",
    },
  },
};

function toolUiMeta(name, invoking, invoked) {
  return {
    ui: { resourceUri: WIDGET_URI, visibility: ["model"] },
    "ui/resourceUri": WIDGET_URI,
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
    "workflowStudio/tool": name,
  };
}

export function toolDefinitions() {
  return [
    {
      name: "run_build_artifact",
      title: "Run guarded artifact workflow",
      description: "Create and verify one substantial local artifact through Workflow Studio's exact-file multi-agent workflow. Use after an explicit one-file create/write request when independent framing and review materially improve the result. Use run_workspace_workflow for substantial multi-file repository changes. This operation can write only the requested output file and does not permit worker command networking.",
      inputSchema: runSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: toolUiMeta("run_build_artifact", "Running guarded workflow", "Guarded workflow finished"),
    },
    {
      name: "run_workspace_workflow",
      title: "Run guarded workspace workflow",
      description: "Implement and verify one substantial multi-file change in a local Git repository through Workflow Studio's fixed discovery, plan, implementation, review, repair, and verification workflow. Use only after an explicit implementation request and after establishing bounded write_paths. Repository instructions are respected, writes are limited to those scopes, worker networking is disabled, and host-observed changes outside scope block acceptance. Do not use for trivial edits, read-only analysis, command-only work, status checks, or external actions.",
      inputSchema: workspaceRunSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: toolUiMeta("run_workspace_workflow", "Running workspace workflow", "Workspace workflow finished"),
    },
    {
      name: "show_workflow_dashboard",
      title: "Show Workflow Studio dashboard",
      description: "Show the latest trusted Workflow Studio run, or a ready-state dashboard when no plugin run exists.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: toolUiMeta("show_workflow_dashboard", "Loading Workflow Studio", "Workflow Studio loaded"),
    },
    {
      name: "get_workflow_run",
      title: "Get Workflow Studio run",
      description: "Read one trusted Workflow Studio journal by its exact run id without starting a workflow.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["run_id"],
        properties: {
          run_id: {
            type: "string",
            minLength: 8,
            maxLength: 166,
            pattern: "^ultra-[A-Za-z0-9-]+$",
            description: "Exact Workflow Studio run id.",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: toolUiMeta("get_workflow_run", "Loading workflow run", "Workflow run loaded"),
    },
  ];
}

function resourceMeta() {
  return {
    "openai/widgetDescription": WIDGET_DESCRIPTION,
    "openai/widgetPrefersBorder": false,
    "openai/widgetCSP": { connect_domains: [], resource_domains: [], frame_domains: [] },
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
    },
  };
}

export function resources() {
  return [
    {
      uri: WIDGET_URI,
      name: "workflow_studio_dashboard",
      title: "Workflow Studio dashboard",
      description: WIDGET_DESCRIPTION,
      mimeType: WIDGET_MIME_TYPE,
      _meta: resourceMeta(),
    },
  ];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failedState(message, toolName) {
  const workspaceWorkflow = toolName === "run_workspace_workflow";
  return {
    schemaVersion: 2,
    workflow: workspaceWorkflow ? "change-workspace" : "build-artifact",
    state: "failed",
    status: "error",
    accepted: false,
    title: "Workflow request blocked",
    summary: message,
    runId: null,
    workspace: null,
    outputPath: null,
    absoluteOutputPath: null,
    writePaths: [],
    changedPaths: [],
    files: [],
    fileCounts: { planned: 0, changed: 0, verified: 0 },
    sourceHash: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    findings: [message],
    reviewFindingCount: 1,
    workerCount: 0,
    completedWorkerCount: 0,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
    phases: (workspaceWorkflow ? WORKSPACE_PHASES : DEFAULT_PHASES).map((phase) => ({
      ...phase,
      status: "pending",
      workerCount: 0,
    })),
  };
}

function textSummary(state, { toolName } = {}) {
  const lines = [
    `Workflow Studio: ${state.title}.`,
    state.summary,
  ];
  if (state.runId) lines.push(`Run: ${state.runId}`);
  if (state.outputPath) lines.push(`Output: ${state.outputPath}`);
  if (Array.isArray(state.writePaths) && state.writePaths.length) lines.push(`Write scopes: ${state.writePaths.join(", ")}`);
  if (state.fileCounts?.changed) {
    lines.push(`Files: ${state.fileCounts.changed} changed, ${state.fileCounts.verified || 0} verified`);
  }
  if (state.durationMs != null) lines.push(`Duration: ${state.durationMs} ms`);
  lines.push(`Accepted: ${state.accepted === true ? "yes" : state.accepted === false ? "no" : "not run"}`);
  if (["run_build_artifact", "run_workspace_workflow"].includes(toolName) && state.accepted === false) {
    lines.push("Retry: wait for a new visible user request before starting another writable Workflow Studio run.");
  }
  return lines.join("\n");
}

function toolResult(state, { isError = false, toolName } = {}) {
  return {
    content: [{ type: "text", text: textSummary(state, { toolName }) }],
    structuredContent: state,
    isError,
    _meta: toolUiMeta(toolName || "workflow_studio", "Loading Workflow Studio", "Workflow Studio ready"),
  };
}

let runQueue = Promise.resolve();

async function callTool(name, args) {
  if (name === "show_workflow_dashboard") return toolResult(await getLatestWorkflowRun(), { toolName: name });
  if (name === "get_workflow_run") {
    if (!isPlainObject(args) || Object.keys(args).some((key) => key !== "run_id")) {
      throw new Error("get_workflow_run accepts only run_id.");
    }
    return toolResult(await getWorkflowRun(args.run_id), { toolName: name });
  }
  if (name === "run_build_artifact") {
    const pending = runQueue.then(() => runBuildArtifact(args));
    runQueue = pending.catch(() => undefined);
    const state = await pending;
    return toolResult(state, { isError: !state.accepted, toolName: name });
  }
  if (name === "run_workspace_workflow") {
    const pending = runQueue.then(() => runWorkspaceWorkflow(args));
    runQueue = pending.catch(() => undefined);
    const state = await pending;
    return toolResult(state, { isError: !state.accepted, toolName: name });
  }
  throw new Error(`Unknown Workflow Studio tool: ${name}`);
}

function rpcResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleRpc(message) {
  if (!isPlainObject(message)) return rpcError(null, -32600, "Invalid Request");
  const id = message.id;
  const method = message.method;
  const params = isPlainObject(message.params) ? message.params : {};
  if (typeof method !== "string") return id != null ? rpcError(id, -32600, "Invalid Request") : null;
  if (method.startsWith("notifications/") || method === "$/cancelRequest") return null;

  try {
    if (method === "initialize") {
      return rpcResponse(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          title: "Workflow Studio",
          version: SERVER_VERSION,
          description: "Run and visualize guarded single-file artifact or multi-file repository workflows.",
          icons: [ICON],
        },
        instructions: "Use run_build_artifact after an explicit request for one substantial local artifact and an exact normalized output path. Use run_workspace_workflow after an explicit substantial multi-file repository implementation request, an absolute canonical Git root, and 1-32 bounded relative write_paths. Do not use either writable tool for trivial edits, read-only analysis, command-only work, status checks, or external actions. Use show_workflow_dashboard or get_workflow_run for read-only inspection. Success requires accepted=true in the returned structured content; a failed workspace run may still report observed changed files that require review.",
      });
    }
    if (method === "ping") return rpcResponse(id, {});
    if (method === "tools/list") return rpcResponse(id, { tools: toolDefinitions() });
    if (method === "tools/call") {
      if (typeof params.name !== "string") return rpcError(id, -32602, "tools/call requires a tool name");
      const args = params.arguments ?? {};
      if (!isPlainObject(args)) return rpcError(id, -32602, "tools/call arguments must be an object");
      try {
        return rpcResponse(id, await callTool(params.name, args));
      } catch (error) {
        const state = failedState(error?.message || String(error), params.name);
        return rpcResponse(id, toolResult(state, { isError: true, toolName: params.name }));
      }
    }
    if (method === "resources/list") return rpcResponse(id, { resources: resources() });
    if (method === "resources/read") {
      if (params.uri !== WIDGET_URI) return rpcError(id, -32602, `Unknown Workflow Studio resource: ${params.uri}`);
      return rpcResponse(id, {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: WIDGET_MIME_TYPE,
            text: readFileSync(WIDGET_PATH, "utf8"),
            _meta: resourceMeta(),
          },
        ],
      });
    }
    if (method === "resources/templates/list") return rpcResponse(id, { resourceTemplates: [] });
    if (method === "prompts/list") return rpcResponse(id, { prompts: [] });
  } catch (error) {
    return rpcError(id, -32000, error?.message || String(error));
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function writeRpc(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function runStdio() {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let decoded;
    try {
      decoded = JSON.parse(line);
    } catch (error) {
      writeRpc(rpcError(null, -32700, `Parse error: ${error.message}`));
      return;
    }
    if (Array.isArray(decoded)) {
      const responses = [];
      for (const item of decoded) {
        const response = await handleRpc(item);
        if (response) responses.push(response);
      }
      if (responses.length) writeRpc(responses);
      return;
    }
    const response = await handleRpc(decoded);
    if (response) writeRpc(response);
  });
}

if (process.argv.includes("--stdio")) runStdio();
