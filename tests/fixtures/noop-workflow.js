export const meta = {
  name: "Workflow Studio Noop",
  description: "Validate exact-path Ultracode execution without launching workers.",
  phases: [{ title: "Verify", detail: "Return a deterministic fixture result." }],
};

phase("Verify");

return {
  accepted: true,
  fixture: "workflow-studio",
};
