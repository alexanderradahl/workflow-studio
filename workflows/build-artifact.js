export const meta = {
  name: "Build Artifact",
  description:
    "Create and verify one local workspace artifact from a brief using a Claude-style multi-agent Codex workflow.",
  phases: [
    { title: "Frame", detail: "Independent workers turn the brief into complementary build guidance." },
    { title: "Plan", detail: "A planner combines the strongest guidance into explicit acceptance criteria." },
    { title: "Build", detail: "One writable worker creates the requested artifact in the current workspace." },
    { title: "Review", detail: "Independent reviewers inspect the real artifact from different lenses." },
    { title: "Repair", detail: "One writable worker applies only supported corrections." },
    { title: "Verify", detail: "A final read-only worker checks the artifact against the original brief." }
  ]
};

const task = typeof args?.task === "string" ? args.task.trim() : "";
if (!task) {
  throw new Error('build-artifact requires args.task, for example {"task":"Create a launch checklist"}.');
}

const requestedPath =
  typeof args?.output_path === "string" && args.output_path.trim()
    ? args.output_path.trim()
    : "codex-workflow-artifact.md";
const outputPath = requestedPath.replace(/\\/g, "/");
const pathParts = outputPath.split("/");
if (
  outputPath.startsWith("/") ||
  outputPath.startsWith("~") ||
  /^[A-Za-z]:\//.test(outputPath) ||
  pathParts.includes("..") ||
  pathParts.includes("") ||
  outputPath === "."
) {
  throw new Error("args.output_path must be a normalized relative path inside the current workspace.");
}

const artifactType =
  typeof args?.artifact_type === "string" && args.artifact_type.trim()
    ? args.artifact_type.trim()
    : "the format implied by the output path and brief";
const constraints = Array.isArray(args?.constraints)
  ? args.constraints.map(String).filter(Boolean)
  : typeof args?.constraints === "string" && args.constraints.trim()
    ? [args.constraints.trim()]
    : [];
const scoutCount = Math.max(2, Math.min(4, Number(args?.scouts) || 2));
const codexBin = "codex-lean";
const allowResearch = args?.allow_research === true;
const sourceContext =
  typeof args?.source_context === "string" && args.source_context.trim()
    ? args.source_context.trim()
    : "No additional source context was supplied.";
const researchPolicy = allowResearch
  ? "You may inspect relevant local files or primary sources when the brief genuinely requires them. Keep the search bounded."
  : "Treat the brief and supplied source context as complete. Do not browse the web or scan unrelated workspace files.";
const constraintText = constraints.length
  ? constraints.map((constraint, index) => `${index + 1}. ${constraint}`).join("\n")
  : "No extra constraints were supplied. Preserve the user's stated scope and do not infer external-send authority.";
const isStringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
const hasVerificationEvidence = (value) =>
  isStringArray(value?.verification) && value.verification.length > 0;
const isStructuredResult = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  isStringArray(value.findings);

phase("Frame");
log(`framing artifact task with ${scoutCount} independent lanes`, {
  output_path: outputPath,
  scouts: scoutCount
});

const frameLenses = [
  {
    label: "requirements",
    prompt:
      "Translate the brief into concrete content and behavior requirements. Identify ambiguities, but make safe " +
      "assumptions when they do not change scope. Return useful acceptance criteria in findings. This is an " +
      "analysis-only lane: do not create or edit the artifact."
  },
  {
    label: "structure",
    prompt:
      "Design the artifact's structure and information hierarchy. Prefer the smallest structure that fully serves " +
      "the brief. Return the proposed sections/components in findings. This is an analysis-only lane: do not " +
      "create or edit the artifact."
  },
  {
    label: "risk",
    prompt:
      "Look for correctness, evidence, permissions, safety, and verification pitfalls. Return only concrete risks " +
      "the builder should actively prevent in findings. This is an analysis-only lane: do not create or edit the " +
      "artifact."
  },
  {
    label: "user-value",
    prompt:
      "Approach the brief from the intended user's perspective. Identify what would make the artifact genuinely " +
      "useful, easy to evaluate, and complete without unnecessary scope. Return priorities in findings. This is " +
      "an analysis-only lane: do not create or edit the artifact."
  }
];

