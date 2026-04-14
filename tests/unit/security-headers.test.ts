import { describe, it, expect } from "vitest";
import {
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../../supabase/functions/_shared/security-headers";

describe("SECURITY_HEADERS", () => {
  it("includes X-Content-Type-Options nosniff", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("includes X-Frame-Options DENY", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  it("includes X-XSS-Protection", () => {
    expect(SECURITY_HEADERS["X-XSS-Protection"]).toBe("1; mode=block");
  });

  it("includes Referrer-Policy", () => {
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("includes Permissions-Policy", () => {
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("geolocation=()");
  });
});

describe("withSecurityHeaders", () => {
  it("merges security headers with provided headers", () => {
    const custom = { "Content-Type": "application/json" };
    const result = withSecurityHeaders(custom);
    expect(result["Content-Type"]).toBe("application/json");
    expect(result["X-Content-Type-Options"]).toBe("nosniff");
    expect(result["X-Frame-Options"]).toBe("DENY");
  });

  it("custom headers override security headers", () => {
    const custom = { "X-Frame-Options": "SAMEORIGIN" };
    const result = withSecurityHeaders(custom);
    expect(result["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("returns all security headers when no custom headers", () => {
    const result = withSecurityHeaders({});
    expect(Object.keys(result).length).toBe(Object.keys(SECURITY_HEADERS).length);
  });
});
