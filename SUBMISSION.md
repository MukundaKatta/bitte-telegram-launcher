# BUIDL Submission: bitte-telegram-launcher

**Hackathon:** [NEAR Agents Without Masters](https://dorahacks.io/hackathon/agents-without-masters/prizes)
**Bounty:** Bitte sub-bounty 4 (Reusable launcher to turn any Bitte agent into a Telegram or Discord bot)
**Repo:** https://github.com/MukundaKatta/bitte-telegram-launcher
**License:** MIT
**Built by:** MukundaKatta

## Problem

A Bitte agent ships as a manifest at `/.well-known/ai-plugin.json` plus a chat endpoint. To get it into a chat surface that users actually use, today every agent author has to write their own Telegram or Discord glue: bot registration, message routing, history, error replies, tool-call handling, and operational safety (rate limits, egress leaks, bad tool calls). That's repeated work, repeated bugs.

## Approach

`bitte-telegram-launcher` is a reusable TypeScript package that takes a Bitte agent manifest URL and a bot token and turns it into a working Telegram bot in one call:

```ts
await BitteLauncher.run({
  platform: "telegram",
  manifestUrl: "https://your-bitte-agent.example.com",
  token: process.env.TELEGRAM_BOT_TOKEN!,
});
```

A minimal Discord adapter shares the same plumbing (proxy + guard + vet + trace). Both surface the agent's tool list automatically via `/help`, route plain text through the Bitte chat endpoint, vet any tool calls the agent emits, and capture per-message latency + token counts.

## How it addresses Bitte sub-bounty 4

The bounty asks for a "reusable launcher to turn any Bitte agent into a Telegram or Discord bot." This repo delivers:

1. **Reusable.** Single npm package, one CLI command, one programmatic call. Drop in any Bitte manifest URL.
2. **Any Bitte agent.** Manifest parser accepts the standard `/.well-known/ai-plugin.json` shape plus the common name-for-human / chat_url / api.url variants seen in real Bitte agents in the wild.
3. **Telegram, fully working.** Telegraf-based adapter with `/start`, `/help`, `/ping`, plain-text routing, per-user history (capped), bad-tool-call replies, graceful error replies, and signal-based shutdown.
4. **Discord, minimal scaffold.** discord.js-based adapter that shares the same proxy / guard / vet / trace stack.
5. **Operational safety baked in, not bolted on:**
   - Egress allowlist (default-deny). The chat host is auto-added; the bot cannot accidentally leak to other hosts.
   - Tool-arg validation against the manifest's parameter schema. Bad tool calls surface as agent-readable hints to the user rather than silent corruption.
   - Append-only turn log with credential redaction for debugging.
   - Per-message latency + token rollup.
6. **Testable.** A `FakeBitteAgent` test double drives 30+ deterministic tests; no real network, no real bot account needed in CI.

## Why this approach

I've shipped 30+ small agent-stack libraries on npm and crates.io that each isolate one of these concerns:

- [agenttap](https://github.com/MukundaKatta/agenttap) — wire-level prompt introspection
- [agentvet](https://github.com/MukundaKatta/agentvet) — tool-arg validation
- [agentguard](https://github.com/MukundaKatta/agentguard) — egress allowlist
- [agentsnap](https://github.com/MukundaKatta/agentsnap) — snapshot tests for agent runs
- [agenttrace](https://github.com/MukundaKatta/agenttrace) — cost + latency tracking
- [llm-retry](https://github.com/MukundaKatta/llm-retry), [llm-circuit-breaker](https://github.com/MukundaKatta/llm-circuit-breaker) — resilience primitives

This launcher composes those patterns into one Bitte-specific binary, so the bounty's "reusable launcher" lands with battle-tested behavior instead of best-effort first-pass code.

## What's NOT in scope

- Hosting / deployment infrastructure. The launcher is a Node 20+ process; deploy it however you deploy other Node processes (PM2, systemd, Docker, fly.io). `DEPLOY.md` covers the local dev flow with ngrok.
- Account abstraction or on-chain signing. The Bitte agent itself owns transaction construction; the launcher only validates tool args and forwards messages.
- Per-deployment metering / billing. The trace module emits the raw data; an operator can ship it to whatever metering pipeline they prefer.

## File-by-file

- `src/manifest.ts` — fetch + parse `/.well-known/ai-plugin.json`. Accepts base origin or full URL.
- `src/proxy.ts` — single-turn chat proxy with append-only TurnLog and credential redaction.
- `src/vet.ts` — tool-arg validation with agent-readable retry hints (mirrors agentvet's API).
- `src/guard.ts` — egress allowlist, default-deny, typed `EgressBlockedError`.
- `src/trace.ts` — per-turn latency + token rollup with p50 / p95.
- `src/telegram.ts` — Telegraf adapter, fully featured.
- `src/discord.ts` — discord.js adapter, minimal scaffold.
- `src/launcher.ts` — top-level `BitteLauncher` composing all of the above.
- `bin/bitte-launch.ts` — Commander-based CLI.
- `tests/` — 30+ deterministic tests against a `FakeBitteAgent`.

## How to verify in 60 seconds

```bash
git clone https://github.com/MukundaKatta/bitte-telegram-launcher
cd bitte-telegram-launcher
npm install
npm test
```

All tests pass on Node 20+ with no network access required.
