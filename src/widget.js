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
    schemaVersion: 1,
    workflow: "build-artifact",
    state: "ready",
    status: "ready",
    accepted: null,
    title: "Ready for a guarded build",
    summary: "Ask Codex to create one local artifact through the six-phase workflow.",
    runId: null,
    outputPath: null,
    durationMs: null,
    reviewFindingCount: 0,
    findings: [],
    usage: { totalTokens: 0 },
    phases: [
      ["Frame", "Independent workers turn the brief into build guidance."],
      ["Plan", "A planner creates explicit acceptance criteria."],
      ["Build", "One exact-path writer creates the artifact."],
      ["Review", "Independent reviewers inspect the real output."],
      ["Repair", "Supported findings are corrected without scope expansion."],
      ["Verify", "A final read-only worker checks acceptance."],
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
    node("h1", "", state.title || (state.accepted ? "Artifact accepted" : "Workflow result")),
    node("p", "subtitle", state.summary || "Guarded workflow state is available."),
  );

  const metrics = node("div", "metric-strip");
  metrics.append(
    metric("Duration", formatDuration(state.durationMs)),
    metric("Findings", formatNumber(state.reviewFindingCount ?? state.findings?.length ?? 0)),
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
  if (state.runId) details.append(detail("Run", state.runId));
  if (state.outputPath) details.append(detail("Output", state.outputPath));
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

  const actions = node("footer", "actions");
  const runAgain = node("button", "action primary", state.state === "ready" ? "Start a workflow" : "Run another");
  runAgain.type = "button";
  const feedback = node("span", "action-feedback", "");
  runAgain.addEventListener("click", () => sendVisibleMessage(
    "Use $workflow-studio to run another guarded build-artifact workflow. Gather the task, current workspace, and one relative output path before starting the write.",
    runAgain,
    feedback,
  ));
  actions.append(runAgain);

  if (state.outputPath) {
    const openOutput = node("button", "action", "Open output");
    openOutput.type = "button";
    openOutput.addEventListener("click", () => sendVisibleMessage(
      `Open the local Workflow Studio artifact at ${state.outputPath} in the workspace ${state.workspace || "for this run"}.`,
      openOutput,
      feedback,
    ));
    actions.append(openOutput);
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
  { name: "Workflow Studio", version: "0.1.1" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);

app.addEventListener("hostcontextchanged", applyHostContext);
app.addEventListener("toolresult", (result) => render(result?.structuredContent || result));
app.ready = app.connect()
  .then(() => applyHostContext(app.getHostContext()))
  .catch(() => undefined);

render(window.openai?.toolOutput || latestState);
