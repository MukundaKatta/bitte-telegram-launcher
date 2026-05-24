import { describe, expect, it } from "vitest";
import { EgressGuard } from "../src/guard.js";
import { BitteProxy, normalizeChatResponse } from "../src/proxy.js";
import { FakeBitteAgent } from "./fakes/fake_bitte_agent.js";

describe("BitteProxy", () => {
  it("sends a chat turn through the egress guard and records the entry", async () => {
    const agent = new FakeBitteAgent();
    const guard = new EgressGuard({
      allowlist: [new URL(agent.chatUrl).host],
      fetchImpl: agent.asFetch(),
    });
    const proxy = new BitteProxy({
      chatUrl: agent.chatUrl,
      guard,
      manifestUrl: agent.manifestUrl,
    });
    const { response, entry } = await proxy.sendTurn({ prompt: "hello world", userId: "u1" });
    expect(response.text).toBe("echo: hello world");
    expect(entry.manifestUrl).toBe(agent.manifestUrl);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(proxy.history()).toHaveLength(1);
  });

  it("redacts auth-shaped keys before storing the wire request", async () => {
    const agent = new FakeBitteAgent();
    const guard = new EgressGuard({
      allowlist: [new URL(agent.chatUrl).host],
      fetchImpl: agent.asFetch(),
    });
    const proxy = new BitteProxy({
      chatUrl: agent.chatUrl,
      guard,
      manifestUrl: agent.manifestUrl,
      apiKey: "sk-test-secret",
    });
    await proxy.sendTurn({ prompt: "hi", userId: "u" });
    const entry = proxy.history()[0];
    const req = entry.request as Record<string, unknown>;
    // The auth header was on the request init, not the body; redactRequest
    // would still mask any future auth-shaped fields we put on the body.
    expect(JSON.stringify(req)).not.toContain("sk-test-secret");
  });

  it("normalizes the {text, tool_calls} shape", () => {
    const r = normalizeChatResponse({ text: "hi", tool_calls: [{ name: "x", arguments: {} }] });
    expect(r.text).toBe("hi");
    expect(r.tool_calls).toHaveLength(1);
  });

  it("normalizes the {messages: [...]} shape", () => {
    const r = normalizeChatResponse({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    expect(r.text).toBe("a");
  });

  it("normalizes the OpenAI-style {choices: [...]} shape", () => {
    const r = normalizeChatResponse({
      choices: [{ message: { role: "assistant", content: "from openai shape" } }],
    });
    expect(r.text).toBe("from openai shape");
  });

  it("fails the turn when the agent endpoint returns a non-ok status", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("{}", { status: 502, statusText: "Bad Gateway" });
    const guard = new EgressGuard({ allowlist: ["x.example.com"], fetchImpl: fakeFetch });
    const proxy = new BitteProxy({
      chatUrl: "https://x.example.com/api/ai/chat",
      guard,
      manifestUrl: "https://x.example.com/.well-known/ai-plugin.json",
    });
    await expect(proxy.sendTurn({ prompt: "x", userId: "u" })).rejects.toThrow(/502/);
  });

  it("clear() wipes the in-memory history", async () => {
    const agent = new FakeBitteAgent();
    const guard = new EgressGuard({
      allowlist: [new URL(agent.chatUrl).host],
      fetchImpl: agent.asFetch(),
    });
    const proxy = new BitteProxy({
      chatUrl: agent.chatUrl,
      guard,
      manifestUrl: agent.manifestUrl,
    });
    await proxy.sendTurn({ prompt: "a", userId: "u" });
    proxy.clear();
    expect(proxy.history()).toEqual([]);
  });
});
