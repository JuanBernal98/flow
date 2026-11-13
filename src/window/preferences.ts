export const DEFAULT_DIFF_FONT_SIZE = 16;
export const MIN_DIFF_FONT_SIZE = 10;
export const MAX_DIFF_FONT_SIZE = 24;
export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 640;

export interface WindowPreferences {
  diffFontSize: number;
  sidebarWidth?: number;
}

/** Normalize saved preferences without accepting invalid or unreadable font sizes. */
export function normalizeWindowPreferences(value: unknown): WindowPreferences {
  const sidebarWidth =
    typeof value === "object" && value !== null && "sidebarWidth" in value
      ? value.sidebarWidth
      : undefined;
  const fontSize =
    typeof value === "object" && value !== null && "diffFontSize" in value
      ? value.diffFontSize
      : undefined;
  return {
    ...(typeof sidebarWidth === "number" &&
    Number.isFinite(sidebarWidth) &&
    sidebarWidth >= MIN_SIDEBAR_WIDTH &&
    sidebarWidth <= MAX_SIDEBAR_WIDTH
      ? { sidebarWidth: Math.round(sidebarWidth) }
      : {}),
    diffFontSize:
      typeof fontSize === "number" &&
      Number.isFinite(fontSize) &&
      fontSize >= MIN_DIFF_FONT_SIZE &&
      fontSize <= MAX_DIFF_FONT_SIZE
        ? Math.round(fontSize * 2) / 2
        : DEFAULT_DIFF_FONT_SIZE,
  };
}
