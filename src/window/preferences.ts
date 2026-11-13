export const DEFAULT_DIFF_FONT_SIZE = 16;
export const MIN_DIFF_FONT_SIZE = 10;
export const MAX_DIFF_FONT_SIZE = 24;

export interface WindowPreferences {
  diffFontSize: number;
}

/** Normalize saved preferences without accepting invalid or unreadable font sizes. */
export function normalizeWindowPreferences(value: unknown): WindowPreferences {
  const fontSize =
    typeof value === "object" && value !== null && "diffFontSize" in value
      ? value.diffFontSize
      : undefined;
  return {
    diffFontSize:
      typeof fontSize === "number" &&
      Number.isFinite(fontSize) &&
      fontSize >= MIN_DIFF_FONT_SIZE &&
      fontSize <= MAX_DIFF_FONT_SIZE
        ? Math.round(fontSize * 2) / 2
        : DEFAULT_DIFF_FONT_SIZE,
  };
}
