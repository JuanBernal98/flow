/** File-based desktop commit proposals: prepare, approve, and execute exactly one reviewed plan. */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, posix } from "node:path";
import { z } from "zod";
import { writeCommitProposalRequest } from "./agentRequests";
import { FLOW_DIR } from "./flowPaths";
import { FlowUserError } from "./errors";
import { readRepoIntegrations } from "./repoIntegrations";

const Text = z.string().trim().min(1);
const Sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const FilePath = Text.refine(
  (path) =>
    !path.includes("\\") &&
    !path.includes("\0") &&
    !posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    path !== ".." &&
    !path.startsWith("../") &&
    path !== ".flow" &&
    !path.startsWith(".flow/") &&
    path !== ".git" &&
    !path.startsWith(".git/"),
  "Use repository-relative file paths outside .flow and .git.",
);

const StoredCommitPlanSchema = z
  .object({
    agentName: Text,
    commits: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({ kind: z.literal("commit"), message: Text, files: z.array(FilePath).min(1) })
            .strict(),
          z
            .object({
              kind: z.literal("fixup"),
              target: Sha,
              message: Text,
              files: z.array(FilePath).min(1),
            })
            .strict(),
        ]),
      )
      .min(1),
  })
  .strict();

/** Legacy plans remain readable so the window can replace them, but cannot rewrite history. */
export const CommitPlanSchema = StoredCommitPlanSchema.refine(
  (plan) => plan.commits.every((commit) => commit.kind === "commit"),
  "Flow creates new commits only. Request a new proposal without fixups.",
);

const SnapshotSchema = z.object({
  branch: Text,
  head: Sha,
  fingerprint: Text,
  files: z.array(FilePath),
});
const StoredSchema = z.object({
  schema: z.literal(1),
  id: z.string().uuid(),
  status: z.enum([
    "preparing",
    "ready",
    "approved",
    "executing",
    "completed",
    "cancelled",
    "failed",
  ]),
  snapshot: SnapshotSchema,
  plan: StoredCommitPlanSchema.optional(),
  selection: z.array(FilePath).optional(),
  claimedBy: Text.optional(),
  approvedCommits: z.array(z.number().int().nonnegative()).optional(),
  completed: z.number().int().nonnegative(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type CommitProposal = z.infer<typeof StoredSchema>;
export type CommitPlan = z.infer<typeof CommitPlanSchema>;
type Snapshot = z.infer<typeof SnapshotSchema>;

/** A changed snapshot needs a fresh proposal and fresh approval, rather than a manual cancel. */
export class StaleCommitProposalError extends FlowUserError {
  constructor(readonly proposalId: string) {
    super("The repository changed. Preparing an updated proposal.");
  }
}

/** Git subprocesses never acquire a visible Windows console or interpret filenames as pathspecs. */
function git(
  repoRoot: string,
  args: string[],
  input?: string,
  extraEnv: Record<string, string> = {},
) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    windowsHide: true,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1", ...extraEnv },
  });
  if (result.exitCode !== 0)
    throw new FlowUserError(result.stderr.toString().trim() || `git ${args[0]} failed.`);
  return result.stdout.toString();
}

/** Capture the branch, index, and every changed file, including untracked contents and deletions. */
function snapshot(repoRoot: string, selection?: readonly string[]): Snapshot {
  const branch = git(repoRoot, ["symbolic-ref", "--short", "HEAD"]).trim();
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  const pendingFiles = [
    ...new Set(
      [
        ...git(repoRoot, ["diff", "--no-renames", "--name-only", "-z", "HEAD", "--"]).split("\0"),
        ...git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
      ].filter((path) => path && path !== ".flow" && !path.startsWith(".flow/")),
    ),
  ].sort();
  const files = selection ? [...selection].sort() : pendingFiles;
  const hash = createHash("sha256").update(branch).update(head);
  hash.update(
    git(repoRoot, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD",
      "--",
      ...files,
    ]),
  );
  for (const path of files) {
    hash.update(JSON.stringify(path));
    const fullPath = join(repoRoot, path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(fullPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        hash.update("deleted");
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) hash.update("link").update(readlinkSync(fullPath));
    else if (stat.isFile()) hash.update(String(stat.mode)).update(readFileSync(fullPath));
    else throw new FlowUserError(`Commit proposals do not support changed submodules: ${path}.`);
  }
  return { branch, head, files, fingerprint: hash.digest("hex") };
}

