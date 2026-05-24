// Telegram adapter.
//
// We use Telegraf for the bot runtime. The adapter is dependency-injected so
// tests can pass in a stub Telegraf-shaped object instead of paying for a
// real bot init.

import { Telegraf } from "telegraf";
import type { Context, Telegraf as TelegrafType } from "telegraf";

import { EgressGuard } from "./guard.js";
import { fetchManifest } from "./manifest.js";
import { BitteProxy } from "./proxy.js";
import { TraceCollector } from "./trace.js";
import type { AgentManifest, Logger, LauncherOptions } from "./types.js";
import { vetToolCalls } from "./vet.js";

export interface TelegramLaunchOptions extends LauncherOptions {
  // Test seam: inject a stub Telegraf-like constructor.
  telegrafCtor?: new (token: string) => TelegrafLike;
  logger?: Logger;
}

// Minimum surface area we use from Telegraf. Lets us stub in tests.
export interface TelegrafLike {
  start(handler: (ctx: TelegrafContextLike) => Promise<void> | void): void;
  help(handler: (ctx: TelegrafContextLike) => Promise<void> | void): void;
  on(event: "text", handler: (ctx: TelegrafContextLike) => Promise<void> | void): void;
  command(name: string, handler: (ctx: TelegrafContextLike) => Promise<void> | void): void;
  launch(): Promise<void>;
  stop(reason?: string): void;
}

export interface TelegrafContextLike {
  reply(text: string): Promise<unknown>;
  message?: { text?: string; from?: { id: number; username?: string } };
  from?: { id: number; username?: string };
}

export interface TelegramBotHandle {
  bot: TelegrafLike;
  manifest: AgentManifest;
  proxy: BitteProxy;
  guard: EgressGuard;
  trace: TraceCollector;
  // Per-user message history. Capped so we don't grow unbounded.
  history: Map<string, Array<{ role: "user" | "assistant"; content: string }>>;
  stop(reason?: string): void;
}

const HISTORY_LIMIT = 10;

export async function launchTelegram(opts: TelegramLaunchOptions): Promise<TelegramBotHandle> {
  const log: Logger = opts.logger ?? defaultLogger;
  const manifest = await fetchManifest(opts.manifestUrl, { fetchImpl: opts.fetchImpl });
  log("info", "manifest loaded", { name: manifest.name, tools: manifest.tools.length });

  const allowlist = [...(opts.allowlist ?? [])];
  const chatHost = new URL(manifest.chatUrl).host;
  if (!allowlist.includes(chatHost)) allowlist.push(chatHost);
  const guard = new EgressGuard({ allowlist, fetchImpl: opts.fetchImpl });

  const proxy = new BitteProxy({
    chatUrl: manifest.chatUrl,
    guard,
    manifestUrl: opts.manifestUrl,
  });
  const trace = new TraceCollector();
  const history = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

  const Ctor = opts.telegrafCtor ?? (Telegraf as unknown as new (token: string) => TelegrafLike);
  const bot = new Ctor(opts.token);

  bot.start(async (ctx) => {
    await ctx.reply(welcomeMessage(manifest));
  });
  bot.help(async (ctx) => {
    await ctx.reply(helpMessage(manifest));
  });
  bot.command("ping", async (ctx) => {
    await ctx.reply("pong");
  });

  bot.on("text", async (ctx) => {
    const userId = String(ctx.from?.id ?? ctx.message?.from?.id ?? "anon");
    const prompt = ctx.message?.text ?? "";
    if (!prompt.trim()) return;
    try {
      const hist = history.get(userId) ?? [];
      const t0 = Date.now();
      const { response } = await proxy.sendTurn({
        prompt,
        userId,
        history: hist,
      });
      trace.record({ prompt }, response, Date.now() - t0);

      // Vet any tool calls the agent emitted. If they fail, we surface the
      // agent-readable hints to the user so the operator can see what
      // happened. We do NOT execute the tool ourselves; that's the Bitte
      // agent's job. We only validate.
      if (response.tool_calls && response.tool_calls.length > 0) {
        const vet = vetToolCalls(response.tool_calls, manifest.tools);
        if (!vet.ok) {
          log("warn", "tool call vet failed", { errors: vet.errors });
          await ctx.reply(formatVetFailure(vet.errors));
          return;
        }
      }

      hist.push({ role: "user", content: prompt });
      hist.push({ role: "assistant", content: response.text });
      while (hist.length > HISTORY_LIMIT * 2) hist.shift();
      history.set(userId, hist);

      const text = response.text?.trim() ? response.text : "(no reply)";
      await ctx.reply(text);
    } catch (err) {
      log("error", "chat turn failed", { err: (err as Error).message });
      await ctx.reply(`error: ${(err as Error).message}`);
    }
  });

  // Only start the bot if we're not in dry-run mode (tests).
  if (!opts.dryRun) {
    await bot.launch();
    log("info", "telegram bot launched", { name: manifest.name });
  }

  return {
    bot,
    manifest,
    proxy,
    guard,
    trace,
    history,
    stop: (reason) => bot.stop(reason),
  };
}

// ---------- canned replies ----------

function welcomeMessage(manifest: AgentManifest): string {
  return [
    `Hi. I'm ${manifest.name} on Telegram.`,
    "",
    manifest.description,
    "",
    "Send me a message to get started, or use /help to see what I can do.",
  ].join("\n");
}

function helpMessage(manifest: AgentManifest): string {
  const lines = [
    `Agent: ${manifest.name}`,
    "",
    "Commands:",
    "  /start   intro",
    "  /help    this message",
    "  /ping    health check",
    "",
    "Tools the agent can call:",
  ];
  if (manifest.tools.length === 0) {
    lines.push("  (none declared)");
  } else {
    for (const t of manifest.tools.slice(0, 20)) {
      lines.push(`  - ${t.name}${t.description ? `: ${t.description}` : ""}`);
    }
    if (manifest.tools.length > 20) {
      lines.push(`  ...and ${manifest.tools.length - 20} more`);
    }
  }
  return lines.join("\n");
}

function formatVetFailure(errors: string[]): string {
  return ["The agent asked to use a tool with bad arguments. Hints:", ...errors.map((e) => `  - ${e}`)].join(
    "\n",
  );
}

function defaultLogger(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  const tail = meta ? ` ${JSON.stringify(meta)}` : "";

  console.log(`[${stamp}] ${level} ${msg}${tail}`);
}

// re-export the real Context type so callers that want it can have it.
export type { Context, TelegrafType };
