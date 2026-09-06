import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MAX_SNAPSHOT_FILES = 20_000;
const MAX_IGNORED_ENTRIES = 100_000;
const MAX_IGNORED_TREE_NODES = 1_000_000;
const HASH_CONCURRENCY = 16;
const WORKSPACE_ALLOWED_KEYS = new Set([
  "task",
  "workspace",
  "write_paths",
  "constraints",
  "source_context",
  "scouts",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, name, { max = 20_000 } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${name} exceeds the ${max}-character limit.`);
  return normalized;
}

function optionalString(value, name, { max = 20_000 } = {}) {
  if (value == null || value === "") return undefined;
  return requireString(value, name, { max });
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function maybeLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeWritePath(value, index) {
  const normalized = requireString(value, `write_paths[${index}]`, { max: 1_024 }).replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:\//.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    path.posix.normalize(normalized) !== normalized
  ) {
    const suffix = normalized === "." ? " and must not grant the workspace root" : "";
    throw new Error(`write_paths[${index}] must be a normalized relative path${suffix}.`);
  }
  if (parts.includes(".git")) throw new Error(`write_paths[${index}] must not include .git metadata.`);
  return normalized;
}

export function validateWorkspaceRunArguments(value) {
  if (!isPlainObject(value)) throw new Error("Workspace workflow arguments must be an object.");
  const unknown = Object.keys(value).filter((key) => !WORKSPACE_ALLOWED_KEYS.has(key));
  if (unknown.length) throw new Error(`Unsupported workspace workflow argument(s): ${unknown.join(", ")}.`);

  if (!Array.isArray(value.write_paths) || value.write_paths.length < 1 || value.write_paths.length > 32) {
    throw new Error("write_paths must contain 1 through 32 relative file or directory scopes.");
  }
  const writePaths = value.write_paths.map(normalizeWritePath);
  if (new Set(writePaths).size !== writePaths.length) throw new Error("write_paths must not contain duplicates.");

  const constraints = value.constraints == null ? [] : value.constraints;
  if (!Array.isArray(constraints) || constraints.length > 20) {
    throw new Error("constraints must be an array containing at most 20 strings.");
  }
  const normalizedConstraints = constraints.map((constraint, index) =>
    requireString(constraint, `constraints[${index}]`, { max: 2_000 }),
  );
  const scouts = value.scouts == null ? 2 : Number(value.scouts);
  if (!Number.isInteger(scouts) || scouts < 2 || scouts > 4) {
    throw new Error("scouts must be an integer from 2 through 4.");
  }

  return {
    task: requireString(value.task, "task", { max: 20_000 }),
    workspace: requireString(value.workspace, "workspace", { max: 4_096 }),
    write_paths: writePaths,
    constraints: normalizedConstraints,
    source_context: optionalString(value.source_context, "source_context", { max: 50_000 }),
    scouts,
  };
}

async function git(workspace, args) {
  try {
    const result = await execFileP("git", ["-C", workspace, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
    throw new Error(`Git workspace check failed: ${detail}`);
  }
}

async function assertSafeScope(workspace, writePath) {
  const parts = writePath.split("/");
  let current = workspace;
  let missing = false;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    if (missing) continue;
    const stats = await maybeLstat(current);
    if (!stats) {
      if (index < parts.length - 1) {
        throw new Error(
          `Write scope ${writePath} has a missing parent; authorize the first missing directory or an existing parent scope.`,
        );
      }
      missing = true;
      continue;
    }
    if (stats.isSymbolicLink()) throw new Error(`Write scope ${writePath} contains a symbolic link.`);
    if (index < parts.length - 1 && !stats.isDirectory()) {
      throw new Error(`Write scope ${writePath} has a non-directory parent component.`);
    }
    if (index === parts.length - 1) {
      if (!stats.isDirectory() && !stats.isFile()) {
        throw new Error(`Write scope ${writePath} must resolve to a file or directory.`);
      }
      if (stats.isFile() && stats.nlink !== 1) throw new Error(`Write scope ${writePath} must not be hard-linked.`);
    }
  }
  const target = path.resolve(workspace, ...parts);
  if (!inside(workspace, target)) throw new Error(`Write scope ${writePath} resolves outside the workspace.`);
  return target;
}

function collapseScopes(writePaths) {
  const ordered = [...writePaths].sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  const kept = [];
  for (const candidate of ordered) {
    if (kept.some((parent) => candidate === parent || candidate.startsWith(`${parent}/`))) continue;
    kept.push(candidate);
  }
  return kept;
}

export async function resolveGuardedWorkspace(workspaceInput, writePathsInput) {
  if (!path.isAbsolute(workspaceInput)) throw new Error("workspace must be an absolute path.");
  const workspace = await realpath(workspaceInput);
  if (!(await stat(workspace)).isDirectory()) throw new Error("workspace must resolve to an existing directory.");
  const gitRoot = await realpath((await git(workspace, ["rev-parse", "--show-toplevel"])).trim());
  if (gitRoot !== workspace) throw new Error("workspace must be the canonical Git worktree root.");
  const head = (await git(workspace, ["rev-parse", "--verify", "HEAD"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(head)) throw new Error("workspace must have a valid Git HEAD.");

  const normalized = writePathsInput.map(normalizeWritePath);
  if (normalized.length < 1 || normalized.length > 32) {
    throw new Error("write_paths must contain 1 through 32 relative file or directory scopes.");
  }
  const writePaths = collapseScopes(normalized);
  const targets = [];
  for (const writePath of writePaths) targets.push(await assertSafeScope(workspace, writePath));
  return { workspace, head, writePaths, targets };
}

export function pathWithinWritePaths(candidate, writePaths) {
  return writePaths.some((scope) => candidate === scope || candidate.startsWith(`${scope}/`));
}

async function hashRegularFile(filePath) {
  const before = await lstat(filePath);
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const after = await lstat(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(`File changed while Workflow Studio was snapshotting it: ${filePath}`);
  }
  return hash.digest("hex");
}

function createHashScheduler() {
  const pending = new Map();
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < HASH_CONCURRENCY && queue.length) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => hashRegularFile(item.filePath))
        .then(
          (value) => {
            item.resolve(value);
            active -= 1;
            pump();
          },
          (error) => {
            item.reject(error);
            active -= 1;
            pump();
          },
        );
    }
  };

  return (filePath) => {
    const existing = pending.get(filePath);
    if (existing) return existing;
    const promise = new Promise((resolve, reject) => {
      queue.push({ filePath, resolve, reject });
    });
    pending.set(filePath, promise);
    pump();
    return promise;
  };
}

async function mapLimit(values, worker) {
  const results = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(HASH_CONCURRENCY, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function createSnapshotContext() {
  return {
    hashFile: createHashScheduler(),
    ignoredEntries: 0,
    ignoredTreeNodes: 0,
    visibleEntries: 0,
  };
}

async function snapshotEntry(workspace, relativePath, { strict, context }) {
  const absolutePath = path.join(workspace, ...relativePath.split("/"));
  const stats = await maybeLstat(absolutePath);
  if (!stats) return null;
  if (stats.isSymbolicLink()) {
    if (strict) throw new Error(`Authorized write scope contains a symbolic link: ${relativePath}`);
    return {
      path: relativePath,
      type: "symlink",
      hash: crypto.createHash("sha256").update(await readlink(absolutePath)).digest("hex"),
      mode: stats.mode & 0o777,
      size: stats.size,
    };
  }
  if (stats.isDirectory()) return null;
  if (!stats.isFile()) {
    if (strict) throw new Error(`Authorized write scope contains a non-regular file: ${relativePath}`);
    return {
      path: relativePath,
      type: "other",
      hash: crypto.createHash("sha256").update(`${stats.mode}:${stats.size}`).digest("hex"),
      mode: stats.mode & 0o777,
      size: stats.size,
    };
  }
  if (strict && stats.nlink !== 1) throw new Error(`Authorized write scope contains a hard-linked file: ${relativePath}`);
  return {
    path: relativePath,
    type: "file",
    hash: await context.hashFile(absolutePath),
    mode: stats.mode & 0o777,
    size: stats.size,
  };
}

function addEntry(entries, entry, context, { ignored = false } = {}) {
  if (!entry) return;
  if (entries.has(entry.path)) return;
  if (ignored) {
    context.ignoredEntries += 1;
    if (context.ignoredEntries > MAX_IGNORED_ENTRIES) {
      throw new Error(`Ignored workspace inventory exceeds the ${MAX_IGNORED_ENTRIES}-entry safety limit.`);
    }
  } else {
    context.visibleEntries += 1;
    if (context.visibleEntries > MAX_SNAPSHOT_FILES) {
      throw new Error(`Workspace snapshot exceeds the ${MAX_SNAPSHOT_FILES}-file safety limit.`);
    }
  }
  entries.set(entry.path, entry);
}

function isWriteScope(relativePath, writePaths) {
  return writePaths.some((scope) => scope === relativePath);
}

function sortedDirectoryEntries(directoryEntries) {
  return directoryEntries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

async function walkScope(workspace, relativePath, entries, context) {
  const absolutePath = path.join(workspace, ...relativePath.split("/"));
  const stats = await maybeLstat(absolutePath);
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error(`Authorized write scope contains a symbolic link: ${relativePath}`);
  if (stats.isFile()) {
    addEntry(entries, await snapshotEntry(workspace, relativePath, { strict: true, context }), context);
    return;
  }
  if (!stats.isDirectory()) throw new Error(`Authorized write scope contains a non-regular path: ${relativePath}`);
  const children = sortedDirectoryEntries(await readdir(absolutePath, { withFileTypes: true }));
  await mapLimit(children, async (entry) => {
    const child = `${relativePath}/${entry.name}`;
    if (entry.name === ".git") throw new Error(`Authorized write scope contains nested .git metadata: ${child}`);
    await walkScope(workspace, child, entries, context);
  });
}

function parseNullList(value) {
  return value.split("\0").filter(Boolean);
}

function parseIgnoredStatus(value) {
  const paths = [];
  for (const record of parseNullList(value)) {
    if (!record.startsWith("!! ")) continue;
    const relativePath = record.slice(3).replace(/\/$/, "");
    if (relativePath) paths.push(relativePath);
  }
  return paths;
}

function collapsePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  const kept = [];
  for (const candidate of ordered) {
    if (kept.some((parent) => candidate === parent || candidate.startsWith(`${parent}/`))) continue;
    kept.push(candidate);
  }
  return kept;
}

function hashIgnoredDirectory(stats, children) {
  const hash = crypto.createHash("sha256");
  hash.update("workflow-studio-ignored-directory\0");
  hash.update(`${stats.mode & 0o777}\0`);
  for (const child of children) {
    hash.update(`${child.name}\0`);
    if (child.kind === "scope") {
      hash.update("scope\0");
      continue;
    }
    hash.update(`${child.type}\0${child.mode}\0${child.size}\0${child.hash}\0`);
  }
  return hash.digest("hex");
}

async function snapshotIgnoredNode(workspace, relativePath, writePaths, context) {
  if (isWriteScope(relativePath, writePaths)) return { kind: "scope" };
  context.ignoredTreeNodes += 1;
  if (context.ignoredTreeNodes > MAX_IGNORED_TREE_NODES) {
    throw new Error(`Ignored workspace inventory exceeds the ${MAX_IGNORED_TREE_NODES}-node safety limit.`);
  }

  const absolutePath = path.join(workspace, ...relativePath.split("/"));
  const stats = await maybeLstat(absolutePath);
  if (!stats) return null;
  if (stats.isSymbolicLink()) {
    const target = await readlink(absolutePath);
    return {
      kind: "entry",
      type: "symlink",
      hash: crypto.createHash("sha256").update(target).digest("hex"),
      mode: stats.mode & 0o777,
      size: stats.size,
    };
  }
  if (stats.isFile()) {
    return {
      kind: "entry",
      type: "file",
      hash: await context.hashFile(absolutePath),
      mode: stats.mode & 0o777,
      size: stats.size,
    };
  }
  if (!stats.isDirectory()) {
    return {
      kind: "entry",
      type: "other",
      hash: crypto.createHash("sha256").update(`${stats.mode}:${stats.size}`).digest("hex"),
      mode: stats.mode & 0o777,
      size: stats.size,
    };
  }

  const directoryEntries = sortedDirectoryEntries(await readdir(absolutePath, { withFileTypes: true }));
  const existingNames = new Set(directoryEntries.map((entry) => entry.name));
  const missingScopeChildren = new Set(
    writePaths
      .filter((scope) => scope.startsWith(`${relativePath}/`))
      .map((scope) => scope.slice(relativePath.length + 1).split("/", 1)[0])
      .filter((name) => !existingNames.has(name)),
  );
  const children = await mapLimit(directoryEntries, async (entry) => {
    const childPath = `${relativePath}/${entry.name}`;
    const child = await snapshotIgnoredNode(workspace, childPath, writePaths, context);
    if (!child) return { name: entry.name, kind: "missing" };
    return { name: entry.name, ...child };
  });
  for (const name of missingScopeChildren) children.push({ name, kind: "scope" });
  children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return {
    kind: "entry",
    type: "ignored-tree",
    hash: hashIgnoredDirectory(stats, children),
    mode: stats.mode & 0o777,
    size: 0,
  };
}

async function snapshotIgnoredEntry(workspace, relativePath, writePaths, context) {
  const absolutePath = path.join(workspace, ...relativePath.split("/"));
  const stats = await maybeLstat(absolutePath);
  if (!stats) return null;
  if (stats.isDirectory()) {
    if (pathWithinWritePaths(relativePath, writePaths)) return null;
    const tree = await snapshotIgnoredNode(workspace, relativePath, writePaths, context);
    if (!tree || tree.kind === "scope") return null;
    return { path: relativePath, type: tree.type, hash: tree.hash, mode: tree.mode, size: tree.size };
  }
  return snapshotEntry(workspace, relativePath, {
    strict: pathWithinWritePaths(relativePath, writePaths),
    context,
  });
}

export async function snapshotWorkspace(guard) {
  const head = (await git(guard.workspace, ["rev-parse", "--verify", "HEAD"])).trim();
  const status = parseNullList(await git(guard.workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).sort();
  const visible = parseNullList(await git(guard.workspace, ["ls-files", "-co", "--exclude-standard", "-z"]));
  const ignored = parseIgnoredStatus(await git(guard.workspace, [
    "status",
    "--porcelain=v1",
    "-z",
    "--ignored=matching",
  ]));
  const candidates = [...new Set(visible)].sort();
  const ignoredRoots = collapsePaths(ignored);
  if (candidates.length > MAX_SNAPSHOT_FILES) {
    throw new Error(`Workspace snapshot exceeds the ${MAX_SNAPSHOT_FILES}-file safety limit.`);
  }
  if (ignoredRoots.length > MAX_IGNORED_ENTRIES) {
    throw new Error(`Ignored workspace inventory exceeds the ${MAX_IGNORED_ENTRIES}-entry safety limit.`);
  }
  const context = createSnapshotContext();
  const entries = new Map();
  const visibleEntries = await mapLimit(candidates, (relativePath) => snapshotEntry(guard.workspace, relativePath, {
      strict: pathWithinWritePaths(relativePath, guard.writePaths),
      context,
    }));
  for (const entry of visibleEntries) addEntry(entries, entry, context);
  const ignoredEntries = await mapLimit(ignoredRoots, (relativePath) =>
    snapshotIgnoredEntry(guard.workspace, relativePath, guard.writePaths, context),
  );
  for (const entry of ignoredEntries) addEntry(entries, entry, context, { ignored: true });
  for (const writePath of guard.writePaths) await walkScope(guard.workspace, writePath, entries, context);
  return {
    head,
    status,
    entries: new Map([...entries.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
  };
}

function changedStatus(before, after) {
  if (!before && after) return "added";
  if (before && !after) return "deleted";
  if (before.hash !== after.hash || before.type !== after.type || before.size !== after.size) return "modified";
  if (before.mode !== after.mode) return "mode-changed";
  return null;
}

export function compareWorkspaceSnapshots(before, after) {
  const paths = [...new Set([...before.entries.keys(), ...after.entries.keys()])].sort();
  const changed = [];
  for (const relativePath of paths) {
    const beforeEntry = before.entries.get(relativePath) || null;
    const afterEntry = after.entries.get(relativePath) || null;
    const status = changedStatus(beforeEntry, afterEntry);
    if (!status) continue;
    changed.push({
      path: relativePath,
      status,
      before_hash: beforeEntry?.hash || null,
      after_hash: afterEntry?.hash || null,
      before_mode: beforeEntry?.mode ?? null,
      after_mode: afterEntry?.mode ?? null,
    });
  }
  return changed;
}
