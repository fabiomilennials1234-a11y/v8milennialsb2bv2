import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidPhone,
  sanitizeString,
  sanitizeForHtml,
  sanitizeUrl,
  validateLeadInput,
  isValidUUID,
  isValidISODate,
  validateArraySize,
} from "../../supabase/functions/_shared/validation";

// ---------------------------------------------------------------------------
// isValidEmail
// ---------------------------------------------------------------------------
describe("isValidEmail", () => {
  it("returns true for valid email", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("returns true for email with subdomain", () => {
    expect(isValidEmail("user@sub.domain.com")).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidEmail(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidEmail(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("returns false for missing @", () => {
    expect(isValidEmail("userexample.com")).toBe(false);
  });

  it("returns false for missing domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("returns false for spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidPhone
// ---------------------------------------------------------------------------
describe("isValidPhone", () => {
  it("returns true for null (phone is optional)", () => {
    expect(isValidPhone(null)).toBe(true);
  });

  it("returns true for undefined", () => {
    expect(isValidPhone(undefined)).toBe(true);
  });

  it("returns true for valid 11-digit BR phone", () => {
    expect(isValidPhone("11987654321")).toBe(true);
  });

  it("returns true for phone with formatting", () => {
    expect(isValidPhone("+55 (11) 98765-4321")).toBe(true);
  });

  it("returns false for too short", () => {
    expect(isValidPhone("12345")).toBe(false);
  });

  it("returns false for letters", () => {
    expect(isValidPhone("abcdefghij")).toBe(false);
  });

  it("returns true for empty string (treated as no phone)", () => {
    // Empty string is falsy, so optional
    expect(isValidPhone("")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------
describe("sanitizeString", () => {
  it("returns null for null input", () => {
    expect(sanitizeString(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(sanitizeString(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(sanitizeString("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("encodes HTML entities", () => {
    const result = sanitizeString("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });

  it("removes javascript: protocol", () => {
    const result = sanitizeString("javascript:alert(1)");
    expect(result).not.toContain("javascript:");
  });

  it("removes data: protocol", () => {
    const result = sanitizeString("data:text/html,<h1>hack</h1>");
    expect(result).not.toContain("data:");
  });

  it("removes event handlers", () => {
    const result = sanitizeString('onerror=alert(1)');
    expect(result).not.toMatch(/onerror\s*=/i);
  });

  it("removes null bytes", () => {
    const result = sanitizeString("hello\x00world");
    expect(result).toBe("helloworld");
  });

  it("truncates to maxLength", () => {
    const long = "a".repeat(2000);
    const result = sanitizeString(long, 100);
    expect(result!.length).toBeLessThanOrEqual(100);
  });

  it("uses default maxLength of 1000", () => {
    const long = "a".repeat(2000);
    const result = sanitizeString(long);
    expect(result!.length).toBeLessThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// sanitizeForHtml
// ---------------------------------------------------------------------------
describe("sanitizeForHtml", () => {
  it("returns empty string for null", () => {
    expect(sanitizeForHtml(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(sanitizeForHtml(undefined)).toBe("");
  });

  it("encodes < and >", () => {
    expect(sanitizeForHtml("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("encodes &", () => {
    expect(sanitizeForHtml("a & b")).toBe("a &amp; b");
  });

  it("encodes quotes", () => {
    expect(sanitizeForHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("passes through safe text unchanged", () => {
    expect(sanitizeForHtml("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl
// ---------------------------------------------------------------------------
describe("sanitizeUrl", () => {
  it("returns null for null", () => {
    expect(sanitizeUrl(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(sanitizeUrl(undefined)).toBeNull();
  });

  it("blocks javascript: URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("blocks data: URLs", () => {
    expect(sanitizeUrl("data:text/html,<h1>hack</h1>")).toBeNull();
  });

  it("blocks vbscript: URLs", () => {
    expect(sanitizeUrl("vbscript:msgbox")).toBeNull();
  });

  it("blocks file: URLs", () => {
    expect(sanitizeUrl("file:///etc/passwd")).toBeNull();
  });

  it("allows https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("allows http URLs", () => {
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("allows relative URLs", () => {
    expect(sanitizeUrl("/api/test")).toBe("/api/test");
  });

  it("adds https:// if no scheme", () => {
    expect(sanitizeUrl("example.com")).toBe("https://example.com");
  });

  it("trims whitespace", () => {
    expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("case-insensitive blocking", () => {
    expect(sanitizeUrl("JAVASCRIPT:alert(1)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateLeadInput
// ---------------------------------------------------------------------------
describe("validateLeadInput", () => {
  it("valid with just name", () => {
    const result = validateLeadInput({ name: "João" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("invalid without name", () => {
    const result = validateLeadInput({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Nome é obrigatório");
  });

  it("invalid with empty name", () => {
    const result = validateLeadInput({ name: "   " });
    expect(result.valid).toBe(false);
  });

  it("invalid with name > 200 chars", () => {
    const result = validateLeadInput({ name: "a".repeat(201) });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("200 caracteres");
  });

  it("invalid email flagged", () => {
    const result = validateLeadInput({ name: "Test", email: "not-an-email" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Email inválido");
  });

  it("valid email passes", () => {
    const result = validateLeadInput({ name: "Test", email: "test@example.com" });
    expect(result.valid).toBe(true);
  });

  it("invalid phone flagged", () => {
    const result = validateLeadInput({ name: "Test", phone: "123" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Telefone inválido");
  });

  it("rating must be 0-10", () => {
    const result = validateLeadInput({ name: "Test", rating: 15 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Rating");
  });

  it("rating as string is parsed", () => {
    const result = validateLeadInput({ name: "Test", rating: "5" });
    expect(result.valid).toBe(true);
  });

  it("rating NaN is invalid", () => {
    const result = validateLeadInput({ name: "Test", rating: "abc" });
    expect(result.valid).toBe(false);
  });

  it("valid origin passes", () => {
    const result = validateLeadInput({ name: "Test", origin: "meta_ads" });
    expect(result.valid).toBe(true);
  });

  it("invalid origin flagged", () => {
    const result = validateLeadInput({ name: "Test", origin: "invalid_source" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Origin inválido");
  });

  it("multiple errors reported", () => {
    const result = validateLeadInput({
      email: "bad",
      phone: "x",
      rating: 99,
      origin: "nope",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// isValidUUID
// ---------------------------------------------------------------------------
describe("isValidUUID", () => {
  it("returns true for valid UUID v4", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidUUID("")).toBe(false);
  });

  it("returns false for random string", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
  });

  it("returns false for UUID without dashes", () => {
    expect(isValidUUID("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("case insensitive", () => {
    expect(isValidUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidISODate
// ---------------------------------------------------------------------------
describe("isValidISODate", () => {
  it("returns true for valid ISO date", () => {
    expect(isValidISODate("2026-04-13T12:00:00.000Z")).toBe(true);
  });

  it("returns true for date only", () => {
    expect(isValidISODate("2026-04-13")).toBe(true);
  });

  it("returns false for nonsensical date", () => {
    expect(isValidISODate("2026-13-45")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidISODate("")).toBe(false);
  });

  it("returns false for random text", () => {
    expect(isValidISODate("not-a-date")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateArraySize
// ---------------------------------------------------------------------------
describe("validateArraySize", () => {
  it("valid when under max", () => {
    expect(validateArraySize([1, 2, 3], 5, "tags")).toEqual({ valid: true });
  });

  it("valid at exact max", () => {
    expect(validateArraySize([1, 2, 3], 3, "tags")).toEqual({ valid: true });
  });

  it("invalid when over max", () => {
    const result = validateArraySize([1, 2, 3, 4], 3, "tags");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("tags");
    expect(result.error).toContain("3");
  });

  it("valid for empty array", () => {
    expect(validateArraySize([], 10, "items")).toEqual({ valid: true });
  });
});
