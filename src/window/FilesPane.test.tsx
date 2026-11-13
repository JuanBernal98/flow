/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WindowDiffFile } from "./data";
import { FilesPane } from "./FilesPane";

const files: WindowDiffFile[] = [
  { path: "src/staged.ts", patch: "", status: "added", additions: 3, deletions: 0 },
  { path: "src/app.ts", patch: "", status: "modified", additions: 12, deletions: 2 },
  { path: "src/new.ts", patch: "", status: "added", untracked: true, additions: 8, deletions: 0 },
];

/** Render the real navigation pane with controlled selection. */
function renderTestFilesPane(
  selectedPaths: ReadonlySet<string> = new Set(),
  currentFiles: WindowDiffFile[] | null = files,
) {
  return renderToStaticMarkup(
    <FilesPane
      files={currentFiles}
      activePath="src/app.ts"
      selectedPaths={selectedPaths}
      onSelectionChange={() => {}}
      onOpen={() => {}}
    />,
  );
}

describe("window change navigation", () => {
  test("separates untracked files from tracked additions and shows status instead of document icons", () => {
    const html = renderTestFilesPane();
    const [tracked, untracked] = html.split('aria-label="Untracked"');
    expect(tracked).toContain("staged.ts");
    expect(tracked).toContain('aria-label="Added"');
    expect(tracked).toContain('aria-label="Modified"');
    expect(tracked).toContain('viewBox="0 0 16 16"');
    expect(tracked).toContain('<circle cx="8" cy="8" r="5"></circle>');
    expect(html).not.toContain("stroke-dasharray");
    expect(html).toContain('aria-label="Untracked" style="color:var(--muted)"');
    expect(tracked).toContain("+12");
    expect(tracked).not.toContain("new.ts");
    expect(untracked).toContain("new.ts");
    expect(untracked).not.toContain('class="stat"');
    expect(html).not.toContain('class="file-icon"');
    expect(html).toContain('data-phase="propose"');
    expect(html).toContain("Propose</button>");
    expect(html.slice(html.indexOf('<footer class="files-footer">'))).not.toContain(
      "Commit</button>",
    );
  });

  test("keeps navigation independent from multi-file selection and selects whole groups", () => {
    const html = renderTestFilesPane(new Set(["src/staged.ts", "src/new.ts"]));
    expect(html).toContain('aria-current="location"');
    expect(html).toContain('aria-label="Select src/staged.ts" checked=""');
    expect(html).not.toContain('aria-label="Select src/app.ts" checked=""');
    expect(html).toContain('aria-label="Select all untracked files" checked=""');
    expect(html).not.toContain('aria-label="Select all tracked files" checked=""');
    expect(renderTestFilesPane(new Set(files.map((file) => file.path)))).toContain(
      'aria-label="Select all tracked files" checked=""',
    );
  });

  test("shows loading and empty states without empty group headings", () => {
    const heading = 'id="changes-tab" aria-selected="true" aria-controls="changes-panel">';
    expect(renderTestFilesPane()).toContain(heading);
    expect(renderTestFilesPane()).toContain("Changes (3)");
    const loading = renderTestFilesPane(new Set(), null);
    expect(loading).toContain(heading);
    expect(loading).toContain("Loading changes");
    const empty = renderTestFilesPane(new Set(), []);
    expect(empty).toContain(heading);
    expect(empty).toContain("Changes (0)");
    expect(empty).toContain("No changes");
    expect(empty).not.toContain('class="file-group"');
  });

  test("committed branch files remain navigable but cannot be selected for Propose", () => {
    const html = renderTestFilesPane(new Set(), [{ ...files[0]!, pending: false }]);
    expect(html).toContain('aria-label="Select src/staged.ts" disabled=""');
    expect(html).toContain('title="Already committed on this branch"');
    expect(html).toContain('class="file-open"');
  });
});
