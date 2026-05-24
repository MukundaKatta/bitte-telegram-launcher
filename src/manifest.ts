import { z } from "zod";
import type { AgentManifest, ToolParameter, ToolSchema } from "./types.js";

// Bitte's manifest shape is loosely OpenAPI-shaped. We accept several common
// variants because Bitte agents in the wild are not perfectly uniform.

const ParameterSchema: z.ZodType<ToolParameter> = z.lazy(() =>
  z.object({
    type: z.string(),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    items: ParameterSchema.optional(),
    properties: z.record(ParameterSchema).optional(),
    required: z.array(z.string()).optional(),
  }),
);

const ToolSchemaSchema: z.ZodType<ToolSchema> = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: ParameterSchema,
});

const ManifestBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    name_for_human: z.string().min(1).optional(),
    name_for_model: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    description_for_human: z.string().min(1).optional(),
    description_for_model: z.string().min(1).optional(),
    // Chat URL discovery: many Bitte agents put the chat endpoint inside an
    // api{} block; some publish a top-level chat_url. We accept both.
    chat_url: z.string().optional(),
    api: z
      .object({
        url: z.string().optional(),
        type: z.string().optional(),
      })
      .optional(),
    tools: z.array(ToolSchemaSchema).optional(),
    // Sometimes tool definitions live under a function-calling-shaped key.
    functions: z.array(ToolSchemaSchema).optional(),
  })
  .passthrough();

export interface FetchManifestOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a Bitte agent manifest from a URL.
 *
 * Accepts either the manifest URL directly or the agent base URL (in which case
 * we append `/.well-known/ai-plugin.json`).
 */
export async function fetchManifest(
  url: string,
  opts: FetchManifestOptions = {},
): Promise<AgentManifest> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const manifestUrl = normalizeManifestUrl(url);
  const res = await fetchImpl(manifestUrl, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`manifest fetch failed: ${res.status} ${res.statusText} ${manifestUrl}`);
  }
  const body = (await res.json()) as unknown;
  return parseManifest(body, manifestUrl);
}

/**
 * Parse a manifest body that has already been fetched.
 *
 * Exposed for tests + callers that have a manifest from somewhere else.
 */
export function parseManifest(body: unknown, source: string): AgentManifest {
  const parsed = ManifestBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`manifest invalid: ${parsed.error.message}`);
  }
  const m = parsed.data;
  const name = m.name ?? m.name_for_human ?? m.name_for_model;
  const description = m.description ?? m.description_for_human ?? m.description_for_model;
  if (!name) throw new Error("manifest missing name");
  if (!description) throw new Error("manifest missing description");
  const chatUrl = m.chat_url ?? m.api?.url ?? deriveChatUrlFromManifest(source);
  if (!chatUrl) throw new Error("manifest missing chat_url");
  const tools = m.tools ?? m.functions ?? [];
  return {
    name,
    description,
    chatUrl,
    tools,
    raw: body as Record<string, unknown>,
  };
}

/**
 * Some users will pass us `https://agent.example.com/` instead of the full
 * `.well-known` path. Normalize either form.
 */
export function normalizeManifestUrl(url: string): string {
  if (url.endsWith("/ai-plugin.json") || url.includes("/.well-known/")) {
    return url;
  }
  const trimmed = url.replace(/\/$/, "");
  return `${trimmed}/.well-known/ai-plugin.json`;
}

function deriveChatUrlFromManifest(manifestUrl: string): string | undefined {
  // Default Bitte convention is `/api/ai/chat` relative to the manifest origin.
  try {
    const u = new URL(manifestUrl);
    return `${u.origin}/api/ai/chat`;
  } catch {
    return undefined;
  }
}
