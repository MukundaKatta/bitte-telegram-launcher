# Deploying a launcher

This is the short operator guide. The launcher itself is a normal Node 20+ process; deploy it however you deploy any other long-lived Node service (PM2, systemd, Docker, fly.io, etc.).

## 1. Get a Telegram bot token

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`. Pick a name and a unique `@username`.
3. Copy the token BotFather gives you. It looks like `123456789:AAAA-replace-with-real-token`.
4. Optional: `/setdescription`, `/setabouttext`, `/setuserpic`, `/setcommands`.

Save the token as an environment variable:

```bash
export TELEGRAM_BOT_TOKEN=123456789:AAAA-replace-with-real-token
```

## 2. Identify your Bitte agent's manifest URL

A Bitte agent's manifest lives at `/.well-known/ai-plugin.json`. You can pass either:

- the full manifest URL: `https://my-agent.vercel.app/.well-known/ai-plugin.json`
- or just the base origin: `https://my-agent.vercel.app` (the launcher will append `/.well-known/ai-plugin.json` automatically).

If you don't have one yet, the official boilerplate at [BitteProtocol/agent-next-boilerplate](https://github.com/BitteProtocol/agent-next-boilerplate) is the fastest way to ship one.

## 3. Local dev with ngrok (optional)

Telegram bots in polling mode don't need a public URL; the launcher uses long-polling by default via Telegraf. So you can skip ngrok entirely for local dev:

```bash
npx tsx bin/bitte-launch.ts telegram \
  --manifest https://my-agent.vercel.app \
  --token $TELEGRAM_BOT_TOKEN
```

If you ever want webhook mode, expose your local launcher with ngrok:

```bash
ngrok http 3000
# then configure the webhook target on your bot (Telegraf supports both modes)
```

## 4. Production deploy

Two common shapes:

### a) systemd on a VM

```ini
# /etc/systemd/system/bitte-launcher.service
[Unit]
Description=Bitte Telegram Launcher
After=network-online.target

[Service]
Environment=TELEGRAM_BOT_TOKEN=...
WorkingDirectory=/opt/bitte-telegram-launcher
ExecStart=/usr/bin/node dist/bin/bitte-launch.js telegram \
  --manifest https://my-agent.vercel.app \
  --token ${TELEGRAM_BOT_TOKEN}
Restart=on-failure
User=launcher

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now bitte-launcher
sudo journalctl -fu bitte-launcher
```

### b) Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
CMD ["node", "dist/bin/bitte-launch.js", "telegram", "--manifest", "https://my-agent.vercel.app", "--token", "${TELEGRAM_BOT_TOKEN}"]
```

## 5. Egress allowlist

By default the launcher's egress guard is default-deny. The Bitte chat endpoint host is auto-allowed. If your agent calls out to other endpoints (e.g. an indexer) from inside its own server, you don't need to add them here. If you ever proxy other hosts from inside the launcher itself, add them to `--allowlist`:

```bash
bitte-launch telegram \
  --manifest https://my-agent.vercel.app \
  --token $TELEGRAM_BOT_TOKEN \
  --allowlist api.coingecko.com,rpc.mainnet.near.org
```

## 6. Discord

```bash
export DISCORD_BOT_TOKEN=...
bitte-launch discord --manifest https://my-agent.vercel.app --token $DISCORD_BOT_TOKEN
```

The Discord adapter is intentionally a minimal scaffold. The Telegram adapter is the recommended primary surface for this launcher.
