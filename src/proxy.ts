// Proxies a single chat turn from a Telegram/Discord adapter to the Bitte
// agent's chat endpoint.
//
// Pattern mirrors MukundaKatta/agenttap: every wire-level request + response
// is captured (after credential redaction) into an append-only TurnLog. That
// makes it trivial for the bot operator to debug "why did the agent say
// that?" without rebuilding the request from logs.

import type { EgressGuard } from "./guard.js";
import type { BitteChatResponse, TurnLogEntry } from "./types.js";

export interface ProxyOptions {
  chatUrl: string;
  guard: EgressGuard;
  // Optional API key (Bitte agents may require a bearer token for auth).
  apiKey?: string;
  manifestUrl: string;
}

export interface ChatTurnRequest {
  prompt: string;
  userId: string;
  // Bitte's chat shape accepts a messages array; we expose a single
  // convenience field but pass the full array on the wire.
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export class BitteProxy {
  private readonly opts: ProxyOptions;
  private readonly log: TurnLogEntry[] = [];

  constructor(opts: ProxyOptions) {
    this.opts = opts;
  }

  /** Send one chat turn to the agent and return its response. */
  async sendTurn(req: ChatTurnRequest): Promise<{ response: BitteChatResponse; entry: TurnLogEntry }> {
    const start = Date.now();
    const wire = buildWireRequest(req);
    const res = await this.opts.guard.fetch(this.opts.chatUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(wire),
    });
    if (!res.ok) {
      throw new Error(`bitte chat failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as unknown;
    const response = normalizeChatResponse(body);
    const entry: TurnLogEntry = {
      ts: start,
      durationMs: Date.now() - start,
      manifestUrl: this.opts.manifestUrl,
      // Redact authorization header before storing.
      request: redactRequest(wire),
      response,
    };
    this.log.push(entry);
    return { response, entry };
  }

  /** Snapshot of all turns this proxy has seen. */
  history(): TurnLogEntry[] {
    return [...this.log];
  }

  /** Clear the in-memory turn log. */
  clear(): void {
    this.log.length = 0;
  }
}

// ---------- helpers ----------

function buildWireRequest(req: ChatTurnRequest): Record<string, unknown> {
  const history = req.history ?? [];
  return {
    id: `tg-${req.userId}-${Date.now()}`,
    messages: [...history, { role: "user", content: req.prompt }],
    config: { mode: "telegram-launcher" },
  };
}

function redactRequest(req: Record<string, unknown>): Record<string, unknown> {
  // We never put auth in the body, but redact defensively in case a future
  // change starts to.
  const out = { ...req };
  for (const k of Object.keys(out)) {
    if (/auth|secret|token|api[-_]?key/i.test(k)) {
      out[k] = "[REDACTED]";
    }
  }
  return out;
}

/**
 * Bitte's chat response shape is in flux across deployments. We accept a few
 * common shapes and normalize them into BitteChatResponse.
 */
export function normalizeChatResponse(body: unknown): BitteChatResponse {
  if (typeof body !== "object" || body === null) {
    return { text: String(body ?? ""), raw: {} };
  }
  const b = body as Record<string, unknown>;
  // Common shape 1: { text, tool_calls }
  if (typeof b.text === "string") {
    return {
      text: b.text,
      tool_calls: Array.isArray(b.tool_calls) ? (b.tool_calls as BitteChatResponse["tool_calls"]) : undefined,
      usage: (b.usage as BitteChatResponse["usage"]) ?? undefined,
      raw: b,
    };
  }
  // Common shape 2: { messages: [{ role: "assistant", content }] }
  if (Array.isArray(b.messages)) {
    const last = (b.messages as Array<Record<string, unknown>>)
      .filter((m) => m.role === "assistant")
      .at(-1);
    if (last && typeof last.content === "string") {
      return {
        text: last.content,
        tool_calls: Array.isArray(last.tool_calls)
          ? (last.tool_calls as BitteChatResponse["tool_calls"])
          : undefined,
        usage: (b.usage as BitteChatResponse["usage"]) ?? undefined,
        raw: b,
      };
    }
  }
  // Common shape 3: OpenAI-style { choices: [{ message: { content } }] }
  if (Array.isArray(b.choices)) {
    const first = (b.choices as Array<Record<string, unknown>>)[0];
    const message = first?.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string") {
      return {
        text: message.content,
        tool_calls: Array.isArray(message.tool_calls)
          ? (message.tool_calls as BitteChatResponse["tool_calls"])
          : undefined,
        usage: (b.usage as BitteChatResponse["usage"]) ?? undefined,
        raw: b,
      };
    }
  }
  // Fallback: stringify and move on. Better an ugly reply than a crashed bot.
  return { text: JSON.stringify(body), raw: b };
}
