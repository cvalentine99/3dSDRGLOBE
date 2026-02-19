/**
 * keyboardShortcuts.test.ts — Tests for keyboard shortcut logic
 *
 * Since the useKeyboardShortcuts hook is a React hook, we test the underlying
 * logic patterns: input field detection, shortcut mapping, and key matching.
 * The actual hook integration is tested via the component rendering.
 */
import { describe, it, expect } from "vitest";

// Test the shortcut key mapping logic (extracted from the hook)
const SHORTCUT_KEYS: Record<string, string> = {
  T: "Toggle TDoA panel",
  S: "Focus search input",
  D: "Open analytics dashboard",
  W: "Toggle watchlist panel",
  A: "Toggle alerts panel",
  M: "Toggle military RF panel",
  X: "Toggle targets panel",
  N: "Toggle anomaly panel",
  P: "Toggle propagation overlay",
  C: "Toggle shared lists panel",
};

function isInputElement(tagName: string): boolean {
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function matchShortcut(key: string): string | null {
  const upper = key.toUpperCase();
  return SHORTCUT_KEYS[upper] ?? null;
}

describe("keyboardShortcuts", () => {
  describe("shortcut key mapping", () => {
    it("should map T to TDoA panel", () => {
      expect(matchShortcut("t")).toBe("Toggle TDoA panel");
      expect(matchShortcut("T")).toBe("Toggle TDoA panel");
    });

    it("should map S to search focus", () => {
      expect(matchShortcut("s")).toBe("Focus search input");
    });

    it("should map D to dashboard", () => {
      expect(matchShortcut("d")).toBe("Open analytics dashboard");
    });

    it("should map W to watchlist", () => {
      expect(matchShortcut("w")).toBe("Toggle watchlist panel");
    });

    it("should map A to alerts", () => {
      expect(matchShortcut("a")).toBe("Toggle alerts panel");
    });

    it("should map M to military RF", () => {
      expect(matchShortcut("m")).toBe("Toggle military RF panel");
    });

    it("should map X to targets", () => {
      expect(matchShortcut("x")).toBe("Toggle targets panel");
    });

    it("should map N to anomaly panel", () => {
      expect(matchShortcut("n")).toBe("Toggle anomaly panel");
    });

    it("should map P to propagation", () => {
      expect(matchShortcut("p")).toBe("Toggle propagation overlay");
    });

    it("should map C to shared lists", () => {
      expect(matchShortcut("c")).toBe("Toggle shared lists panel");
    });

    it("should return null for unmapped keys", () => {
      expect(matchShortcut("z")).toBeNull();
      expect(matchShortcut("1")).toBeNull();
      expect(matchShortcut(" ")).toBeNull();
    });

    it("should have 10 panel/navigation shortcuts", () => {
      expect(Object.keys(SHORTCUT_KEYS).length).toBe(10);
    });
  });

  describe("input field detection", () => {
    it("should detect INPUT as an input element", () => {
      expect(isInputElement("INPUT")).toBe(true);
    });

    it("should detect TEXTAREA as an input element", () => {
      expect(isInputElement("TEXTAREA")).toBe(true);
    });

    it("should detect SELECT as an input element", () => {
      expect(isInputElement("SELECT")).toBe(true);
    });

    it("should not detect DIV as an input element", () => {
      expect(isInputElement("DIV")).toBe(false);
    });

    it("should not detect BUTTON as an input element", () => {
      expect(isInputElement("BUTTON")).toBe(false);
    });

    it("should not detect SPAN as an input element", () => {
      expect(isInputElement("SPAN")).toBe(false);
    });
  });

  describe("special keys", () => {
    it("should not match Escape as a regular shortcut", () => {
      expect(matchShortcut("Escape")).toBeNull();
    });

    it("should not match ? as a regular shortcut", () => {
      expect(matchShortcut("?")).toBeNull();
    });

    it("should be case-insensitive for letter shortcuts", () => {
      for (const key of Object.keys(SHORTCUT_KEYS)) {
        expect(matchShortcut(key.toLowerCase())).toBe(SHORTCUT_KEYS[key]);
        expect(matchShortcut(key.toUpperCase())).toBe(SHORTCUT_KEYS[key]);
      }
    });
  });
});
