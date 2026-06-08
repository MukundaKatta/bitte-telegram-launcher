import { describe, expect, it, vi } from "vitest";
import { launchTelegram } from "../src/telegram.js";
import type { TelegrafContextLike, TelegrafLike } from "../src/telegram.js";
import { FakeBitteAgent } from "./fakes/fake_bitte_agent.js";

/**
 * Stub Telegraf-shaped object. We capture the registered handlers so the
 * tests can drive them manually, without ever booting a real bot.
 */
class StubTelegraf implements TelegrafLike {
  public token: string;
  public startHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  public helpHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  public textHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  public commandHandlers = new Map<string, (ctx: TelegrafContextLike) => Promise<void> | void>();
  public launched = false;
  public stopped = false;
  public stopReason?: string;

  constructor(token: string) {
    this.token = token;
  }
  start(h: (ctx: TelegrafContextLike) => Promise<void> | void): void {
    this.startHandler = h;
  }
  help(h: (ctx: TelegrafContextLike) => Promise<void> | void): void {
    this.helpHandler = h;
  }
  on(event: "text", h: (ctx: TelegrafContextLike) => Promise<void> | void): void {
    if (event === "text") this.textHandler = h;
  }
  command(name: string, h: (ctx: TelegrafContextLike) => Promise<void> | void): void {
    this.commandHandlers.set(name, h);
  }
  async launch(): Promise<void> {
    this.launched = true;
  }
  stop(reason?: string): void {
    this.stopped = true;
    this.stopReason = reason;
  }
}

function makeCtx(text: string, userId = 7) {
  const replies: string[] = [];
  const ctx: TelegrafContextLike & { replies: string[] } = {
    replies,
    from: { id: userId, username: "tester" },
    message: { text, from: { id: userId, username: "tester" } },
    reply: vi.fn(async (t: string) => {
      replies.push(t);
      return undefined;
    }),
  };
  return ctx;
}

describe("launchTelegram", () => {
  it("loads the manifest, wires handlers, and (in dryRun) does not launch the bot", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "fake-token",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {
        /* silence */
      },
    });
    const bot = handle.bot as StubTelegraf;
    expect(bot.launched).toBe(false);
    expect(bot.startHandler).toBeDefined();
    expect(bot.helpHandler).toBeDefined();
    expect(bot.textHandler).toBeDefined();
    expect(bot.commandHandlers.has("ping")).toBe(true);
    expect(handle.manifest.name).toBe("Fake Bitte Agent");
    expect(handle.guard.allowed()).toContain(new URL(agent.chatUrl).host);
  });

  it("/start replies with a welcome containing the agent name", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    const ctx = makeCtx("");
    await bot.startHandler!(ctx);
    expect(ctx.replies[0]).toContain("Fake Bitte Agent");
  });

  it("/help lists declared tools", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    const ctx = makeCtx("");
    await bot.helpHandler!(ctx);
    expect(ctx.replies[0]).toContain("transfer");
    expect(ctx.replies[0]).toContain("lookup");
  });

  it("/ping replies pong", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    const ctx = makeCtx("");
    await bot.commandHandlers.get("ping")!(ctx);
    expect(ctx.replies[0]).toBe("pong");
  });

  it("plain text routes through the Bitte proxy and replies with the agent's text", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    const ctx = makeCtx("how is my account doing");
    await bot.textHandler!(ctx);
    expect(ctx.replies[0]).toBe("echo: how is my account doing");
    expect(handle.proxy.history()).toHaveLength(1);
    expect(handle.trace.all()).toHaveLength(1);
  });

  it("flags bad tool calls instead of forwarding them blindly", async () => {
    const agent = new FakeBitteAgent({
      cannedResponses: [
        {
          match: () => true,
          response: {
            text: "sending money",
            // intentionally missing `amount`
            tool_calls: [{ name: "transfer", arguments: { recipient: "alice.near" } }],
          },
        },
      ],
    });
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    const ctx = makeCtx("send 1 NEAR");
    await bot.textHandler!(ctx);
    expect(ctx.replies[0]).toContain("tool with bad arguments");
    expect(ctx.replies[0]).toContain("amount is required");
  });

  it("forwards the apiKey as a bearer token on the chat request", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      apiKey: "sk-bitte-secret",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    await bot.textHandler!(makeCtx("hello there"));
    const chatRequest = agent.requests.find((r) => r.url === agent.chatUrl && r.method === "POST");
    expect(chatRequest).toBeDefined();
    expect(chatRequest!.headers.authorization).toBe("Bearer sk-bitte-secret");
  });

  it("sends no authorization header when no apiKey is configured", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    const bot = handle.bot as StubTelegraf;
    await bot.textHandler!(makeCtx("hello there"));
    const chatRequest = agent.requests.find((r) => r.url === agent.chatUrl && r.method === "POST");
    expect(chatRequest).toBeDefined();
    expect(chatRequest!.headers.authorization).toBeUndefined();
  });

  it("stop() forwards the reason to telegraf", async () => {
    const agent = new FakeBitteAgent();
    const handle = await launchTelegram({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "x",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    });
    handle.stop("test-shutdown");
    const bot = handle.bot as StubTelegraf;
    expect(bot.stopped).toBe(true);
    expect(bot.stopReason).toBe("test-shutdown");
  });
});