/** Read only validated state; a missing proposal means no desktop commit is active. */
export function readCommitProposal(repoRoot: string): CommitProposal | null {
  const path = join(repoRoot, FLOW_DIR, "commit-proposal.json");
  if (!existsSync(path)) return null;
  return StoredSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Desktop polling must yield while the filesystem reads the proposal. */
export async function readCommitProposalAsync(repoRoot: string): Promise<CommitProposal | null> {
  const file = Bun.file(join(repoRoot, FLOW_DIR, "commit-proposal.json"));
  if (!(await file.exists())) return null;
  return StoredSchema.parse(await file.json());
}

/** Publish a complete state atomically for the window's next poll. */
function save(repoRoot: string, proposal: CommitProposal) {
  const directory = join(repoRoot, FLOW_DIR);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.commit-proposal.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(StoredSchema.parse(proposal), null, 2)}\n`);
  renameSync(temporary, join(directory, "commit-proposal.json"));
  return proposal;
}

/** Serialize state transitions across the HTTP server and agent CLI processes. */
function locked<T>(repoRoot: string, action: () => T): T {
  mkdirSync(join(repoRoot, FLOW_DIR), { recursive: true });
  const path = join(repoRoot, FLOW_DIR, "commit-proposal.lock");
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx");
  } catch {
    throw new FlowUserError("Another commit proposal operation is in progress.");
  }
  try {
    return action();
  } finally {
    closeSync(descriptor);
    unlinkSync(path);
  }
}

/** Require the exact request and phase so late replies cannot overwrite a newer proposal. */
function requireProposal(repoRoot: string, id: string, states: CommitProposal["status"][]) {
  const proposal = readCommitProposal(repoRoot);
  if (!proposal || proposal.id !== id || !states.includes(proposal.status))
    throw new FlowUserError("This commit request is no longer active in the expected phase.");
  return proposal;
}

/** Reject a plan as soon as its repository contents or checkout differs from what was reviewed. */
function requireUnchanged(repoRoot: string, proposal: CommitProposal) {
  if (snapshot(repoRoot, proposal.selection).fingerprint !== proposal.snapshot.fingerprint)
    throw new StaleCommitProposalError(proposal.id);
}

/** Start a proposal scoped to the selected files, or all pending work when none are selected. */
export function requestCommitProposal(
  repoRoot: string,
  selectedFiles: readonly string[] = [],
  replace = false,
  expectedId?: string,
) {
  return locked(repoRoot, () => {
    const existing = readCommitProposal(repoRoot);
    if (expectedId && existing?.id !== expectedId) {
      if (existing) return existing;
      throw new FlowUserError("This commit request is no longer active.");
    }
    let current = snapshot(repoRoot);
    let selection: string[] | undefined;
    if (selectedFiles.length) {
      selection = [...new Set(selectedFiles)];
      for (const path of selection) {
        FilePath.parse(path);
        if (!current.files.includes(path))
          throw new FlowUserError(`No pending changes for selected file: ${path}.`);
      }
      // A rename is one file action: selecting its destination also includes the old path's deletion.
      const statuses = git(repoRoot, [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "HEAD",
      ]).split("\0");
      for (let index = 0; index < statuses.length;) {
        const status = statuses[index++] ?? "";
        const path = statuses[index++];
        if (status.startsWith("R")) {
          const destination = statuses[index++];
          if (path && destination && (selection.includes(path) || selection.includes(destination)))
            selection.push(path, destination);
        }
      }
      selection = [...new Set(selection)].sort();
      current = snapshot(repoRoot, selection);
    }
    if (existing && ["preparing", "ready", "approved", "executing"].includes(existing.status)) {
      if (replace && (existing.status === "approved" || existing.status === "executing"))
        throw new FlowUserError(
          "Wait for the approved commits to finish before requesting another proposal.",
        );
      if (!replace) {
        if (
          existing.status === "approved" ||
          existing.status === "executing" ||
          current.fingerprint === existing.snapshot.fingerprint
        )
          return existing;
      }
    }
    if (current.branch === readRepoIntegrations(repoRoot).workflow.baseBranch)
      throw new FlowUserError("Switch to a feature branch before proposing commits.");
    if (!current.files.length) throw new FlowUserError("No uncommitted changes to propose.");
    const proposal = save(repoRoot, {
      schema: 1,
      id: randomUUID(),
      status: "preparing",
      snapshot: current,
      completed: 0,
      ...(selection ? { selection } : {}),
    });
    writeCommitProposalRequest(
      repoRoot,
      proposal.id,
      "propose",
      /^[A-Z]+-\d+/.exec(current.branch)?.[0],
    );
    return proposal;
  });
}

/** Replace a stale, unapproved proposal while preserving its remaining selected files. */
export function refreshCommitProposal(repoRoot: string, id: string) {
  const proposal = readCommitProposal(repoRoot);
  if (
    !proposal ||
    proposal.id !== id ||
    (proposal.status !== "ready" && proposal.status !== "preparing")
  )
    return proposal;
  const pending = snapshot(repoRoot);
  const selection = proposal.selection?.filter((path) => pending.files.includes(path));
  if (
    !pending.files.length ||
    (selection && !selection.length) ||
    pending.branch !== proposal.snapshot.branch
  )
    return cancelCommitProposal(repoRoot, id);
  return requestCommitProposal(repoRoot, selection, true, id);
}

/** Revalidate a ready proposal when the window is opened or regains focus, without idle polling. */
export function readCurrentCommitProposal(repoRoot: string, proposal: CommitProposal | null) {
  if (
    proposal?.status === "ready" &&
    snapshot(repoRoot, proposal.selection).fingerprint !== proposal.snapshot.fingerprint
  )
    return refreshCommitProposal(repoRoot, proposal.id);
  return proposal;
}

/** Acknowledge that an agent picked up the request, without approving or changing its scope. */
export function claimCommitProposal(repoRoot: string, id: string, agentName: string) {
  return locked(repoRoot, () =>
    save(repoRoot, {
      ...requireProposal(repoRoot, id, ["preparing"]),
      claimedBy: Text.parse(agentName),
    }),
  );
}

/** Validate the agent's plan and ensure every changed path belongs to exactly one commit. */
export function publishCommitProposal(repoRoot: string, id: string, input: unknown) {
  const plan = CommitPlanSchema.parse(input);
  return locked(repoRoot, () => {
    const proposal = requireProposal(repoRoot, id, ["preparing"]);
    requireUnchanged(repoRoot, proposal);
    const files = plan.commits.flatMap((commit) => commit.files);
    if (
      new Set(files).size !== files.length ||
      [...files].sort().join("\0") !== proposal.snapshot.files.join("\0")
    )
      throw new FlowUserError(
        "Assign every pending file to exactly one commit, without adding other paths.",
      );
    for (const commit of plan.commits) {
      if (/^Co-Authored-By:/im.test(commit.message))
        throw new FlowUserError("Commit messages must not include Co-Authored-By trailers.");
    }
    return save(repoRoot, { ...proposal, status: "ready", plan });
  });
}

/** Record explicit window approval before local execution can start. */
export function approveCommitProposal(
  repoRoot: string,
  id: string,
  selectedCommits?: readonly number[],
) {
  return locked(repoRoot, () => {
    const proposal = requireProposal(repoRoot, id, ["ready"]);
    requireUnchanged(repoRoot, proposal);
    const plan = proposal.plan;
    if (!plan) throw new FlowUserError("No proposal to approve.");
    CommitPlanSchema.parse(plan);
    const indexes = selectedCommits ? [...selectedCommits] : plan.commits.map((_, index) => index);
    if (
      !indexes.length ||
      new Set(indexes).size !== indexes.length ||
      indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= plan.commits.length)
    )
      throw new FlowUserError("Select at least one valid commit, without duplicate indexes.");
    indexes.sort((left, right) => left - right);
    return save(repoRoot, { ...proposal, status: "approved", approvedCommits: indexes });
  });
}

/** Cancel pending work; once execution starts its real result must remain visible. */
export function cancelCommitProposal(repoRoot: string, id: string) {
  return locked(repoRoot, () =>
    save(repoRoot, {
      ...requireProposal(repoRoot, id, ["preparing", "ready", "approved"]),
      status: "cancelled",
    }),
  );
}

/** Let an agent surface a planning failure in the same dialog instead of leaving it waiting. */
export function failCommitProposal(repoRoot: string, id: string, error: string) {
  return locked(repoRoot, () =>
    save(repoRoot, {
      ...requireProposal(repoRoot, id, ["preparing"]),
      status: "failed",
      error: Text.parse(error),
    }),
  );
}

/** Execute only an approved, unchanged plan. Hooks run normally; failures stop without rollback. */
export function executeCommitProposal(repoRoot: string, id: string) {
  let proposal = locked(repoRoot, () => {
    const pending = requireProposal(repoRoot, id, ["approved"]);
    try {
      requireUnchanged(repoRoot, pending);
    } catch (error) {
      save(repoRoot, {
        ...pending,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return save(repoRoot, { ...pending, status: "executing" });
  });
  try {
    if (!proposal.plan) throw new FlowUserError("No commit plan was approved.");
    CommitPlanSchema.parse(proposal.plan);
    const plan = {
      ...proposal.plan,
      commits: (proposal.approvedCommits ?? proposal.plan.commits.map((_, index) => index)).map(
        (index) => proposal.plan!.commits[index]!,
      ),
    };
    for (const commit of plan.commits) {
      git(repoRoot, ["add", "--", ...commit.files]);
      git(repoRoot, ["commit", "--only", "-F", "-", "--", ...commit.files], commit.message);
      proposal = save(repoRoot, { ...proposal, completed: proposal.completed + 1 });
    }
    const result = git(repoRoot, [
      "log",
      "--format=%h %s",
      `${proposal.snapshot.head}..HEAD`,
    ]).trim();
    return save(repoRoot, { ...proposal, status: "completed", result });
  } catch (error) {
    return save(repoRoot, {
      ...proposal,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
