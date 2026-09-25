/**
 * The refresh button asks the GATEWAY, never the pipeline.
 *
 * Owner rule (2026-09-25): the pipeline sits behind the databases and never
 * touches the app; the gateway Worker is the app's backend. If this regresses,
 * the app holds the pipeline's service secret again and skips the gateway's
 * per-caller cooldown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function load() {
  return (await import("../actions/refresh")).triggerFeedCollection;
}

describe("triggerFeedCollection", () => {
  it("POSTs to the gateway's refresh endpoint with no credential of its own", async () => {
    vi.stubEnv("GATEWAY_API_URL", "https://news.mukoko.dev");
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 202 }));

    await (
      await load()
    )();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://news.mukoko.dev/api/refresh");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults to the production gateway when GATEWAY_API_URL is unset", async () => {
    vi.stubEnv("GATEWAY_API_URL", "");
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 202 }));

    await (
      await load()
    )();

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://news.mukoko.dev/api/refresh",
    );
  });

  it("swallows a declined or failed refresh so the feed still reloads", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect((await load())()).resolves.toBeUndefined();

    mockFetch.mockRejectedValueOnce(new Error("network down"));
    await expect((await load())()).resolves.toBeUndefined();
  });

  it("never names the pipeline or its credential", () => {
    const source = readFileSync(
      join(__dirname, "../actions/refresh.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(
      /FLY_WORKER_URL|FLY_TRIGGER_TOKEN|trigger\/collect|fly\.dev|fly-worker/,
    );
  });
});
