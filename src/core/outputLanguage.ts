/**
 * The language Claude writes flow's output in (overviews, reviews, summaries). It is a per-user
 * choice saved as a code like `es`; skills get it as one line `flow skill show` puts on top, so the
 * skills themselves stay language-neutral.
 */

export const DEFAULT_LANGUAGE = "en";

/** The languages `flow setup` lists first, by their own names; any other code can be typed. */
export const LANGUAGE_CHOICES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
] as const;

const englishNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

/** The English name of a language code (`es` → Spanish), or undefined when it is not one. */
export function languageName(code: string) {
  if (!/^[a-z]{2,3}$/.test(code)) {
    return undefined;
  }
  try {
    return englishNames.of(code);
  } catch {
    return undefined;
  }
}

/** The line skills open with, naming the language to write in; unknown codes fall back to English. */
export function renderLanguageInstruction(code: string | undefined) {
  const resolved = code && languageName(code) ? code : DEFAULT_LANGUAGE;
  return `Idioma de salida: **${languageName(resolved)}** (\`${resolved}\`). Escribe en él tus respuestas, resúmenes, el Overview y las reviews.`;
}