const frameResults = await parallel(
  frameLenses.slice(0, scoutCount).map(({ label, prompt }) => () =>
    agent(
      `${prompt}\n\n` +
        `Brief: ${task}\n` +
        `Artifact type: ${artifactType}\n` +
        `Output path: ${outputPath}\n` +
        `Constraints:\n${constraintText}\n` +
        `Research policy: ${researchPolicy}\n` +
        `Source context:\n${sourceContext}\n` +
        `Return no more than eight concise findings.`,
      {
        label,
        model: "gpt-5.6-luna",
        reasoning_effort: "low",
        sandbox: "read-only",
        codex_bin: codexBin
      }
    )
  )
);

const usableFrames = frameResults.filter(isStructuredResult);
if (usableFrames.length !== scoutCount) {
  throw new Error(
    `Framing failed closed: expected ${scoutCount} structured worker results, received ${usableFrames.length}.`
  );
}

phase("Plan");
const plan = await agent(
  `Create one implementation-ready plan for this artifact. Resolve conflicts among the independent lanes, ` +
    `keep the scope narrow, and put the final acceptance criteria in findings. This is an analysis-only planning ` +
    `lane: do not attempt to create the artifact, and do not treat the expected lack of write access as a blocker.\n\n` +
    `Brief: ${task}\n` +
    `Artifact type: ${artifactType}\n` +
    `Output path: ${outputPath}\n` +
    `Constraints:\n${constraintText}\n\n` +
    `Research policy: ${researchPolicy}\n` +
    `Source context:\n${sourceContext}\n\n` +
    `Independent framing results:\n${JSON.stringify(usableFrames, null, 2)}`,
  {
    label: "planner",
    model: "gpt-5.6-terra",
    reasoning_effort: "medium",
    sandbox: "read-only",
    codex_bin: codexBin
  }
);
if (!isStructuredResult(plan)) {
  throw new Error("The planning worker failed; no artifact was created.");
}

phase("Build");
const build = await agent(
  `Create exactly one primary artifact at the relative workspace path \`${outputPath}\`.\n\n` +
    `Brief: ${task}\n` +
    `Artifact type: ${artifactType}\n` +
    `Constraints:\n${constraintText}\n\n` +
    `Research policy: ${researchPolicy}\n` +
    `Source context:\n${sourceContext}\n\n` +
    `Approved build plan:\n${JSON.stringify(plan, null, 2)}\n\n` +
    `Read any local source files needed. Keep unrelated files untouched. Do not send messages, publish, deploy, ` +
    `or mutate external systems. If the brief would require external authority, create a reviewable local draft ` +
    `instead and state that limitation. Validate the artifact in proportion to its format using direct, ` +
    `format-specific checks, confirm the file exists, and return a concise build report. Do not run repository or ` +
    `Git checks unless the brief requires them. Unavailable optional tooling is not a blocking finding when direct ` +
    `equivalent checks pass; record it as a risk if it is still useful. Put any actual write or required validation ` +
    `failure in findings. Return an empty findings ` +
    `array only after the requested artifact exists and passes those checks.`,
  {
    label: "builder",
    model: "gpt-5.6-sol",
    reasoning_effort: "medium",
    sandbox: "workspace-write",
    codex_bin: codexBin
  }
);
if (!isStructuredResult(build) || !hasVerificationEvidence(build) || build.findings.length > 0) {
  throw new Error("The build worker failed; inspect the run journal before retrying.");
}

phase("Review");
const reviewLenses = [
  {
    label: "brief-reviewer",
    prompt:
      `Inspect the real file \`${outputPath}\` against the original brief and constraints. Report only actionable ` +
      `gaps or errors in findings; use an empty findings array if it is ready.`
  },
  {
    label: "quality-reviewer",
    prompt:
      `Inspect the real file \`${outputPath}\` for internal correctness, clarity, completeness, and format-specific ` +
      `quality. Report only concrete, fixable issues in findings; use an empty findings array if it is ready.`
  }
];

