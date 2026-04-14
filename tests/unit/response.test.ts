import { describe, it, expect } from "vitest";
import {
  getApiVersion,
  generateRequestId,
  successResponse,
  errorResponse,
  deprecatedResponse,
} from "../../supabase/functions/_shared/response";

describe("generateRequestId", () => {
  it("returns a UUID string", () => {
    const id = generateRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("generates unique IDs", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });
});

describe("getApiVersion", () => {
  it("defaults to 1 when no request", () => {
    expect(getApiVersion()).toBe(1);
  });

  it("defaults to 1 when no header", () => {
    const req = new Request("http://test.com");
    expect(getApiVersion(req)).toBe(1);
  });

  it("reads version from X-API-Version header", () => {
    const req = new Request("http://test.com", {
      headers: { "X-API-Version": "1" },
    });
    expect(getApiVersion(req)).toBe(1);
  });

  it("clamps to max version", () => {
    const req = new Request("http://test.com", {
      headers: { "X-API-Version": "999" },
    });
    // MAX is 1 currently
    expect(getApiVersion(req)).toBe(1);
  });

  it("defaults on NaN", () => {
    const req = new Request("http://test.com", {
      headers: { "X-API-Version": "abc" },
    });
    expect(getApiVersion(req)).toBe(1);
  });
});

describe("successResponse", () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  it("returns 200 status", () => {
    const res = successResponse({ foo: "bar" }, corsHeaders);
    expect(res.status).toBe(200);
  });

  it("includes Content-Type header", () => {
    const res = successResponse({ foo: "bar" }, corsHeaders);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("includes X-Request-ID header", () => {
    const res = successResponse({}, corsHeaders);
    expect(res.headers.get("X-Request-ID")).toBeTruthy();
  });

  it("includes X-API-Version header", () => {
    const res = successResponse({}, corsHeaders);
    expect(res.headers.get("X-API-Version")).toBe("1");
  });

  it("body has success=true", async () => {
    const res = successResponse({ foo: "bar" }, corsHeaders);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("v1 spreads data at top level for objects", async () => {
    const res = successResponse({ foo: "bar" }, corsHeaders);
    const body = await res.json();
    expect(body.foo).toBe("bar");
    expect(body.data.foo).toBe("bar");
  });

  it("includes CORS headers", () => {
    const res = successResponse({}, corsHeaders);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("errorResponse", () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  it("returns the specified status code", () => {
    const res = errorResponse(400, "Bad request", corsHeaders);
    expect(res.status).toBe(400);
  });

  it("body has success=false", async () => {
    const res = errorResponse(500, "Server error", corsHeaders);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Server error");
  });

  it("includes details when provided", async () => {
    const res = errorResponse(422, "Validation", corsHeaders, {
      details: { field: "name" },
    });
    const body = await res.json();
    expect(body.details).toEqual({ field: "name" });
  });

  it("omits details when not provided", async () => {
    const res = errorResponse(404, "Not found", corsHeaders);
    const body = await res.json();
    expect(body.details).toBeUndefined();
  });
});

describe("deprecatedResponse", () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  it("sets Deprecation header", () => {
    const res = deprecatedResponse({ x: 1 }, "Use v2", corsHeaders);
    expect(res.headers.get("Deprecation")).toBe("true");
  });

  it("sets Sunset header when provided", () => {
    const res = deprecatedResponse({ x: 1 }, "Use v2", corsHeaders, {
      sunset: "2026-12-31",
    });
    expect(res.headers.get("Sunset")).toBe("2026-12-31");
  });

  it("body includes deprecation notice", async () => {
    const res = deprecatedResponse({ x: 1 }, "Use v2 API", corsHeaders);
    const body = await res.json();
    expect(body.meta.deprecated).toBe(true);
    expect(body.meta.deprecation_notice).toBe("Use v2 API");
  });
});
