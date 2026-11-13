import type { PersistedComment } from "../core/comments";
import type { WindowDiffFile, WindowThemes, WindowWorkspace } from "./data";
import type { WindowPreferences } from "./preferences";
import { windowThemeStyles } from "./windowTheme";

/** Local data is passed over the child process's stdin, never exposed in a public HTML response. */
export interface WindowBootstrap {
  themes: WindowThemes;
  preferences: WindowPreferences;
  files: WindowDiffFile[];
  comments: PersistedComment[];
  workspace: WindowWorkspace;
  userName: string;
}

/** Apply the configured theme before the parser's first paint, then hydrate React from the same data. */
export function windowBootstrapScript(bootstrap: WindowBootstrap) {
  const styles = Object.fromEntries(
    (["light", "dark"] as const).map((appearance) => {
      const id =
        bootstrap.themes.configured === "claude"
          ? `claude-${appearance}`
          : bootstrap.themes.configured;
      const theme =
        bootstrap.themes.themes.find((candidate) => candidate.id === id) ??
        bootstrap.themes.themes.find((candidate) => candidate.id === "zed") ??
        bootstrap.themes.themes[0];
      if (!theme) throw new Error("No desktop themes are available.");
      return [appearance, windowThemeStyles(theme)];
    }),
  );
  return `window.flowBootstrap=${JSON.stringify(bootstrap)};
(() => {
  const styles=${JSON.stringify(styles)};
  const apply=()=>{
    const root=document.documentElement;
    if(!root)return false;
    const appearance=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    for(const [name,value] of Object.entries(styles[appearance]))root.style.setProperty(name,value);
    root.style.setProperty('--diff-font-size',window.flowBootstrap.preferences.diffFontSize+'px');
    root.style.setProperty('--diff-line-height',Math.round(window.flowBootstrap.preferences.diffFontSize*1.6)+'px');
    return true;
  };
  if(!apply()){
    const observer=new MutationObserver(()=>{if(apply())observer.disconnect();});
    observer.observe(document,{childList:true});
  }
})();`;
}
