import { createHash } from "node:crypto";

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_WAITING = 32;

export type SocialCardCacheOptions = {
  maxEntries: number;
  maxBytes: number;
  maxConcurrent: number;
  maxWaiting: number;
};

export type SocialCardRenderResult = { bytes: Buffer; cacheable: boolean };

export class SocialCardCapacityError extends Error {
  constructor() {
    super("Social card renderer is busy");
    this.name = "SocialCardCapacityError";
  }
}

export class SocialCardRenderCache {
  private readonly values = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;
  private bytes = 0;

  constructor(private readonly options: SocialCardCacheOptions = {
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxBytes: DEFAULT_MAX_BYTES,
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    maxWaiting: DEFAULT_MAX_WAITING,
  }) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 ||
        !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 ||
        !Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent < 1 ||
        !Number.isSafeInteger(options.maxWaiting) || options.maxWaiting < 0) {
      throw new Error("Invalid social card cache limits");
    }
  }

  get(key: string, render: () => Promise<SocialCardRenderResult>): Promise<Buffer> {
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      this.values.set(key, cached);
      return Promise.resolve(cached);
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.run(render).then((result) => {
      if (result.cacheable) this.store(key, result.bytes);
      return result.bytes;
    }).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  private async run(render: () => Promise<SocialCardRenderResult>): Promise<SocialCardRenderResult> {
    await this.acquire();
    try {
      return await render();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.options.maxWaiting) {
      return Promise.reject(new SocialCardCapacityError());
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  private store(key: string, card: Buffer): void {
    if (card.length > this.options.maxBytes) return;
    const prior = this.values.get(key);
    if (prior) {
      this.bytes -= prior.length;
      this.values.delete(key);
    }
    this.values.set(key, card);
    this.bytes += card.length;
    while (this.values.size > this.options.maxEntries || this.bytes > this.options.maxBytes) {
      const oldest = this.values.entries().next().value as [string, Buffer] | undefined;
      if (!oldest) break;
      this.values.delete(oldest[0]);
      this.bytes -= oldest[1].length;
    }
  }
}

export function socialCardRevision(scope: string, value: unknown): string {
  return createHash("sha256").update(scope).update("\0")
    .update(JSON.stringify(value)).digest("hex");
}

export function socialCardEntityTag(bytes: Uint8Array): string {
  return `"${createHash("sha256").update(bytes).digest("hex")}"`;
}
