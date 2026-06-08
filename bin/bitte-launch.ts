#!/usr/bin/env node
// CLI entry point for the launcher.

import { Command } from "commander";
import { BitteLauncher } from "../src/launcher.js";

const program = new Command();
program
  .name("bitte-launch")
  .description("Turn any Bitte agent into a Telegram or Discord bot")
  .version("0.1.0");

program
  .command("telegram")
  .description("Launch a Telegram bot in front of a Bitte agent")
  .requiredOption("--manifest <url>", "Bitte agent manifest URL (.well-known/ai-plugin.json or base origin)")
  .requiredOption("--token <token>", "Telegram bot token from @BotFather (or set TELEGRAM_BOT_TOKEN)")
  .option("--allowlist <hosts>", "comma-separated egress allowlist (chat host is auto-added)", "")
  .option("--api-key <key>", "bearer token for the Bitte agent chat endpoint (or set BITTE_API_KEY)")
  .action(async (cmdOpts: { manifest: string; token: string; allowlist: string; apiKey?: string }) => {
    const handle = await BitteLauncher.run({
      platform: "telegram",
      manifestUrl: cmdOpts.manifest,
      token: cmdOpts.token,
      allowlist: parseAllowlist(cmdOpts.allowlist),
      apiKey: cmdOpts.apiKey ?? process.env.BITTE_API_KEY,
    });
    process.once("SIGINT", () => handle.stop("SIGINT"));
    process.once("SIGTERM", () => handle.stop("SIGTERM"));
  });

program
  .command("discord")
  .description("Launch a Discord bot in front of a Bitte agent (minimal scaffold)")
  .requiredOption("--manifest <url>", "Bitte agent manifest URL")
  .requiredOption("--token <token>", "Discord bot token (or set DISCORD_BOT_TOKEN)")
  .option("--allowlist <hosts>", "comma-separated egress allowlist (chat host is auto-added)", "")
  .option("--api-key <key>", "bearer token for the Bitte agent chat endpoint (or set BITTE_API_KEY)")
  .action(async (cmdOpts: { manifest: string; token: string; allowlist: string; apiKey?: string }) => {
    const handle = await BitteLauncher.run({
      platform: "discord",
      manifestUrl: cmdOpts.manifest,
      token: cmdOpts.token,
      allowlist: parseAllowlist(cmdOpts.allowlist),
      apiKey: cmdOpts.apiKey ?? process.env.BITTE_API_KEY,
    });
    process.once("SIGINT", () => handle.stop());
    process.once("SIGTERM", () => handle.stop());
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`bitte-launch failed: ${(err as Error).message}`);
  process.exit(1);
});

function parseAllowlist(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
