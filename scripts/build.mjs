import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const distDir = path.join(root, "dist");

await mkdir(distDir, { recursive: true });

const bundle = await build({
  entryPoints: [path.join(root, "src", "widget.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"'
  }
});

const javascript = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const [shell, styles] = await Promise.all([
  readFile(path.join(root, "src", "widget-shell.html"), "utf8"),
  readFile(path.join(root, "src", "widget.css"), "utf8")
]);

const html = shell
  .replace("/*__WORKFLOW_STUDIO_STYLES__*/", () => styles)
  .replace("/*__WORKFLOW_STUDIO_SCRIPT__*/", () => javascript)
  .replace(/[ \t]+$/gm, "");

await writeFile(path.join(distDir, "workflow-studio-widget.html"), html, "utf8");
console.log("Built dist/workflow-studio-widget.html");
