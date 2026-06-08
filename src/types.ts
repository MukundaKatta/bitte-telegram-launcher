// Shared types for the launcher.
//
// These are intentionally narrow. The Bitte chat surface is evolving, so we
// only encode the fields we actually consume. Anything else from the agent
// response is passed through opaquely on `raw`.

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  parameters: ToolParameter;
}

export interface AgentManifest {
  // From /.well-known/ai-plugin.json
  name: string;
  description: string;
  // Chat endpoint URL (Bitte agents expose a chat path; we honor what the
  // manifest says, falling back to the default if missing).
  chatUrl: string;
  // Tools advertised by the agent. Used by vet.ts to validate tool calls
  // before the bot ever forwards the result.
  tools: ToolSchema[];
  // The unparsed JSON body so callers can do their own thing if they want.
  raw: Record<string, unknown>;
}

export interface BitteToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface BitteChatResponse {
  text: string;
  tool_calls?: BitteToolCall[];
  // Bitte may surface usage / model fields. We don't require them.
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  raw?: Record<string, unknown>;
}

export interface TurnLogEntry {
  ts: number;
  durationMs: number;
  manifestUrl: string;
  request: unknown;
  response: BitteChatResponse;
}

export interface LauncherOptions {
  platform: "telegram" | "discord";
  manifestUrl: string;
  token: string;
  // Egress allowlist hostnames. The chat endpoint host is auto-added.
  allowlist?: string[];
  // Optional bearer token for Bitte agents that require authentication on
  // their chat endpoint. When set, it is sent as `Authorization: Bearer ...`
  // on every chat turn. It is never written to the turn log.
  apiKey?: string;
  // Test seam. If provided, we skip real network calls and route through
  // this fetch implementation.
  fetchImpl?: typeof fetch;
  // Test seam for the telegram launcher. When true, we don't call bot.launch()
  // and just return the configured bot for tests.
  dryRun?: boolean;
}

export interface VetResult {
  ok: boolean;
  // Mirrors agentvet's contract: a single agent-readable retry hint per
  // failed call, NOT a wall of stack trace.
  errors: string[];
}

export type Logger = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
