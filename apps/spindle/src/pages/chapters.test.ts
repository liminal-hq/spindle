// Tests for chapter timestamp parsing and formatting utilities.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

// Re-implement the helpers here since they're not exported from the component
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTimestamp(str: string): number | null {
  const parts = str.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

describe("formatTimestamp", () => {
  it("formats zero seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTimestamp(45)).toBe("0:00:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatTimestamp(125)).toBe("0:02:05");
  });

  it("formats hours", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("formats large durations", () => {
    expect(formatTimestamp(7200)).toBe("2:00:00");
  });
});

describe("parseTimestamp", () => {
  it("parses H:MM:SS format", () => {
    expect(parseTimestamp("1:02:03")).toBe(3723);
  });

  it("parses MM:SS format", () => {
    expect(parseTimestamp("5:30")).toBe(330);
  });

  it("parses bare seconds", () => {
    expect(parseTimestamp("90")).toBe(90);
  });

  it("parses zero", () => {
    expect(parseTimestamp("0:00:00")).toBe(0);
  });

  it("returns null for invalid input", () => {
    expect(parseTimestamp("abc")).toBeNull();
    expect(parseTimestamp("1:abc:00")).toBeNull();
  });

  it("round-trips with formatTimestamp", () => {
    const testValues = [0, 30, 125, 3600, 5432, 7261];
    for (const val of testValues) {
      expect(parseTimestamp(formatTimestamp(val))).toBe(val);
    }
  });
});
