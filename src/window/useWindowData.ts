import { useCallback, useEffect, useRef, useState } from "react";
import type { PersistedComment } from "../core/comments";
import type { WindowDiffFile, WindowDiffScope, WindowWorkspace } from "./data";
import { reconcileDiffFiles, subscribeToDiffChanges } from "./diffRefresh";
import { groupWindowHunks, listWindowHunks, type WindowHunk } from "./review";
import type { WindowBootstrap } from "./windowBootstrap";

type WindowApi = <T>(path: string) => Promise<T>;
const startedAt = performance.now();

/** Load local review data independently of remote workspace integrations and preserve unchanged state. */
export function useWindowData({
  api,
  secret,
  bootstrap,
  scope,
  editing,
  onDiffLoaded,
  onWorkspaceLoaded,
  onError,
}: {
  api: WindowApi;
  secret: string;
  bootstrap: WindowBootstrap | undefined;
  scope: WindowDiffScope;
  editing: boolean;
  onDiffLoaded: (files: WindowDiffFile[], hunks: WindowHunk[]) => void;
  onWorkspaceLoaded: (workspace: WindowWorkspace) => void;
  onError: (message: string) => void;
}) {
  const [review, setReview] = useState(() => {
    const hunks = listWindowHunks(bootstrap?.files ?? []);
    return { files: bootstrap?.files ?? null, hunks, hunksByFile: groupWindowHunks(hunks) };
  });
  const currentReview = useRef(review);
  const [workspace, setWorkspace] = useState<WindowWorkspace | null>(bootstrap?.workspace ?? null);
  const [comments, setComments] = useState<PersistedComment[]>(bootstrap?.comments ?? []);
  const [userName, setUserName] = useState(bootstrap?.userName ?? "You");
  const [timing, setTiming] = useState("");
  const diffLoad = useRef(0);
  const liveEditing = useRef(editing);
  liveEditing.current = editing;
  const refreshPending = useRef(false);
  const reportError = useCallback(
    (error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    },
    [onError],
  );

  const reloadDiff = useCallback(() => {
    const requestId = ++diffLoad.current;
    void api<WindowDiffFile[]>(`/api/diff?scope=${scope}`)
      .then((files) => {
        if (requestId !== diffLoad.current) return;
        if (liveEditing.current) {
          refreshPending.current = true;
          return;
        }
        const previous = currentReview.current;
        const reconciled = reconcileDiffFiles(previous.files, files);
        const hunks =
          reconciled === previous.files
            ? previous.hunks
            : listWindowHunks(reconciled, previous.hunks);
        const next =
          reconciled === previous.files
            ? previous
            : {
                files: reconciled,
                hunks,
                hunksByFile: groupWindowHunks(hunks, previous.hunksByFile),
              };
        currentReview.current = next;
        setReview(next);
        onDiffLoaded(reconciled, next.hunks);
        setTiming((current) => current || `diff ${Math.round(performance.now() - startedAt)} ms`);
      })
      .catch(reportError);
  }, [api, scope, onDiffLoaded, reportError]);

  useEffect(
    () =>
      subscribeToDiffChanges(secret, () => {
        if (liveEditing.current) refreshPending.current = true;
        else reloadDiff();
      }),
    [secret, reloadDiff],
  );
  useEffect(() => {
    if (!editing && refreshPending.current) {
      refreshPending.current = false;
      reloadDiff();
    }
  }, [editing, reloadDiff]);
  const initialDiffLoaded = useRef(Boolean(bootstrap));
  useEffect(() => {
    if (initialDiffLoaded.current) initialDiffLoaded.current = false;
    else reloadDiff();
    return () => {
      diffLoad.current++;
    };
  }, [reloadDiff]);

  const reloadWorkspace = useCallback(() => {
    void api<WindowWorkspace>("/api/workspace")
      .then((loaded) => {
        setWorkspace(loaded);
        onWorkspaceLoaded(loaded);
        setTiming((current) =>
          [current, `workspace ${Math.round(performance.now() - startedAt)} ms`]
            .filter(Boolean)
            .join(" · "),
        );
      })
      .catch(reportError);
  }, [api, onWorkspaceLoaded, reportError]);
  useEffect(reloadWorkspace, [reloadWorkspace]);
  useEffect(() => {
    if (!bootstrap)
      void api<{ name: string }>("/api/me")
        .then((me) => setUserName(me.name))
        .catch(reportError);
  }, [api, bootstrap, reportError]);

  const commentsLoad = useRef<Promise<void> | null>(null);
  const commentsRefreshPending = useRef(false);
  const loadComments = useCallback(() => {
    if (commentsLoad.current) {
      // A mutation may finish after the in-flight read started; queue a fresh read behind it.
      commentsRefreshPending.current = true;
      return commentsLoad.current;
    }
    async function refresh() {
      do {
        commentsRefreshPending.current = false;
        try {
          const next = await api<PersistedComment[]>("/api/comments");
          setComments((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next,
          );
        } catch (error) {
          reportError(error);
        }
      } while (commentsRefreshPending.current);
    }
    const loading = refresh().finally(() => {
      commentsLoad.current = null;
    });
    commentsLoad.current = loading;
    return loading;
  }, [api, reportError]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    /** Wait for the current read before scheduling another, including after a failed request. */
    async function poll() {
      await loadComments();
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [loadComments]);

  const reload = useCallback(() => {
    reloadDiff();
    reloadWorkspace();
  }, [reloadDiff, reloadWorkspace]);
  return {
    diff: review.files,
    hunks: review.hunks,
    hunksByFile: review.hunksByFile,
    workspace,
    comments,
    userName,
    timing,
    reload,
    loadComments,
  };
}
