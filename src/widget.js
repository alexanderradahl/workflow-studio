import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";

const root = document.querySelector("#app");
let latestState = readyState();

function readyState() {
  return {
    schemaVersion: 2,
    workflow: "workflow-studio",
    state: "ready",
    status: "ready",
    accepted: null,
    title: "Ready for a guarded workflow",
    summary: "Ask Codex to create a local artifact or make a bounded workspace change through the six-phase workflow.",
    runId: null,
    workspace: null,
    outputPath: null,
    writePaths: [],
    files: [],
    fileCounts: { planned: 0, changed: 0, verified: 0 },
    durationMs: null,
    reviewFindingCount: 0,
    findings: [],
    usage: { totalTokens: 0 },
    phases: [
      ["Frame", "Independent workers turn the brief into complementary guidance."],
      ["Plan", "A planner creates acceptance criteria and an authorized change scope."],
      ["Build", "Writable workers implement the requested artifact or workspace change."],
      ["Review", "Independent reviewers inspect the resulting files from different lenses."],
      ["Repair", "Supported findings are corrected within the authorized scope."],
      ["Verify", "A final read-only worker checks every output and changed file."],
    ].map(([title, detail]) => ({ title, detail, status: "pending" })),
  };
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : "0";
}

const FILE_STATUSES = new Set(["added", "modified", "deleted", "mode-changed"]);

function normalizedFile(file) {
  if (typeof file === "string") {
    const path = file.trim();
    return path ? { path, planned: false, changed: false, verified: false, status: null } : null;
  }
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const path = typeof file.path === "string" ? file.path.trim() : "";
  if (!path) return null;
  return {
    path,
    planned: file.planned === true,
    changed: file.changed === true,
    verified: file.verified === true,
    status: FILE_STATUSES.has(file.status) ? file.status : null,
  };
}

function workflowFiles(state) {
  const source = Array.isArray(state.files) ? state.files : [];
  const files = [];
  const seen = new Set();
  source.forEach((file) => {
    const normalized = normalizedFile(file);
    if (!normalized || seen.has(normalized.path)) return;
    seen.add(normalized.path);
    files.push(normalized);
  });

  // v1 journals only exposed outputPath. A successful accepted run has enough
  // evidence to synthesize all three flags; running/failed runs remain planned
  // only so the dashboard never implies an unverified write.
  if (!files.length && typeof state.outputPath === "string" && state.outputPath.trim()) {
    const accepted = state.accepted === true || state.state === "accepted";
    files.push({
      path: state.outputPath.trim(),
      planned: true,
      changed: accepted,
      verified: accepted,
      status: null,
    });
  }
  return files;
}

function workflowFileCounts(state, files) {
  const source = state.fileCounts && typeof state.fileCounts === "object" ? state.fileCounts : {};
  const count = (key, fallback) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  };
  return {
    planned: count("planned", files.filter((file) => file.planned).length),
    changed: count("changed", files.filter((file) => file.changed).length),
    verified: count("verified", files.filter((file) => file.verified).length),
  };
}

function displayFileStatus(file) {
  if (file.status) return file.status;
  if (file.verified) return "verified";
  if (file.changed) return "changed";
  if (file.planned) return "planned";
  return "observed";
}

