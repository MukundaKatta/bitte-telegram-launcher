import { describe, expect, it, vi } from "vitest";
import { BitteLauncher } from "../src/launcher.js";
import type { DiscordClientLike, DiscordMessageLike } from "../src/discord.js";
import type { TelegrafContextLike, TelegrafLike } from "../src/telegram.js";
import { FakeBitteAgent } from "./fakes/fake_bitte_agent.js";

class StubTelegraf implements TelegrafLike {
  startHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  helpHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  textHandler?: (ctx: TelegrafContextLike) => Promise<void> | void;
  commandHandlers = new Map<string, (ctx: TelegrafContextLike) => Promise<void> | void>();
  launched = false;
  stopped = false;
  constructor(_token: string) {}
  start(h: (ctx: TelegrafContextLike) => Promise<void> | void) {
    this.startHandler = h;
  }
  help(h: (ctx: TelegrafContextLike) => Promise<void> | void) {
    this.helpHandler = h;
  }
  on(_event: "text", h: (ctx: TelegrafContextLike) => Promise<void> | void) {
    this.textHandler = h;
  }
  command(name: string, h: (ctx: TelegrafContextLike) => Promise<void> | void) {
    this.commandHandlers.set(name, h);
  }
  async launch() {
    this.launched = true;
  }
  stop() {
    this.stopped = true;
  }
}

class StubDiscordClient implements DiscordClientLike {
  messageHandler?: (msg: DiscordMessageLike) => Promise<void> | void;
  readyHandler?: () => void;
  loggedIn = false;
  destroyed = false;
  on(event: "messageCreate" | "ready", handler: ((msg: DiscordMessageLike) => Promise<void> | void) | (() => void)): void {
    if (event === "messageCreate") {
      this.messageHandler = handler as (msg: DiscordMessageLike) => Promise<void> | void;
    } else {
      this.readyHandler = handler as () => void;
    }
  }
  async login(_token: string) {
    this.loggedIn = true;
  }
  destroy() {
    this.destroyed = true;
  }
}

describe("BitteLauncher.run", () => {
  it("routes platform=telegram to the telegram adapter", async () => {
    const agent = new FakeBitteAgent();
    const handle = await BitteLauncher.run({
      platform: "telegram",
      manifestUrl: agent.manifestUrl,
      token: "tg",
      fetchImpl: agent.asFetch(),
      telegrafCtor: StubTelegraf,
      dryRun: true,
      logger: () => {},
    } as Parameters<typeof BitteLauncher.run>[0]);
    expect(handle.manifest.name).toBe("Fake Bitte Agent");
  });

  it("routes platform=discord to the discord adapter, end-to-end", async () => {
    const agent = new FakeBitteAgent();
    const stub = new StubDiscordClient();
    const handle = await BitteLauncher.run({
      platform: "discord",
      manifestUrl: agent.manifestUrl,
      token: "dc",
      fetchImpl: agent.asFetch(),
      clientFactory: () => stub,
      dryRun: true,
      logger: () => {},
    } as Parameters<typeof BitteLauncher.run>[0]);
    expect(handle.manifest.name).toBe("Fake Bitte Agent");
    // simulate a non-bot incoming message
    const replies: string[] = [];
    const fakeMsg: DiscordMessageLike = {
      author: { id: "user-1", bot: false, username: "tester" },
      content: "hello",
      reply: vi.fn(async (t: string) => {
        replies.push(t);
        return undefined;
      }),
    };
    await stub.messageHandler!(fakeMsg);
    expect(replies[0]).toBe("echo: hello");
  });

  it("rejects unknown platforms", async () => {
    await expect(
      BitteLauncher.run({
        // @ts-expect-error intentionally bad
        platform: "myspace",
        manifestUrl: "https://x.example.com",
        token: "t",
      }),
    ).rejects.toThrow(/unsupported platform/);
  });

  it("discord adapter ignores other bots' messages", async () => {
    const agent = new FakeBitteAgent();
    const stub = new StubDiscordClient();
    await BitteLauncher.run({
      platform: "discord",
      manifestUrl: agent.manifestUrl,
      token: "dc",
      fetchImpl: agent.asFetch(),
      clientFactory: () => stub,
      dryRun: true,
      logger: () => {},
    } as Parameters<typeof BitteLauncher.run>[0]);
    const replyFn = vi.fn(async () => undefined);
    await stub.messageHandler!({
      author: { id: "bot-2", bot: true, username: "otherbot" },
      content: "hello",
      reply: replyFn,
    });
    expect(replyFn).not.toHaveBeenCalled();
  });
});
