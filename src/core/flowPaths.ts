/** Repo-relative paths under `.flow/` shared by comments, agent requests, watch mode, and config. */
import { join } from "node:path";

export const FLOW_DIR = ".flow";

export const FLOW_COMMENTS_FILENAME = "comments.json";
export const FLOW_REQUESTS_FILENAME = "requests.json";
const FLOW_CONFIG_FILENAME = "config.toml";

export const FLOW_COMMENTS_RELATIVE_PATH = join(FLOW_DIR, FLOW_COMMENTS_FILENAME);
export const FLOW_CONFIG_RELATIVE_PATH = join(FLOW_DIR, FLOW_CONFIG_FILENAME);
export const FLOW_REQUESTS_RELATIVE_PATH = join(FLOW_DIR, FLOW_REQUESTS_FILENAME);
