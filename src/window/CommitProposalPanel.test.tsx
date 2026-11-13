/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitProposalPanel } from "./CommitProposalPanel";
import type { CommitProposal } from "../core/commitProposal";
import { FilesPane } from "./FilesPane";

const proposal: CommitProposal = {
  schema: 1,
  id: "test",
  status: "ready",
  completed: 0,
  snapshot: {
    branch: "PROJ-42-review",
    head: "abc",
    fingerprint: "test",
    files: ["src/a.ts", "src/b.ts"],
  },
  plan: {
    agentName: "Codex",
    commits: [
      {
        kind: "commit",
        message: "fix: preserve review position\n\nExplain the behavior.",
        files: ["src/a.ts"],
      },
      {
        kind: "fixup",
        target: "1234567890abcdef",
        message: "fixup! feat: add review",
        files: ["src/b.ts"],
      },
    ],
  },
};

/** Render the real sidebar panel in each lifecycle phase. */
function renderTestPanel(value: CommitProposal | null) {
  return renderToStaticMarkup(
    <FilesPane
      files={[]}
      activePath={null}
      selectedPaths={new Set()}
      onSelectionChange={() => {}}
      onOpen={() => {}}
      proposal={
        <CommitProposalPanel proposal={value} pending={false} error={null} onApprove={() => {}} />
      }
    />,
  );
}

test("the approval panel shares Changes chrome and shows selectable groups without extra metadata", () => {
  const html = renderTestPanel(proposal);
  for (const text of [
    "fix: preserve review position",
    "Explain the behavior.",
    "src/a.ts",
    "src/b.ts",
    "12345678",
    "rewrites local history",
    "Commit</button>",
  ])
    expect(html).toContain(text);
  expect(html).toContain('aria-labelledby="commit-tab"');
  expect(html).toContain("Changes (0)");
  expect(html).toContain('id="commit-tab" aria-selected="true"');
  expect(html).not.toContain("Cancel proposal");
  expect(html).not.toContain("Back to changes");
  expect(html).not.toContain("Preparing your commits");
  expect(html).not.toContain("Proposed by");
  expect(html).not.toContain("Commits stay local");
  expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2);
  const footer = html.slice(html.indexOf('<footer class="commit-panel-footer">'));
  expect(footer).not.toContain("Cancel proposal");
  expect(html).toContain('class="commit-panel"');
  expect(html).not.toContain("<dialog");
  expect(html.match(/<details class="file"[^>]* open="">/g)).toHaveLength(2);
  expect(html).toContain('<summary class="file-header">');
  expect(html).toContain('class="file-row ');
  expect(html).toContain('class="file-name">a.ts');
  expect(html).toContain('class="file-dir">src');
});

test("only a ready proposal exposes approval; waiting and execution announce their real states", () => {
  expect(renderTestPanel(null)).toContain("Select files in Changes");
  for (const status of [
    "preparing",
    "approved",
    "executing",
    "completed",
    "cancelled",
    "failed",
  ] as const) {
    const html = renderTestPanel({
      ...proposal,
      status,
      error: status === "failed" ? "Hook rejected" : undefined,
    });
    const footer = html.slice(html.indexOf('<footer class="commit-panel-footer">'));
    expect(footer).not.toContain("Commit</button>");
    if (status === "executing") expect(html).not.toContain("Cancel proposal");
    if (status === "failed") expect(html).toContain("Hook rejected");
  }
});

test("cancelled proposals use a centered empty state instead of a negative sentence or stale groups", () => {
  const html = renderTestPanel({ ...proposal, status: "cancelled" });
  expect(html).toContain("Ready to propose");
  expect(html).toContain('class="commit-empty"');
  expect(html).not.toContain("No commits will");
  expect(html).not.toContain('class="commit-plan"');
});

test("the loading message distinguishes waiting from an agent that has actually picked up the request", () => {
  expect(renderTestPanel({ ...proposal, status: "preparing", plan: undefined })).toContain(
    "Waiting for your agent",
  );
  expect(
    renderTestPanel({ ...proposal, status: "preparing", plan: undefined, claimedBy: "Codex" }),
  ).toContain("Grouping 2 files");
});
