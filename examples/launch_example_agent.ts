// Example: launch a Telegram bot in front of a hypothetical Bitte agent.
//
// Run with:
//   BITTE_MANIFEST=https://your-agent.example.com \
//   TELEGRAM_BOT_TOKEN=123:abc \
//   npx tsx examples/launch_example_agent.ts

import { BitteLauncher } from "../src/launcher.js";

const manifestUrl = process.env.BITTE_MANIFEST ?? "https://your-agent.example.com";
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN to a token from @BotFather.");
  process.exit(1);
}

const handle = await BitteLauncher.run({
  platform: "telegram",
  manifestUrl,
  token,
  // Optional: extra hosts beyond the chat endpoint that the bot may reach.
  allowlist: [],
});

process.once("SIGINT", () => handle.stop("SIGINT"));
process.once("SIGTERM", () => handle.stop("SIGTERM"));

console.log(`launched ${handle.manifest.name} on Telegram`);
