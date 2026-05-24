import { describe, expect, it, vi } from "vitest";
import { EgressBlockedError, EgressGuard } from "../src/guard.js";

describe("EgressGuard", () => {
  it("allows hosts on the allowlist", async () => {
    const fetchImpl = vi.fn(async (url) => new Response(`hit ${url}`, { status: 200 }));
    const g = new EgressGuard({ allowlist: ["agent.example.com"], fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await g.fetch("https://agent.example.com/chat");
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks hosts not on the allowlist with a typed error", async () => {
    const g = new EgressGuard({ allowlist: ["allowed.example.com"], fetchImpl: (() => {
      throw new Error("must not call");
    }) as unknown as typeof fetch });
    await expect(g.fetch("https://leaky.bad.example/sneaky")).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("isAllowed returns the right shape", () => {
    const g = new EgressGuard({ allowlist: ["a.example"] });
    expect(g.isAllowed("https://a.example/x")).toBe(true);
    expect(g.isAllowed("https://b.example/x")).toBe(false);
    expect(g.isAllowed("not-a-url")).toBe(false);
  });

  it("allow() adds hosts at runtime, and accepts a full URL", () => {
    const g = new EgressGuard({ allowlist: [] });
    g.allow("https://chat.bitte.example/api/whatever");
    expect(g.allowed()).toContain("chat.bitte.example");
  });

  it("is case-insensitive on host names", () => {
    const g = new EgressGuard({ allowlist: ["Mixed.Case.Example"] });
    expect(g.isAllowed("https://mixed.case.example/x")).toBe(true);
  });
});
