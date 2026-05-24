// Deterministic Bitte agent test double.
//
// Returns a manifest and chat responses that match the shapes the launcher
// expects. Used by every test so we never need a real network connection.

import type { AgentManifest } from "../../src/types.js";

export interface FakeBitteAgentOptions {
  baseUrl?: string;
  // Override the manifest body returned for /.well-known/ai-plugin.json.
  manifestOverride?: Record<string, unknown>;
  // Optional canned responses: prompt substring -> response shape.
  cannedResponses?: Array<{
    match: (prompt: string) => boolean;
    response: Record<string, unknown>;
  }>;
}

export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export class FakeBitteAgent {
  private readonly baseUrl: string;
  private readonly manifestBody: Record<string, unknown>;
  private readonly cannedResponses: NonNullable<FakeBitteAgentOptions["cannedResponses"]>;
  public readonly requests: FakeRequest[] = [];

  constructor(opts: FakeBitteAgentOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "https://fake-bitte.example.com";
    this.manifestBody =
      opts.manifestOverride ?? defaultManifestBody(this.baseUrl);
    this.cannedResponses = opts.cannedResponses ?? [];
  }

  /** Manifest URL pointing at this fake agent. */
  get manifestUrl(): string {
    return `${this.baseUrl}/.well-known/ai-plugin.json`;
  }

  /** Chat URL pointing at this fake agent. */
  get chatUrl(): string {
    return `${this.baseUrl}/api/ai/chat`;
  }

  /** A fetch-compatible function the launcher can use. */
  asFetch(): typeof fetch {
    const self = this;
    const f: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const headers = normalizeHeaders(init?.headers);
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = init.body;
        }
      }
      self.requests.push({ url, method, headers, body });
      if (url === self.manifestUrl) {
        return jsonResponse(self.manifestBody, 200);
      }
      if (url === self.chatUrl && method === "POST") {
        return jsonResponse(self.buildChatResponse(body), 200);
      }
      return jsonResponse({ error: "not found" }, 404);
    };
    return f;
  }

  /** Construct an AgentManifest matching this fake agent's shape. */
  manifest(): AgentManifest {
    return {
      name: this.manifestBody.name as string,
      description: this.manifestBody.description as string,
      chatUrl: this.chatUrl,
      tools: (this.manifestBody.tools as AgentManifest["tools"]) ?? [],
      raw: this.manifestBody,
    };
  }

  private buildChatResponse(req: unknown): Record<string, unknown> {
    const prompt = extractPrompt(req);
    for (const c of this.cannedResponses) {
      if (c.match(prompt)) return c.response;
    }
    // Default echo response.
    return {
      text: `echo: ${prompt}`,
      usage: { prompt_tokens: prompt.length, completion_tokens: 8, total_tokens: prompt.length + 8 },
    };
  }
}

function extractPrompt(req: unknown): string {
  if (typeof req !== "object" || req === null) return "";
  const r = req as Record<string, unknown>;
  if (Array.isArray(r.messages)) {
    const last = (r.messages as Array<Record<string, unknown>>).at(-1);
    if (last && typeof last.content === "string") return last.content;
  }
  if (typeof r.prompt === "string") return r.prompt;
  return "";
}

function defaultManifestBody(baseUrl: string): Record<string, unknown> {
  return {
    name: "Fake Bitte Agent",
    description: "A deterministic test agent that echoes prompts.",
    chat_url: `${baseUrl}/api/ai/chat`,
    tools: [
      {
        name: "transfer",
        description: "Transfer NEAR to a recipient.",
        parameters: {
          type: "object",
          required: ["recipient", "amount"],
          properties: {
            recipient: { type: "string", description: "Receiving NEAR account id" },
            amount: { type: "number", description: "Amount in NEAR" },
            memo: { type: "string" },
          },
        },
      },
      {
        name: "lookup",
        description: "Look up an account's balance.",
        parameters: {
          type: "object",
          required: ["account"],
          properties: {
            account: { type: "string" },
          },
        },
      },
    ],
  };
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (Array.isArray(h)) {
    return Object.fromEntries(h.map(([k, v]) => [k.toLowerCase(), v]));
  }
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
    return out;
  }
  return Object.fromEntries(
    Object.entries(h as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
