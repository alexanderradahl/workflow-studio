import { constants } from "node:fs";
import { access, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveCodexBinary(environment) {
  const candidates = [
    ...(environment.PATH || "").split(path.delimiter).filter((entry) => path.isAbsolute(entry)).map((entry) => path.join(entry, "codex")),
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK | constants.X_OK);
      return await realpath(candidate);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  throw new Error("Codex executable not found. Install Codex and make `codex` available on PATH, then restart the plugin.");
}

export async function resolveUltracodeCli(codexHome) {
  const root = path.join(codexHome, "plugins", "cache", "just-every", "ultracode");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    entries = [];
  }
  const versions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(root, version, "scripts", "ultracode-cli.js");
    try {
      await access(candidate, constants.R_OK);
      return await realpath(candidate);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error("Ultracode is not installed. Run `codex plugin marketplace add just-every/plugins` and `codex plugin add ultracode@just-every`, then restart the plugin.");
}
