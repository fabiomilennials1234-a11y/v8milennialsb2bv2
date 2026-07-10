import { describe, it, expect, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { getCorsHeaders } from "../../supabase/functions/_shared/cors";

beforeEach(() => {
  clearDenoEnv();
});

describe("getCorsHeaders", () => {
  it("returns wildcard when no origin and no ALLOWED_ORIGINS", () => {
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("returns wildcard when origin provided but no ALLOWED_ORIGINS", () => {
    const headers = getCorsHeaders("https://example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("returns localhost origin when origin is localhost", () => {
    const headers = getCorsHeaders("http://localhost:8080");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:8080");
  });

  it("returns 127.0.0.1 origin", () => {
    const headers = getCorsHeaders("http://127.0.0.1:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:3000");
  });

  it("returns matching origin when ALLOWED_ORIGINS is set", () => {
    setDenoEnv("ALLOWED_ORIGINS", "https://torquecrm.com.br,https://app.torquecrm.com.br");
    const headers = getCorsHeaders("https://torquecrm.com.br");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://torquecrm.com.br");
  });

  it("returns first allowed origin when no origin provided", () => {
    setDenoEnv("ALLOWED_ORIGINS", "https://torquecrm.com.br,https://app.torquecrm.com.br");
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://torquecrm.com.br");
  });

  it("returns first allowed when origin not in list", () => {
    setDenoEnv("ALLOWED_ORIGINS", "https://torquecrm.com.br");
    const headers = getCorsHeaders("https://evil.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("includes required CORS headers", () => {
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(headers["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(headers["Access-Control-Allow-Headers"]).toContain("content-type");
    expect(headers["Access-Control-Max-Age"]).toBe("86400");
  });

  it("allows x-cron-secret and x-webhook-key headers", () => {
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Headers"]).toContain("x-cron-secret");
    expect(headers["Access-Control-Allow-Headers"]).toContain("x-webhook-key");
  });

  // Regression: createTracedFetch (src/core/trace/request-trace.ts) stamps these
  // on every supabase client call, functions.invoke included. If the allowlist
  // omits them, the browser blocks the invoke POST on preflight and surfaces
  // "Failed to send a request to the Edge Function".
  it("allows x-torque-session-id and x-torque-request-id trace headers", () => {
    const headers = getCorsHeaders();
    expect(headers["Access-Control-Allow-Headers"]).toContain("x-torque-session-id");
    expect(headers["Access-Control-Allow-Headers"]).toContain("x-torque-request-id");
  });
});
