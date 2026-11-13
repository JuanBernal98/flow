import type { SidebarEntry } from "./files";
import type { AppTheme } from "../themes";

/** Shared geometric status symbols for terminal and desktop file navigation. */
export function getFileStateIcon(
  entry: Pick<SidebarEntry, "isUntracked" | "changeType">,
  theme: Pick<
    AppTheme,
    "fileUntracked" | "fileNew" | "fileDeleted" | "fileRenamed" | "fileModified" | "text"
  >,
): { icon: string; color: string } {
  if (entry.isUntracked) return { icon: "◌", color: theme.fileUntracked };
  switch (entry.changeType) {
    case "new":
      return { icon: "+", color: theme.fileNew };
    case "deleted":
      return { icon: "−", color: theme.fileDeleted };
    case "rename-pure":
    case "rename-changed":
      return { icon: "→", color: theme.fileRenamed };
    case "change":
      return { icon: "○", color: theme.fileModified };
    default:
      return { icon: "", color: theme.text };
  }
}
