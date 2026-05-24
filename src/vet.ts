// Tool-argument validator for Bitte tool calls.
//
// Pattern mirrors MukundaKatta/agentvet: when an agent emits a tool call, we
// validate the arguments against the declared parameter schema BEFORE we let
// any downstream code execute it. On failure we return a single agent-readable
// retry hint per failure (not a stack trace), so the agent can correct itself
// on the next turn.

import type { BitteToolCall, ToolParameter, ToolSchema, VetResult } from "./types.js";

export class ToolArgError extends Error {
  public readonly toolName: string;
  public readonly hints: string[];
  constructor(toolName: string, hints: string[]) {
    super(`tool ${toolName} args invalid: ${hints.join("; ")}`);
    this.toolName = toolName;
    this.hints = hints;
    this.name = "ToolArgError";
  }
}

export interface VetOptions {
  // If true, unknown tool calls are treated as a vet failure. If false, they
  // pass through (some Bitte agents have dynamic tools that aren't in the
  // manifest). Defaults to false.
  strictUnknownTools?: boolean;
}

/**
 * Validate a single tool call against the agent's declared tool set.
 *
 * Returns a VetResult with `ok` plus agent-readable hints. Callers that want
 * to throw can use `assertToolCall` instead.
 */
export function vetToolCall(
  call: BitteToolCall,
  tools: ToolSchema[],
  opts: VetOptions = {},
): VetResult {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    if (opts.strictUnknownTools) {
      return {
        ok: false,
        errors: [`tool "${call.name}" is not declared in the agent manifest`],
      };
    }
    return { ok: true, errors: [] };
  }
  const errors: string[] = [];
  validateValue(call.arguments, tool.parameters, "$", errors);
  return { ok: errors.length === 0, errors };
}

/** Throws ToolArgError if vet fails. */
export function assertToolCall(call: BitteToolCall, tools: ToolSchema[], opts: VetOptions = {}): void {
  const r = vetToolCall(call, tools, opts);
  if (!r.ok) {
    throw new ToolArgError(call.name, r.errors);
  }
}

/** Vet an entire batch of tool calls, collecting all hints. */
export function vetToolCalls(
  calls: BitteToolCall[],
  tools: ToolSchema[],
  opts: VetOptions = {},
): VetResult {
  const errors: string[] = [];
  for (const c of calls) {
    const r = vetToolCall(c, tools, opts);
    if (!r.ok) {
      for (const e of r.errors) errors.push(`${c.name}: ${e}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------- internal ----------

function validateValue(value: unknown, schema: ToolParameter, path: string, errors: string[]): void {
  // Skip if no schema declared.
  if (!schema || !schema.type) return;

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path} expected object, got ${describe(value)}`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) {
        errors.push(`${path}.${req} is required (per manifest)`);
      }
    }
    for (const [k, subSchema] of Object.entries(schema.properties ?? {})) {
      if (k in obj) {
        validateValue(obj[k], subSchema, `${path}.${k}`, errors);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} expected array, got ${describe(value)}`);
      return;
    }
    if (schema.items) {
      value.forEach((v, i) => validateValue(v, schema.items as ToolParameter, `${path}[${i}]`, errors));
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path} expected string, got ${describe(value)}`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of [${schema.enum.join(", ")}], got "${value}"`);
    }
    return;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${path} expected ${schema.type}, got ${describe(value)}`);
      return;
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      errors.push(`${path} expected integer, got ${value}`);
    }
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${path} expected boolean, got ${describe(value)}`);
    }
    return;
  }
  // Unknown types pass through; we don't want to be more strict than Bitte.
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
