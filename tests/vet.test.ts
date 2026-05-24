import { describe, expect, it } from "vitest";
import { assertToolCall, ToolArgError, vetToolCall, vetToolCalls } from "../src/vet.js";
import type { ToolSchema } from "../src/types.js";

const tools: ToolSchema[] = [
  {
    name: "transfer",
    parameters: {
      type: "object",
      required: ["recipient", "amount"],
      properties: {
        recipient: { type: "string" },
        amount: { type: "number" },
        memo: { type: "string" },
        network: { type: "string", enum: ["mainnet", "testnet"] },
      },
    },
  },
  {
    name: "lookup",
    parameters: {
      type: "object",
      required: ["account"],
      properties: {
        account: { type: "string" },
      },
    },
  },
];

describe("vet", () => {
  it("passes on a valid tool call", () => {
    const r = vetToolCall({ name: "transfer", arguments: { recipient: "alice.near", amount: 1.0 } }, tools);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags missing required arg with an agent-readable hint", () => {
    const r = vetToolCall({ name: "transfer", arguments: { recipient: "alice.near" } }, tools);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/amount is required/);
  });

  it("flags wrong type", () => {
    const r = vetToolCall(
      { name: "transfer", arguments: { recipient: "alice.near", amount: "1" } },
      tools,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("expected number"))).toBe(true);
  });

  it("enforces enum values", () => {
    const r = vetToolCall(
      { name: "transfer", arguments: { recipient: "a.near", amount: 1, network: "betanet" } },
      tools,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("must be one of"))).toBe(true);
  });

  it("passes unknown tools by default", () => {
    const r = vetToolCall({ name: "made_up", arguments: {} }, tools);
    expect(r.ok).toBe(true);
  });

  it("rejects unknown tools when strictUnknownTools is true", () => {
    const r = vetToolCall({ name: "made_up", arguments: {} }, tools, { strictUnknownTools: true });
    expect(r.ok).toBe(false);
  });

  it("assertToolCall throws ToolArgError on failure", () => {
    expect(() =>
      assertToolCall({ name: "transfer", arguments: { recipient: "a.near" } }, tools),
    ).toThrow(ToolArgError);
  });

  it("vetToolCalls collects errors with tool-name prefix", () => {
    const r = vetToolCalls(
      [
        { name: "transfer", arguments: { recipient: "a.near" } },
        { name: "lookup", arguments: {} },
      ],
      tools,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("transfer:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("lookup:"))).toBe(true);
  });
});
