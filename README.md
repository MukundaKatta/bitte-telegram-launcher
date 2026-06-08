# bitte-telegram-launcher

[![CI](https://github.com/MukundaKatta/bitte-telegram-launcher/actions/workflows/ci.yml/badge.svg)](https://github.com/MukundaKatta/bitte-telegram-launcher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-43853d.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178c6.svg)](https://www.typescriptlang.org/)
[![Hackathon: NEAR Agents Without Masters](https://img.shields.io/badge/Hackathon-NEAR%20Agents%20Without%20Masters-00ec97.svg)](https://dorahacks.io/hackathon/agents-without-masters/prizes)

Reusable launcher that turns any [Bitte](https://docs.bitte.ai/agents/manifest) agent into a working Telegram bot. Point it at the agent's manifest URL and a Telegram bot token, and you have a chat surface.

Submitted to the NEAR "Agents Without Masters" hackathon, Bitte sub-bounty 4.

## Supported platforms

| Platform | Status         | Adapter file        |
|----------|----------------|---------------------|
| Telegram | full           | `src/telegram.ts`   |
| Discord  | minimal stub   | `src/discord.ts`    |

Both adapters share the same proxy, egress allowlist, tool-arg vet, and trace plumbing.

## 60-second quickstart

```bash
git clone https://github.com/MukundaKatta/bitte-telegram-launcher
cd bitte-telegram-launcher
npm install
npm test

# Run a real bot:
export BITTE_MANIFEST=https://your-bitte-agent.example.com
export TELEGRAM_BOT_TOKEN=123456:AAAA-replace-with-real-token
npx tsx bin/bitte-launch.ts telegram \
  --manifest $BITTE_MANIFEST \
  --token $TELEGRAM_BOT_TOKEN
```

### See it work with no credentials

No bot token and no network needed. This runs the full launcher stack
(manifest -> egress guard -> chat proxy -> tool-arg vet -> trace) against an
in-memory fake agent:

```bash
npx tsx examples/offline_demo.ts
```

It walks three turns: a benign reply, a valid `transfer` that vetting allows,
and a malformed `transfer` (string amount, missing recipient) that vetting
blocks before it could ever execute.

Or use it from code:

```ts
import { BitteLauncher } from "bitte-telegram-launcher";

const handle = await BitteLauncher.run({
  platform: "telegram",
  manifestUrl: "https://your-bitte-agent.example.com",
  token: process.env.TELEGRAM_BOT_TOKEN!,
  allowlist: [], // chat host is auto-added; add more hosts only if needed
});

console.log("bot up:", handle.manifest.name);
```

## How a single message flows

```
Telegram user
     |
     v
+-------------+      +----------+      +----------------+
| telegram.ts | ---> | proxy.ts | ---> | Bitte chat URL |
+-------------+      +----------+      +----------------+
     |                  ^   |
     |                  |   v
     |             +---------+        +----------+
     |             | guard.ts|------->| egress   |
     |             +---------+        | denylist |
     |                                +----------+
     |                  |
     |                  v
     |             +--------+
     |             | vet.ts | validates tool calls
     |             +--------+
     |                  |
     v                  v
  reply text       trace.ts records latency + tokens
```

## What it composes from the agent-stack

This launcher is intentionally a thin orchestrator of patterns that ship as independent npm and crates.io libraries under [@mukundakatta](https://github.com/MukundaKatta):

- `proxy.ts` mirrors **agenttap** (wire-level capture of every request/response).
- `vet.ts` mirrors **agentvet** (tool-arg validation with agent-readable retry hints).
- `guard.ts` mirrors **agentguard** (egress allowlist, default-deny).
- `trace.ts` mirrors **agenttrace** (per-message latency + approx token rollup).

## Layout

```
bitte-telegram-launcher/
  src/
    manifest.ts     // fetch + parse Bitte ai-plugin.json
    proxy.ts        // chat-turn proxy with append-only TurnLog
    vet.ts          // tool-arg validation
    guard.ts        // egress allowlist
    trace.ts        // latency + cost rollup
    telegram.ts     // Telegraf-based adapter
    discord.ts      // discord.js-based adapter (minimal)
    launcher.ts     // top-level BitteLauncher
    types.ts        // shared types
    index.ts        // public entry
  bin/
    bitte-launch.ts // Commander-based CLI
  tests/
    fakes/fake_bitte_agent.ts
    *.test.ts
  examples/
    launch_example_agent.ts  // real bot (needs token)
    offline_demo.ts          // credential-free, runs the full stack
```

## CLI

```
bitte-launch telegram --manifest <url> --token <token> [--allowlist host1,host2] [--api-key <key>]
bitte-launch discord  --manifest <url> --token <token> [--allowlist host1,host2] [--api-key <key>]
```

| Option        | Required | Description                                                                 |
|---------------|----------|-----------------------------------------------------------------------------|
| `--manifest`  | yes      | Bitte agent manifest URL (`.well-known/ai-plugin.json` or the base origin). |
| `--token`     | yes      | Bot token (Telegram from @BotFather, or a Discord bot token).               |
| `--allowlist` | no       | Comma-separated egress hosts. The chat host is auto-added.                   |
| `--api-key`   | no       | Bearer token for agents whose chat endpoint requires auth. Falls back to the `BITTE_API_KEY` environment variable. Sent as `Authorization: Bearer <key>` and never written to the turn log. |

## Programmatic API

```ts
import { BitteLauncher } from "bitte-telegram-launcher";

const handle = await BitteLauncher.run({
  platform: "telegram",
  manifestUrl: "https://your-bitte-agent.example.com",
  token: process.env.TELEGRAM_BOT_TOKEN!,
  apiKey: process.env.BITTE_API_KEY, // optional; only if the agent requires auth
  allowlist: [],                     // chat host is auto-added
});
```

`BitteLauncher.run` returns a handle exposing the live `manifest`, `proxy`
(append-only turn log via `proxy.history()`), `guard` (egress allowlist), and
`trace` (latency + token rollup via `trace.summary()`), plus `stop()` for clean
shutdown. The same fields are returned on both the Telegram and Discord paths,
so you can inspect or test the full stack without a live bot.

## Tests

```bash
npm test
```

40+ deterministic tests using a `FakeBitteAgent` test double; no real network, no real Telegram, no real Discord. The same suite runs in CI (`.github/workflows/ci.yml`) on Node 20 and 22, alongside a `tsc` build and a smoke run of the offline demo.

## License

MIT. See [LICENSE](LICENSE).