const reviews = await parallel(
  reviewLenses.map(({ label, prompt }) => () =>
    agent(
      `${prompt}\n\nBrief: ${task}\nArtifact type: ${artifactType}\nConstraints:\n${constraintText}\n` +
        `Research policy: ${researchPolicy}\nSource context:\n${sourceContext}\n` +
        `Review only the requested artifact; do not browse or scan unrelated files. Use direct content and ` +
        `format checks; do not run repository or Git checks unless the brief requires them.`,
      {
        label,
        model: "gpt-5.6-luna",
        reasoning_effort: "low",
        sandbox: "read-only",
        codex_bin: codexBin
      }
    )
  )
);
const validReviews = reviews.filter(isStructuredResult);
if (validReviews.length !== reviewLenses.length) {
  throw new Error(
    `Review failed closed: expected ${reviewLenses.length} structured reviewer results, received ${validReviews.length}.`
  );
}
const reviewFindings = validReviews.flatMap((review) =>
  review.findings.filter(Boolean)
);
log(`review produced ${reviewFindings.length} actionable finding(s)`, {
  valid_reviews: validReviews.length,
  findings: reviewFindings.length
});

phase("Repair");
let repair = "No repair pass was needed because the reviewers returned no actionable findings.";
if (reviewFindings.length) {
  repair = await agent(
    `Re-open \`${outputPath}\` and assess every review finding below against the real file. Apply only corrections ` +
      `that are supported by the original brief or observable artifact. Do not expand scope. Re-run direct, ` +
      `format-specific checks, confirm the file still exists, and report what changed. Do not run repository or ` +
      `Git checks unless the brief requires them. Unavailable optional tooling is not a blocking finding when ` +
      `equivalent direct checks pass; record it as a risk if it is still useful. Put any actual write or required ` +
      `validation failure ` +
      `in findings. Return an empty findings array only after the requested artifact exists and passes those checks.\n\n` +
      `Brief: ${task}\nConstraints:\n${constraintText}\nResearch policy: ${researchPolicy}\n` +
      `Source context:\n${sourceContext}\n\n` +
      `Review findings:\n${reviewFindings.map((finding, index) => `${index + 1}. ${finding}`).join("\n")}`,
    {
      label: "repairer",
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
      sandbox: "workspace-write",
      codex_bin: codexBin
    }
  );
  if (!isStructuredResult(repair) || !hasVerificationEvidence(repair) || repair.findings.length > 0) {
    throw new Error("The repair worker failed after reviewers found issues; inspect the journal before accepting the artifact.");
  }
}

phase("Verify");
const verification = await agent(
  `Perform a final read-only acceptance check of \`${outputPath}\`. Use deterministic shell checks to confirm the ` +
    `path is a non-empty regular file inside the current workspace, then inspect its content. Use direct ` +
    `format-specific checks; do not run repository or Git checks unless the brief requires them. Confirm that it ` +
    `directly serves the brief, respects the constraints, and has no obvious unresolved defect. ` +
    `Return any blocking issue in findings; otherwise return an empty findings array and describe the checks in ` +
    `verification.\n\nBrief: ${task}\nArtifact type: ${artifactType}\nConstraints:\n${constraintText}\n` +
    `Research policy: ${researchPolicy}\nSource context:\n${sourceContext}\n` +
    `Review only the requested artifact; do not browse or scan unrelated files.`,
  {
    label: "final-verifier",
    model: "gpt-5.6-luna",
    reasoning_effort: "low",
    sandbox: "read-only",
    codex_bin: codexBin
  }
);
if (
  !isStructuredResult(verification) ||
  !hasVerificationEvidence(verification)
) {
  throw new Error("The final verification worker failed; the artifact exists but is not accepted by this workflow.");
}

const blocking = verification.findings.filter(Boolean);
if (blocking.length > 0) {
  throw new Error(`Final verification blocked acceptance: ${blocking.join(" | ")}`);
}

export default {
  task,
  output_path: outputPath,
  artifact_type: artifactType,
  framing_workers_completed: usableFrames.length,
  reviewers_completed: validReviews.length,
  build_report: build,
  review_findings: reviewFindings,
  repair_report: repair,
  final_verification: verification,
  accepted: true
};
