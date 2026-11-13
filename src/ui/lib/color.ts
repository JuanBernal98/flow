/** One parsed RGB triplet from a #rrggbb hex color. */
interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Parse a #rrggbb color into RGB components. Falls back to black for invalid input. */
function hexToRgb(hex: string): RgbColor {
  const normalized = /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace(/^#/, "") : "000000";
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Blend one foreground color toward a background color at a fixed ratio. */
export function blendHex(fg: string, bg: string, ratio: number) {
  const foreground = hexToRgb(fg);
  const background = hexToRgb(bg);
  const mix = (front: number, back: number) =>
    Math.max(0, Math.min(255, Math.round(back + (front - back) * ratio)));

  return `#${(
    (mix(foreground.r, background.r) << 16) |
    (mix(foreground.g, background.g) << 8) |
    mix(foreground.b, background.b)
  )
    .toString(16)
    .padStart(6, "0")}`;
}

/** Measure how visually separated two #rrggbb colors are using channel deltas. */
export function hexColorDistance(left: string, right: string) {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Choose the more readable foreground for a solid theme-colored action button. */
export function contrastingTextColor(background: string): string {
  const { r, g, b } = hexToRgb(background);
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const darkLuminance = linear(17);
  return (luminance + 0.05) / (darkLuminance + 0.05) >= 1.05 / (luminance + 0.05)
    ? "#111111"
    : "#ffffff";
}
