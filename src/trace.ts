// Per-message latency + (approximate) cost rollup.
//
// Pattern mirrors MukundaKatta/agenttrace: group LLM calls into a run, then
// surface p50/p95 latency + per-model cost. We don't have authoritative token
// pricing for Bitte (it varies per agent + provider), so we report token
// counts when the response carries them and fall back to char-based estimates.

import type { BitteChatResponse } from "./types.js";

export interface TraceRecord {
  ts: number;
  durationMs: number;
  promptChars: number;
  responseChars: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  toolCallCount: number;
}

export interface TraceSummary {
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  totalPromptChars: number;
  totalResponseChars: number;
  totalToolCalls: number;
  approxPromptTokens: number;
  approxCompletionTokens: number;
}

export class TraceCollector {
  private readonly records: TraceRecord[] = [];

  record(req: { prompt: string }, res: BitteChatResponse, durationMs: number): TraceRecord {
    const rec: TraceRecord = {
      ts: Date.now(),
      durationMs,
      promptChars: req.prompt.length,
      responseChars: (res.text ?? "").length,
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
      totalTokens: res.usage?.total_tokens,
      toolCallCount: (res.tool_calls ?? []).length,
    };
    this.records.push(rec);
    return rec;
  }

  all(): TraceRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }

  summary(): TraceSummary {
    const n = this.records.length;
    if (n === 0) {
      return {
        count: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        totalPromptChars: 0,
        totalResponseChars: 0,
        totalToolCalls: 0,
        approxPromptTokens: 0,
        approxCompletionTokens: 0,
      };
    }
    const durations = this.records.map((r) => r.durationMs).sort((a, b) => a - b);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const totalPromptChars = this.records.reduce((a, r) => a + r.promptChars, 0);
    const totalResponseChars = this.records.reduce((a, r) => a + r.responseChars, 0);
    const totalToolCalls = this.records.reduce((a, r) => a + r.toolCallCount, 0);
    // chars/4 is the standard rough OpenAI-style token approximation. We use
    // it only when the agent didn't surface real token counts.
    const approxPromptTokens = this.records.reduce(
      (a, r) => a + (r.promptTokens ?? Math.ceil(r.promptChars / 4)),
      0,
    );
    const approxCompletionTokens = this.records.reduce(
      (a, r) => a + (r.completionTokens ?? Math.ceil(r.responseChars / 4)),
      0,
    );
    return {
      count: n,
      totalDurationMs: totalDuration,
      avgDurationMs: Math.round(totalDuration / n),
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      totalPromptChars,
      totalResponseChars,
      totalToolCalls,
      approxPromptTokens,
      approxCompletionTokens,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
