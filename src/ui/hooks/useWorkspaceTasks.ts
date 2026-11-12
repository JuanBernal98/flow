import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceTasksResult } from "../../core/youtrack";
import type { WorkspaceTasksState } from "../lib/workspace";

const NO_LOADER_STATE: WorkspaceTasksState = {
  kind: "unconfigured",
  message: "Tasks are not connected",
};

/** Own the Tasks load for the whole session: load once on mount, reload on demand. */
export function useWorkspaceTasks(loader?: () => Promise<WorkspaceTasksResult>) {
  const [tasks, setTasks] = useState<WorkspaceTasksState>(
    loader ? { kind: "loading" } : NO_LOADER_STATE,
  );
  // Only the newest request may land, so a slow earlier load never overwrites a refresh.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(() => {
    if (!loader) {
      return;
    }
    const requestId = ++latestRequestRef.current;
    // Loaded tasks stay on screen until the new ones land, so a reload never blanks the workspace.
    setTasks((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    void loader()
      .catch((): WorkspaceTasksResult => ({ kind: "error", message: "Could not load tasks" }))
      .then((result) => {
        if (requestId === latestRequestRef.current) {
          setTasks(result);
        }
      });
  }, [loader]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tasks, refresh };
}
