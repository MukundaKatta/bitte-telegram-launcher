// Offline, credential-free demo of the Bitte launcher.
//
// This drives the REAL launcher stack (manifest fetch -> egress guard ->
// chat proxy -> tool-call vetting -> trace) with zero network access and no
// bot tokens. A small in-memory fake stands in for the Bitte agent and a
// stub Telegraf stands in for the Telegram runtime, so the exact same
// production code path runs that a live bot would.
//
// Run with:
//   npx tsx examples/offline_demo.ts
//
// What it shows:
//   1. A benign turn: proxied to the agent, traced, plain reply.
//   2. A valid tool call: vetted against the manifest schema, ALLOWED.
//   3. A malformed tool call: vetted, BLOCKED before it could ever execute,
//      with agent-readable hints surfaced back instead of a bad transfer.

import { BitteLauncher } from "../src/launcher.js";
import type { TelegrafContextLike, TelegrafLike } from "../src/telegram.js";
import type { AgentManifest, Logger } from "../src/types.js";

// ---------- in-memory fake Bitte agent (no network) ----------

interface Canned {
  match: (prompt: string) => boolean;
  response: Record<string, unknown>;
}

class OfflineAgent {
  readonly baseUrl = "https://demo-agent.local";
  private readonly canned: Canned[];

  constructor(canned: Canned[] = []) {
    this.canned = canned;
  }

  get manifestUrl(): string {
    return `${this.baseUrl}/.well-known/ai-plugin.json`;
  }

  get chatUrl(): string {
    return `${this.baseUrl}/api/ai/chat`;
  }

  private manifestBody(): Record<string, unknown> {
    return {
      name: "NEAR Wallet Concierge (demo)",
      description: "A demo agent that can transfer NEAR and look up balances.",
      chat_url: this.chatUrl,
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
            properties: { account: { type: "string" } },
          },
        },
      ],
    };
  }

  asFetch(): typeof fetch {
    const f: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === this.manifestUrl) {
        return json(this.manifestBody());
      }
      if (url === this.chatUrl && method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const prompt = extractPrompt(body);
        for (const c of this.canned) {
          if (c.match(prompt)) return json(c.response);
        }
        return json({
          text: `echo: ${prompt}`,
          usage: { prompt_tokens: prompt.length, completion_tokens: 8 },
        });
      }
      return json({ error: "not found" }, 404);
    };
    return f;
  }
}

function extractPrompt(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.messages)) {
    const last = (b.messages as Array<Record<string, unknown>>).at(-1);
    if (last && typeof last.content === "string") return last.content;
  }
  return "";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------- stub Telegram runtime (no token, no polling) ----------

class StubTelegraf implements TelegrafLike {
  textHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  constructor(_token: string) {}
  start(): void {}
  help(): void {}
  command(): void {}
  on(_event: "text", h: (ctx: TelegrafContextLike) => Promise<void> | void): void {
    this.textHandler = h;
  }
  async launch(): Promise<void> {}
  stop(): void {}
}

// ---------- demo driver ----------

async function runTurn(bot: StubTelegraf, userId: number, text: string): Promise<string[]> {
  const replies: string[] = [];
  await bot.textHandler?.({
    from: { id: userId },
    message: { text, from: { id: userId } },
    reply: async (t: string) => {
      replies.push(t);
      return undefined;
    },
  });
  return replies;
}

function banner(title: string): void {
  console.log(`\n${"=".repeat(64)}\n${title}\n${"=".repeat(64)}`);
}

function printTurn(label: string, prompt: string, replies: string[]): void {
  console.log(`\n--- ${label} ---`);
  console.log(`user >  ${prompt}`);
  for (const r of replies) {
    for (const line of r.split("\n")) console.log(`bot  >  ${line}`);
  }
}

async function main(): Promise<void> {
  const agent = new OfflineAgent([
    {
      // A legitimate transfer: well-formed arguments that match the manifest.
      match: (p) => /alice/i.test(p),
      response: {
        text: "On it. Preparing a transfer of 5 NEAR to alice.near.",
        tool_calls: [{ name: "transfer", arguments: { recipient: "alice.near", amount: 5 } }],
        usage: { prompt_tokens: 12, completion_tokens: 14, total_tokens: 26 },
      },
    },
    {
      // A malformed transfer: the agent hallucinated a string amount and
      // dropped the recipient. This is exactly what we want to catch.
      match: (p) => /bob/i.test(p),
      response: {
        text: "Sure, sending some NEAR to bob.",
        tool_calls: [{ name: "transfer", arguments: { amount: "five" } }],
        usage: { prompt_tokens: 10, completion_tokens: 9, total_tokens: 19 },
      },
    },
  ]);

  const logger: Logger = (level, msg, meta) => {
    const tail = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`[agent] ${level} ${msg}${tail}`);
  };

  banner("Launching (offline, dry-run, no token)");
  const handle = await BitteLauncher.run({
    platform: "telegram",
    manifestUrl: agent.manifestUrl,
    token: "demo-token",
    fetchImpl: agent.asFetch(),
    telegrafCtor: StubTelegraf,
    dryRun: true,
    logger,
  } as Parameters<typeof BitteLauncher.run>[0]);

  const manifest = handle.manifest as AgentManifest;
  console.log(`\nagent:       ${manifest.name}`);
  console.log(`chat url:    ${manifest.chatUrl}`);
  console.log(`tools:       ${manifest.tools.map((t) => t.name).join(", ")}`);
  console.log(`egress allow:${" "}${handle.guard.allowed().join(", ")}`);

  const bot = handle.bot as StubTelegraf;

  banner("Turn 1 - benign question (no tool call)");
  printTurn("benign", "what can you do?", await runTurn(bot, 1, "what can you do?"));

  banner("Turn 2 - valid tool call (vet ALLOWS)");
  printTurn(
    "valid transfer",
    "send 5 NEAR to alice.near",
    await runTurn(bot, 1, "send 5 NEAR to alice.near"),
  );

  banner("Turn 3 - malformed tool call (vet BLOCKS)");
  printTurn(
    "bad transfer",
    "send some NEAR to bob",
    await runTurn(bot, 1, "send some NEAR to bob"),
  );

  banner("Summary");
  console.log(`turns proxied:    ${handle.proxy.history().length}`);
  const s = handle.trace.summary();
  console.log(`traced turns:     ${s.count}`);
  console.log(`tool calls seen:  ${s.totalToolCalls}`);
  console.log(`approx tokens:    ${s.approxPromptTokens} in / ${s.approxCompletionTokens} out`);
  console.log(
    `\nNote: Turn 3's transfer never executed. The launcher validated the agent's` +
      `\ntool call against the manifest schema and blocked it before any action.`,
  );

  handle.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
