import { describe, expect, test } from "bun:test";
import { languageName, renderLanguageInstruction } from "./outputLanguage";

describe("output language", () => {
  test("names language codes and rejects anything else", () => {
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("de")).toBe("German");
    expect(languageName("xx")).toBeUndefined();
    expect(languageName("español")).toBeUndefined();
  });

  test("tells skills the language, falling back to English", () => {
    expect(renderLanguageInstruction("es")).toContain("**Spanish** (`es`)");
    expect(renderLanguageInstruction(undefined)).toContain("**English** (`en`)");
    expect(renderLanguageInstruction("xx")).toContain("**English** (`en`)");
  });
});
