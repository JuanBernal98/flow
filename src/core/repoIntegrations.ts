/**
 * Which outside services a repository connects to, read only from its own `.flow/config.toml`.
 * A repository without these sections connects to nothing, so flow opens there as a plain diff
 * viewer. Secrets never live here: the YouTrack token stays in the Keychain or the environment.
 *
 * ```toml
 * [youtrack]
 * url = "https://youtrack.example.com"
 * merged_state = "Done"   # optional; my tickets in Review move here once their MR is merged
 * project_keys = ["PROJ"]  # optional; only these projects' ids count as ticket ids in MRs
 *
 * [gitlab]
 * review_label = "my-team"   # optional; without it Reviews stays empty
 * ```
 */
import fs from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FLOW_CONFIG_RELATIVE_PATH } from "./flowPaths";

export interface RepoIntegrations {
  /** YouTrack instance for the workspace's tickets; absent means no tickets. */
  youtrackUrl?: string;
  /** State my tickets in Review move to once their MR is merged; absent means never move them. */
  mergedState?: string;
  /** Projects whose ids count as tickets in MR branches and titles; empty means any. */
  projectKeys: string[];
  /** Whether GitLab is on: ticket MR links and Reviews, read through `glab`. */
  gitlab: boolean;
  /** Label that marks the squad's merge requests listed under Reviews. */
  reviewLabel?: string;
}

const NO_INTEGRATIONS: RepoIntegrations = { gitlab: false, projectKeys: [] };

const IntegrationsSchema = z.object({
  youtrack: z
    .object({
      url: z.string().trim().min(1).optional(),
      merged_state: z.string().trim().min(1).optional(),
      project_keys: z
        .array(
          z
            .string()
            .trim()
            .regex(/^[A-Z][A-Z0-9]+$/),
        )
        .optional(),
    })
    .optional(),
  gitlab: z.object({ review_label: z.string().trim().min(1).optional() }).optional(),
});

/** Read a repository's integrations; a missing or malformed config connects to nothing. */
export function readRepoIntegrations(repoRoot: string | null | undefined): RepoIntegrations {
  if (!repoRoot) {
    return NO_INTEGRATIONS;
  }
  const path = join(repoRoot, FLOW_CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(path)) {
    return NO_INTEGRATIONS;
  }
  try {
    const parsed = IntegrationsSchema.safeParse(Bun.TOML.parse(fs.readFileSync(path, "utf8")));
    if (!parsed.success) {
      return NO_INTEGRATIONS;
    }
    return {
      youtrackUrl: parsed.data.youtrack?.url,
      mergedState: parsed.data.youtrack?.merged_state,
      projectKeys: parsed.data.youtrack?.project_keys ?? [],
      gitlab: parsed.data.gitlab !== undefined,
      reviewLabel: parsed.data.gitlab?.review_label,
    };
  } catch {
    return NO_INTEGRATIONS;
  }
}

/** Whether a repository connects to anything the workspace can list. */
export function hasWorkspaceIntegrations(integrations: RepoIntegrations) {
  return integrations.youtrackUrl !== undefined || integrations.gitlab;
}
