import type { FileDiffMetadata } from "@pierre/diffs";

export type LayoutMode = "auto" | "split" | "stack";

/** Inclusive 1-based [start, end] line range used by annotations and persisted comments. */
export type LineRange = [number, number];

/** One inline annotation rendered alongside a diff hunk. Carries a user comment. */
export interface Annotation {
  id?: string;
  oldRange?: LineRange;
  newRange?: LineRange;
  summary?: string;
  rationale?: string;
  /** Agent answers to a user comment, oldest first, shown under it. */
  replies?: string[];
  /** Who wrote a review comment; the card labels it `You:` or `Claude:`. */
  author?: "user" | "agent";
}

export interface DiffFile {
  id: string;
  path: string;
  previousPath?: string;
  patch: string;
  language?: string;
  stats: {
    additions: number;
    deletions: number;
  };
  metadata: FileDiffMetadata;
  annotations: Annotation[];
  isUntracked?: boolean;
  isBinary?: boolean;
  isTooLarge?: boolean;
  statsTruncated?: boolean;
}

export interface Changeset {
  id: string;
  sourceLabel: string;
  title: string;
  summary?: string;
  files: DiffFile[];
}

export interface CommonOptions {
  mode?: LayoutMode;
  theme?: string;
  pager?: boolean;
  watch?: boolean;
  excludeUntracked?: boolean;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  hunkHeaders?: boolean;
  /** Open the file tree at startup. */
  fileTree?: boolean;
  /** Open the ticket Overview pane at startup. */
  overview?: boolean;
  selectionAutoCopy?: boolean;
  /** Default base ref for `flow diff --branch` when no explicit base is passed. */
  branchReviewBase?: string;
}

/** Branch-review request attached to a `flow diff` invocation. */
export interface BranchReviewRequest {
  /** Base ref the user typed on the CLI, if any. */
  explicitBase?: string;
  /**
   * Set when branch review is only `flow diff`'s default rather than asked for: a repository
   * with no resolvable base then falls back to the working tree instead of failing.
   */
  implicit?: boolean;
}

export interface PersistedViewPreferences {
  mode: LayoutMode;
  theme?: string;
  showLineNumbers: boolean;
  wrapLines: boolean;
  showHunkHeaders: boolean;
  showFileTree: boolean;
  showOverview: boolean;
  selectionAutoCopy: boolean;
}

export interface HelpCommandInput {
  kind: "help";
  text: string;
}

/** `flow watch`: stream review events for a coding agent's terminal until replaced. */
export interface AgentWatchCommandInput {
  kind: "agent-watch";
}

export interface PagerCommandInput {
  kind: "pager";
  options: CommonOptions;
}

export interface VcsCommandInput {
  kind: "vcs";
  range?: string;
  staged: boolean;
  pathspecs?: string[];
  options: CommonOptions;
  /** Present when the user invoked `flow diff --branch[=base]`. */
  branchReview?: BranchReviewRequest;
}

export interface ShowCommandInput {
  kind: "show";
  ref?: string;
  pathspecs?: string[];
  options: CommonOptions;
}

export interface StashShowCommandInput {
  kind: "stash-show";
  ref?: string;
  options: CommonOptions;
}

export interface FileCommandInput {
  kind: "diff";
  left: string;
  right: string;
  options: CommonOptions;
}

export interface PatchCommandInput {
  kind: "patch";
  file?: string;
  text?: string;
  options: CommonOptions;
}

export interface DiffToolCommandInput {
  kind: "difftool";
  left: string;
  right: string;
  path?: string;
  options: CommonOptions;
}

export type CliInput =
  | VcsCommandInput
  | ShowCommandInput
  | StashShowCommandInput
  | FileCommandInput
  | PatchCommandInput
  | DiffToolCommandInput;

export type ParsedCliInput =
  | CliInput
  | HelpCommandInput
  | PagerCommandInput
  | AgentWatchCommandInput;

export interface AppBootstrap {
  input: CliInput;
  changeset: Changeset;
  initialMode: LayoutMode;
  initialTheme?: string;
  initialShowLineNumbers?: boolean;
  initialWrapLines?: boolean;
  initialShowHunkHeaders?: boolean;
  initialShowFileTree?: boolean;
  initialShowOverview?: boolean;
  initialSelectionAutoCopy?: boolean;
  /** User comments that cannot be rendered in the current diff. */
  driftedComments?: DriftedCommentSummary[];
  /** The base a branch review compares against (e.g. "origin/main"); absent otherwise. */
  branchBase?: string;
}

export type DriftReason = "missing-file" | "out-of-range" | "anchor-mismatch" | "not-in-hunk";

/** Snapshot of a drifted user comment, surfaced to the UI for top-of-diff rendering. */
export interface DriftedCommentSummary {
  id: number;
  file: string;
  line: number;
  body: string;
  reason: DriftReason;
}
