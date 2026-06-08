// Minimal Discord adapter.
//
// This is the lighter sibling of the Telegram adapter. It wires up the same
// proxy + guard + trace stack but uses a minimal Discord.js client shape.
// Treat it as a working scaffold; we expect the Telegram path to see most
// real-world traffic for the hackathon submission.

import { EgressGuard } from "./guard.js";
import { fetchManifest } from "./manifest.js";
import { BitteProxy } from "./proxy.js";
import { TraceCollector } from "./trace.js";
import type { AgentManifest, Logger, LauncherOptions } from "./types.js";
import { vetToolCalls } from "./vet.js";

// Minimum surface area we use from Discord.js so tests can stub it.
export interface DiscordClientLike {
  on(event: "messageCreate", handler: (msg: DiscordMessageLike) => Promise<void> | void): void;
  on(event: "ready", handler: () => void): void;
  login(token: string): Promise<unknown>;
  destroy(): Promise<unknown> | void;
}

export interface DiscordMessageLike {
  author: { id: string; bot: boolean; username?: string };
  content: string;
  reply(text: string): Promise<unknown>;
}

export interface DiscordLaunchOptions extends LauncherOptions {
  // Test seam: inject a Discord client.
  clientFactory?: () => DiscordClientLike;
  logger?: Logger;
}

export interface DiscordBotHandle {
  client: DiscordClientLike;
  manifest: AgentManifest;
  proxy: BitteProxy;
  guard: EgressGuard;
  trace: TraceCollector;
  stop(): Promise<void> | void;
}

export async function launchDiscord(opts: DiscordLaunchOptions): Promise<DiscordBotHandle> {
  const log: Logger = opts.logger ?? defaultLogger;
  const manifest = await fetchManifest(opts.manifestUrl, { fetchImpl: opts.fetchImpl });
  log("info", "manifest loaded", { name: manifest.name });

  const allowlist = [...(opts.allowlist ?? [])];
  const chatHost = new URL(manifest.chatUrl).host;
  if (!allowlist.includes(chatHost)) allowlist.push(chatHost);
  const guard = new EgressGuard({ allowlist, fetchImpl: opts.fetchImpl });

  const proxy = new BitteProxy({
    chatUrl: manifest.chatUrl,
    guard,
    manifestUrl: opts.manifestUrl,
    apiKey: opts.apiKey,
  });
  const trace = new TraceCollector();

  const client = (opts.clientFactory ?? buildDefaultClient)();

  client.on("ready", () => log("info", "discord ready"));
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const prompt = msg.content.trim();
    if (!prompt) return;
    try {
      const t0 = Date.now();
      const { response } = await proxy.sendTurn({
        prompt,
        userId: msg.author.id,
      });
      trace.record({ prompt }, response, Date.now() - t0);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const vet = vetToolCalls(response.tool_calls, manifest.tools);
        if (!vet.ok) {
          await msg.reply(["Tool call validation failed:", ...vet.errors.map((e) => `- ${e}`)].join("\n"));
          return;
        }
      }
      await msg.reply(response.text?.trim() ? response.text : "(no reply)");
    } catch (err) {
      log("error", "chat turn failed", { err: (err as Error).message });
      await msg.reply(`error: ${(err as Error).message}`);
    }
  });

  if (!opts.dryRun) {
    await client.login(opts.token);
    log("info", "discord bot launched", { name: manifest.name });
  }

  return {
    client,
    manifest,
    proxy,
    guard,
    trace,
    stop: async () => {
      await client.destroy();
    },
  };
}

function buildDefaultClient(): DiscordClientLike {
  // Lazy import so we don't fail if discord.js isn't installed in
  // telegram-only deployments.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dj = require("discord.js");
  const { Client, GatewayIntentBits } = dj;
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });
  return c as unknown as DiscordClientLike;
}

function defaultLogger(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  const tail = meta ? ` ${JSON.stringify(meta)}` : "";

  console.log(`[${stamp}] ${level} ${msg}${tail}`);
}
