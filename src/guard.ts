// Egress allowlist for any fetch we proxy on behalf of a launcher.
//
// Pattern mirrors MukundaKatta/agentguard: declarative allowlist of hosts the
// bot is permitted to talk to, default-deny everything else, throw a typed
// error on violation. We pre-seed with the Bitte agent's chat endpoint host
// so the common case is friction-free.

export class EgressBlockedError extends Error {
  public readonly host: string;
  public readonly url: string;
  constructor(host: string, url: string) {
    super(`egress blocked: ${host} not in allowlist (full url: ${url})`);
    this.host = host;
    this.url = url;
    this.name = "EgressBlockedError";
  }
}

export interface GuardOptions {
  allowlist: string[];
  // Test seam.
  fetchImpl?: typeof fetch;
}

export class EgressGuard {
  private readonly hosts: Set<string>;
  private readonly fetchImpl: typeof fetch;
  constructor(opts: GuardOptions) {
    this.hosts = new Set(opts.allowlist.map(normalizeHost));
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  /** Add a host to the allowlist at runtime (e.g. discovered chat URL). */
  allow(host: string): void {
    this.hosts.add(normalizeHost(host));
  }
  isAllowed(url: string): boolean {
    const host = safeHost(url);
    if (!host) return false;
    return this.hosts.has(host);
  }
  /** Allowlist-gated fetch. Throws EgressBlockedError on violation. */
  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input.toString();
    const host = safeHost(url);
    if (!host || !this.hosts.has(host)) {
      throw new EgressBlockedError(host ?? "(unparseable)", url);
    }
    return this.fetchImpl(url, init);
  }
  /** Snapshot of currently allowed hosts. Useful for diagnostics. */
  allowed(): string[] {
    return Array.from(this.hosts).sort();
  }
}

function normalizeHost(host: string): string {
  // Strip a leading scheme/path if the caller accidentally passed a URL.
  if (host.includes("://")) {
    try {
      return new URL(host).host.toLowerCase();
    } catch {
      return host.toLowerCase();
    }
  }
  return host.toLowerCase();
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}
