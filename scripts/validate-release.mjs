import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryUrl = "https://github.com/alexanderradahl/workflow-studio";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function requireFile(relativePath) {
  await access(path.join(root, relativePath));
}

const requiredFiles = [
  ".agents/plugins/marketplace.json",
  ".codex-plugin/plugin.json",
  ".github/workflows/ci.yml",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "RELEASING.md",
  "SECURITY.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "src/runtime-dependencies.mjs",
  "assets/workflow-studio-preview.png",
  "dist/workflow-studio-widget.html",
  "skills/workflow-studio/SKILL.md",
  "skills/workflow-studio/agents/openai.yaml",
  "src/workspace-guard.mjs",
  "workflows/change-workspace.js",
];
await Promise.all(requiredFiles.map(requireFile));

const [manifest, packageJson, marketplace, skill, openaiYaml, widget, readme, releasing, gitignore] = await Promise.all([
  readJson(".codex-plugin/plugin.json"),
  readJson("package.json"),
  readJson(".agents/plugins/marketplace.json"),
  readFile(path.join(root, "skills/workflow-studio/SKILL.md"), "utf8"),
  readFile(path.join(root, "skills/workflow-studio/agents/openai.yaml"), "utf8"),
  readFile(path.join(root, "dist/workflow-studio-widget.html"), "utf8"),
  readFile(path.join(root, "README.md"), "utf8"),
  readFile(path.join(root, "RELEASING.md"), "utf8"),
  readFile(path.join(root, ".gitignore"), "utf8"),
]);

assert.equal(manifest.name, "workflow-studio");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.license, "MIT");
assert.equal(packageJson.license, "MIT");
assert.equal(packageJson.version, manifest.version);
assert.equal(manifest.repository, repositoryUrl);
assert.equal(manifest.homepage, repositoryUrl);
assert.equal(manifest.interface?.websiteURL, repositoryUrl);
assert.deepEqual(manifest.interface?.screenshots, ["./assets/workflow-studio-preview.png"]);
assert.doesNotMatch(manifest.version, /\+codex\./, "release version must not contain a development cachebuster");

assert.equal(marketplace.name, "workflow-studio");
assert.equal(marketplace.plugins?.length, 1);
assert.equal(marketplace.plugins[0]?.name, "workflow-studio");
assert.deepEqual(marketplace.plugins[0]?.source, { source: "url", url: repositoryUrl });
assert.equal(marketplace.plugins[0]?.policy?.installation, "AVAILABLE");
assert.equal(marketplace.plugins[0]?.policy?.authentication, "ON_INSTALL");

assert.match(skill, /substantial single-file artifacts or multi-file repository changes/i);
assert.match(skill, /run_workspace_workflow/);
assert.match(skill, /Never use `\.` or `\.git`/);
assert.match(skill, /Do not select Workflow Studio implicitly/);
assert.match(skill, /Explicit `\$workflow-studio` invocation/);
assert.match(openaiYaml, /allow_implicit_invocation:\s*true/);
assert.match(openaiYaml, /default_prompt:\s*"Use \$workflow-studio/);

assert.doesNotMatch(widget, /\/\*__WORKFLOW_STUDIO_(?:STYLES|SCRIPT)__\*\//);
assert.doesNotMatch(widget, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
assert.match(widget, /Open changes/);
assert.match(widget, /Files verified/);
assert.match(readme, /codex plugin marketplace add alexanderradahl\/workflow-studio/);
assert.match(readme, /Reliable selection in crowded Codex profiles/);
assert.match(readme, /~\/.codex\/AGENTS\.md/);
assert.match(readme, /substantial single-file artifact or multi-file repository change/);
assert.match(readme, /does not edit global Codex instructions during installation/);
assert.match(releasing, /Choose a license/);
assert.match(gitignore, /dist\/\*\.md/);
assert.match(gitignore, /node_modules\//);

console.log(`Workflow Studio ${manifest.version} release validation passed`);
