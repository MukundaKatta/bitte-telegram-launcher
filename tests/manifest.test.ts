import { describe, expect, it } from "vitest";
import { fetchManifest, normalizeManifestUrl, parseManifest } from "../src/manifest.js";
import { FakeBitteAgent } from "./fakes/fake_bitte_agent.js";

describe("manifest", () => {
  it("normalizes a base URL into the .well-known path", () => {
    expect(normalizeManifestUrl("https://x.example.com")).toBe(
      "https://x.example.com/.well-known/ai-plugin.json",
    );
    expect(normalizeManifestUrl("https://x.example.com/")).toBe(
      "https://x.example.com/.well-known/ai-plugin.json",
    );
    expect(normalizeManifestUrl("https://x.example.com/.well-known/ai-plugin.json")).toBe(
      "https://x.example.com/.well-known/ai-plugin.json",
    );
  });

  it("fetches and parses a fake Bitte manifest", async () => {
    const agent = new FakeBitteAgent();
    const m = await fetchManifest(agent.manifestUrl, { fetchImpl: agent.asFetch() });
    expect(m.name).toBe("Fake Bitte Agent");
    expect(m.tools.length).toBe(2);
    expect(m.chatUrl).toBe(agent.chatUrl);
  });

  it("accepts the name_for_human / description_for_human fallback shape", () => {
    const m = parseManifest(
      {
        name_for_human: "Other Agent",
        description_for_human: "Hi",
        chat_url: "https://x.example.com/chat",
        tools: [],
      },
      "https://x.example.com/.well-known/ai-plugin.json",
    );
    expect(m.name).toBe("Other Agent");
    expect(m.description).toBe("Hi");
  });

  it("derives chat URL from manifest origin when missing", () => {
    const m = parseManifest(
      {
        name: "x",
        description: "y",
        tools: [],
      },
      "https://x.example.com/.well-known/ai-plugin.json",
    );
    expect(m.chatUrl).toBe("https://x.example.com/api/ai/chat");
  });

  it("throws on missing name", () => {
    expect(() =>
      parseManifest({ description: "y", tools: [] }, "https://x.example.com/.well-known/ai-plugin.json"),
    ).toThrow(/missing name/);
  });

  it("throws when the HTTP fetch fails", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("nope", { status: 500, statusText: "Internal Server Error" });
    await expect(fetchManifest("https://example.com", { fetchImpl: fakeFetch })).rejects.toThrow(
      /manifest fetch failed/,
    );
  });
});