function humanizeStatus(value) {
  return String(value || "unknown")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function stateLabel(state) {
  if (state === "accepted") return "Accepted";
  if (state === "failed") return "Blocked";
  if (state === "running") return "Running";
  return "Ready";
}

function metric(label, value) {
  const item = node("div", "metric");
  item.append(node("span", "metric-label", label), node("span", "metric-value", value));
  return item;
}

function detail(label, value) {
  const row = node("div", "detail-row");
  row.append(node("div", "detail-key", label), node("div", "detail-value", value));
  return row;
}

function fileBadge(label, enabled) {
  const badge = node("span", `file-badge ${enabled ? "is-active" : "is-inactive"}`, label);
  badge.setAttribute("aria-label", `${label}: ${enabled ? "yes" : "no"}`);
  return badge;
}

function renderFiles(files, counts) {
  if (!files.length) return null;
  const section = node("section", "files-panel");
  const heading = node("div", "files-heading");
  const title = node("h2", "files-title", "Files");
  title.id = "workflow-files-title";
  const summary = node(
    "span",
    "files-summary",
    `${formatNumber(counts.planned)} planned · ${formatNumber(counts.changed)} changed · ${formatNumber(counts.verified)} verified`,
  );
  heading.append(title, summary);
  section.append(heading);

  const list = node("ul", "file-list");
  list.setAttribute("aria-labelledby", title.id);
  files.forEach((file) => {
    const item = node("li", "file-item");
    const head = node("div", "file-head");
    const path = node("span", "file-path", file.path);
    path.title = file.path;
    const status = node("span", `file-status ${file.status || "observed"}`, humanizeStatus(displayFileStatus(file)));
    head.append(path, status);
    const badges = node("div", "file-badges");
    badges.append(
      fileBadge("Planned", file.planned),
      fileBadge("Changed", file.changed),
      fileBadge("Verified", file.verified),
    );
    item.append(head, badges);
    list.append(item);
  });
  section.append(list);
  return section;
}

function renderWriteScopes(writePaths) {
  if (!writePaths.length) return null;
  const row = node("div", "detail-row");
  row.append(node("div", "detail-key", "Authorized"));
  const list = node("ul", "scope-list");
  list.setAttribute("aria-label", "Authorized write scopes");
  writePaths.forEach((scope) => list.append(node("li", "scope-item", scope)));
  row.append(list);
  return row;
}

async function sendVisibleMessage(prompt, button, feedback) {
  button.disabled = true;
  feedback.textContent = "Sending to chat…";
  try {
    await app.ready;
    const capabilities = app.getHostCapabilities?.();
    if (!capabilities?.message?.text) throw new Error("This host does not expose chat messaging.");
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    if (result?.isError) throw new Error("The host declined the message.");
    feedback.textContent = "Sent to chat";
  } catch (error) {
    feedback.textContent = error?.message || "Could not send the follow-up.";
  } finally {
    button.disabled = false;
  }
}

function render(input) {
  const state = input && typeof input === "object" ? input : readyState();
  latestState = state;
  const files = workflowFiles(state);
  const fileCounts = workflowFileCounts(state, files);
  const fileTotal = Math.max(fileCounts.planned, fileCounts.changed, files.length);
  const changedFiles = files.filter((file) => file.changed);
  root.replaceChildren();

  const shell = node("section", "shell");
  shell.setAttribute("aria-label", "Workflow Studio run");

  const hero = node("header", "hero");
  const eyebrowRow = node("div", "eyebrow-row");
  const brand = node("div", "brand");
  brand.append(node("div", "brand-mark", "W"), node("span", "eyebrow", "Workflow Studio"));
  const pill = node("span", `status-pill ${state.state || "ready"}`, stateLabel(state.state));
  eyebrowRow.append(brand, pill);

  const titleGroup = node("div");
  titleGroup.append(
    node("h1", "", state.title || (state.accepted ? "Workflow accepted" : "Workflow result")),
    node("p", "subtitle", state.summary || "Guarded workflow state is available."),
  );

  const metrics = node("div", "metric-strip");
  metrics.append(
    metric("Duration", formatDuration(state.durationMs)),
    metric("Findings", formatNumber(state.reviewFindingCount ?? state.findings?.length ?? 0)),
    metric("Files verified", fileTotal ? `${formatNumber(fileCounts.verified)} / ${formatNumber(fileTotal)}` : "0"),
    metric("Tokens", formatNumber(state.usage?.totalTokens ?? 0)),
  );
  hero.append(eyebrowRow, titleGroup, metrics);
  shell.append(hero);

  const phaseList = node("div", "phase-list");
  const phases = Array.isArray(state.phases) && state.phases.length ? state.phases : readyState().phases;
  phases.forEach((phase, index) => {
    const row = node("div", `phase ${phase.status || "pending"}`);
    const head = node("div", "phase-head");
    const copy = node("div", "phase-copy");
    copy.append(node("div", "phase-title", phase.title), node("div", "phase-detail", phase.detail));
    const marker = phase.status === "completed" ? "✓" : phase.status === "failed" ? "!" : String(index + 1);
    head.append(node("div", "phase-node", marker), copy, node("span", "phase-state", phase.status || "pending"));
    row.append(head);
    phaseList.append(row);
  });
  shell.append(phaseList);

  const details = node("div", "details");
  if (state.workflow) details.append(detail("Workflow", humanizeStatus(state.workflow)));
  if (state.runId) details.append(detail("Run", state.runId));
  if (state.outputPath) details.append(detail("Output", state.outputPath));
  if (files.length > 1 || fileCounts.planned || fileCounts.changed || fileCounts.verified) {
    details.append(detail("Files", `${formatNumber(fileCounts.planned)} planned · ${formatNumber(fileCounts.changed)} changed · ${formatNumber(fileCounts.verified)} verified`));
  }
  const scopeRow = renderWriteScopes(Array.isArray(state.writePaths) ? state.writePaths.filter((scope) => typeof scope === "string" && scope.trim()) : []);
  if (scopeRow) details.append(scopeRow);
  if (state.sourceHash) details.append(detail("Definition", state.sourceHash.slice(0, 12)));
  if (Array.isArray(state.findings) && state.findings.length) {
    const findingRow = node("div", "detail-row");
    findingRow.append(node("div", "detail-key", "Findings"));
    const list = node("ul", "findings");
    state.findings.slice(0, 4).forEach((finding) => list.append(node("li", "", finding)));
    findingRow.append(list);
    details.append(findingRow);
  }
  if (details.childElementCount) shell.append(details);
  const filesPanel = renderFiles(files, fileCounts);
  if (filesPanel) shell.append(filesPanel);

  const actions = node("footer", "actions");
  const runAgain = node("button", "action primary", state.state === "ready" ? "Start a workflow" : "Run another");
  runAgain.type = "button";
  const feedback = node("span", "action-feedback", "");
  runAgain.addEventListener("click", () => sendVisibleMessage(
    "Use $workflow-studio for the next substantial local artifact or bounded multi-file workspace change. Gather the concrete brief, current workspace, and exact output path or relative write scopes before starting the write.",
    runAgain,
    feedback,
  ));
  actions.append(runAgain);

  if (files.length === 1) {
    const openOutput = node("button", "action", "Open output");
    openOutput.type = "button";
    openOutput.addEventListener("click", () => sendVisibleMessage(
      `Open or inspect the local Workflow Studio output at ${files[0].path} in the workspace ${state.workspace || "for this run"}.`,
      openOutput,
      feedback,
    ));
    actions.append(openOutput);
  } else if (changedFiles.length > 1) {
    const openChanges = node("button", "action", "Open changes");
    openChanges.type = "button";
    const visiblePaths = changedFiles.map((file) => file.path).join(", ");
    openChanges.addEventListener("click", () => sendVisibleMessage(
      `Inspect the visible Workflow Studio workspace changes for this run in ${state.workspace || "the current workspace"}. Review these changed paths: ${visiblePaths}.`,
      openChanges,
      feedback,
    ));
    actions.append(openChanges);
  }
  actions.append(feedback);
  shell.append(actions);
  root.append(shell);
}

function applyHostContext(context) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

const app = new App(
  { name: "Workflow Studio", version: "0.2.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);

app.addEventListener("hostcontextchanged", applyHostContext);
app.addEventListener("toolresult", (result) => render(result?.structuredContent || result));
app.ready = app.connect()
  .then(() => applyHostContext(app.getHostContext()))
  .catch(() => undefined);

render(window.openai?.toolOutput || latestState);
