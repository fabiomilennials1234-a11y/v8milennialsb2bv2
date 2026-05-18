/**
 * Tests for _shared/sentry.ts captureMessage function.
 *
 * Verifies that info-level events with tags are sent via Sentry HTTP envelope API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setDenoEnv, clearDenoEnv } from "../helpers/deno-mock";

// Mock fetch before importing sentry module
const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
globalThis.fetch = fetchMock as unknown as typeof fetch;

// Must import after mocks are set up
import { captureMessage } from "../../supabase/functions/_shared/sentry.ts";

const FAKE_DSN = "https://abc123@o456.ingest.sentry.io/789";

describe("captureMessage", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    setDenoEnv("SENTRY_DSN", FAKE_DSN);
    setDenoEnv("ENVIRONMENT", "test");
  });

  afterEach(() => {
    clearDenoEnv();
  });

  it("sends info-level event to Sentry envelope API", async () => {
    await captureMessage("test.event", {
      functionName: "copilot-batch-processor",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/789/envelope/");
    expect(opts.method).toBe("POST");

    // Parse envelope payload
    const body = opts.body as string;
    const lines = body.split("\n");
    expect(lines.length).toBe(3);

    const event = JSON.parse(lines[2]);
    expect(event.level).toBe("info");
    expect(event.message.formatted).toBe("test.event");
    expect(event.tags.function_name).toBe("copilot-batch-processor");
    expect(event.tags.runtime).toBe("deno");
  });

  it("includes custom tags in the event", async () => {
    await captureMessage("copilot.batch_processed", {
      functionName: "copilot-batch-processor",
      organizationId: "org-123",
      tags: {
        "copilot.batch_size": 5,
        "copilot.batch_wait_ms": 3200,
        "copilot.batch_key": "org-123:conv-456",
        "copilot.forced_drain": false,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as string;
    const event = JSON.parse(body.split("\n")[2]);

    expect(event.tags["copilot.batch_size"]).toBe(5);
    expect(event.tags["copilot.batch_wait_ms"]).toBe(3200);
    expect(event.tags["copilot.batch_key"]).toBe("org-123:conv-456");
    expect(event.tags["copilot.forced_drain"]).toBe(false);
    expect(event.tags.organization_id).toBe("org-123");
  });

  it("silently no-ops when DSN is not configured", async () => {
    clearDenoEnv();

    await captureMessage("should.not.send", {
      functionName: "test",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently ignores fetch errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    // Should not throw
    await captureMessage("test.event", {
      functionName: "test",
    });
  });

  it("includes user id when provided", async () => {
    await captureMessage("test.event", {
      functionName: "test",
      userId: "user-abc",
    });

    const body = fetchMock.mock.calls[0][1].body as string;
    const event = JSON.parse(body.split("\n")[2]);
    expect(event.user.id).toBe("user-abc");
  });

  it("includes extra context when provided", async () => {
    await captureMessage("test.event", {
      functionName: "test",
      extra: { batch_count: 42 },
    });

    const body = fetchMock.mock.calls[0][1].body as string;
    const event = JSON.parse(body.split("\n")[2]);
    expect(event.extra.batch_count).toBe(42);
  });
});
