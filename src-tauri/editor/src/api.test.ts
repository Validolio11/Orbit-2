import { describe, expect, it } from "vitest";
import { errorMessage } from "./api";

describe("errorMessage", () => {
  it("keeps the plain strings Rust commands reject with", () => {
    expect(errorMessage("Файл налаштувань завеликий.")).toBe("Файл налаштувань завеликий.");
  });
  it("drops the English prefix String() adds to JS errors", () => {
    expect(errorMessage(new Error("offline"))).toBe("offline");
    expect(errorMessage(new TypeError("bad"))).toBe("bad");
  });
  it("reads { message } objects from other bridges", () => {
    expect(errorMessage({ message: "Немає доступу." })).toBe("Немає доступу.");
  });
  it("falls back to a readable sentence for empty or unknown failures", () => {
    for (const failure of [undefined, null, "", "   ", 42, {}, new Error("")]) expect(errorMessage(failure)).toBe("Невідома помилка.");
  });
});
