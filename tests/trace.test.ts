import { describe, expect, it } from "vitest";
import { TraceCollector } from "../src/trace.js";

describe("TraceCollector", () => {
  it("returns a zero summary for an empty collector", () => {
    const t = new TraceCollector();
    const s = t.summary();
    expect(s.count).toBe(0);
    expect(s.avgDurationMs).toBe(0);
    expect(s.totalToolCalls).toBe(0);
  });

  it("records per-turn data and computes basic stats", () => {
    const t = new TraceCollector();
    t.record({ prompt: "hi" }, { text: "hello back" }, 100);
    t.record({ prompt: "again" }, { text: "second reply" }, 200);
    const s = t.summary();
    expect(s.count).toBe(2);
    expect(s.totalDurationMs).toBe(300);
    expect(s.avgDurationMs).toBe(150);
  });

  it("computes p50 and p95 deterministically", () => {
    const t = new TraceCollector();
    for (const d of [50, 60, 70, 80, 90, 100, 200, 500]) {
      t.record({ prompt: "x" }, { text: "y" }, d);
    }
    const s = t.summary();
    expect(s.p50DurationMs).toBeGreaterThanOrEqual(70);
    expect(s.p95DurationMs).toBeGreaterThanOrEqual(200);
  });

  it("falls back to char/4 token estimate when usage not present", () => {
    const t = new TraceCollector();
    t.record({ prompt: "abcdefgh" }, { text: "xxxx" }, 10); // 8/4 prompt + 4/4 completion
    const s = t.summary();
    expect(s.approxPromptTokens).toBe(2);
    expect(s.approxCompletionTokens).toBe(1);
  });

  it("uses real usage tokens when provided", () => {
    const t = new TraceCollector();
    t.record(
      { prompt: "abcdefgh" },
      { text: "xxxx", usage: { prompt_tokens: 42, completion_tokens: 9 } },
      10,
    );
    const s = t.summary();
    expect(s.approxPromptTokens).toBe(42);
    expect(s.approxCompletionTokens).toBe(9);
  });

  it("counts tool calls across turns", () => {
    const t = new TraceCollector();
    t.record({ prompt: "x" }, { text: "y", tool_calls: [{ name: "a", arguments: {} }] }, 10);
    t.record({ prompt: "x" }, { text: "y", tool_calls: [
      { name: "a", arguments: {} }, { name: "b", arguments: {} },
    ] }, 10);
    expect(t.summary().totalToolCalls).toBe(3);
  });

  it("clear() resets the records", () => {
    const t = new TraceCollector();
    t.record({ prompt: "x" }, { text: "y" }, 10);
    t.clear();
    expect(t.all()).toEqual([]);
  });
});
