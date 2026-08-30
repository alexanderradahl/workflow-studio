import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn(process.execPath, ["./mcp/server.mjs", "--stdio"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
lines.on("line", (line) => {
  const value = JSON.parse(line);
  const waiter = pending.get(value.id);
  if (waiter) {
    pending.delete(value.id);
    waiter.resolve(value);
  }
});

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolve(value);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  const initialized = await request(1, "initialize", { protocolVersion: "2025-06-18" });
  assert.equal(initialized.result.serverInfo.name, "workflow-studio");
  const tools = await request(2, "tools/list");
  assert.equal(tools.result.tools.length, 4);
  const resources = await request(3, "resources/list");
  assert.equal(resources.result.resources.length, 1);
  console.log("Workflow Studio MCP stdio smoke passed");
} finally {
  child.kill("SIGTERM");
}
