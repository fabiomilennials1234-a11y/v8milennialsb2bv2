/**
 * Branch coverage for meta-api.ts — complements shared-meta-api.test.ts
 * by covering missing-env throws, best-effort catches, and uncovered
 * executors: acceptLeadgenTos, getLeadFormFields, listLeadForms pagination
 * error, listPages IG fetch catch, sendMediaMessage error branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac as realCreateHmac } from "crypto";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

// Note: vitest.config.ts aliases the Deno std crypto URL to Node's `crypto`,
// so createHmac uses the real implementation — no vi.mock needed.

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  buildLoginUrl,
  verifyWebhookSignature,
  acceptLeadgenTos,
  getLeadFormFields,
  listLeadForms,
  listPages,
  sendMediaMessage,
} from "../../supabase/functions/_shared/meta-api";

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
});

// ─── Missing env throws ───────────────────────────────────────────────────

describe("meta-api — missing env throws", () => {
  it("exchangeCodeForToken throws when any env missing", async () => {
    setDenoEnv("META_APP_ID", "x");
    setDenoEnv("META_APP_SECRET", "y");
    // META_REDIRECT_URI missing
    await expect(exchangeCodeForToken("c")).rejects.toThrow(/META_APP_ID|META_APP_SECRET|META_REDIRECT_URI/);
  });

  it("exchangeForLongLivedToken throws when env missing", async () => {
    await expect(exchangeForLongLivedToken("tok")).rejects.toThrow(/META_APP_ID|META_APP_SECRET/);
  });

  it("buildLoginUrl throws when env missing", () => {
    expect(() => buildLoginUrl("state-1")).toThrow(/META_APP_ID|META_REDIRECT_URI/);
  });

  it("buildLoginUrl happy path includes state + auth_type", () => {
    setDenoEnv("META_APP_ID", "aid");
    setDenoEnv("META_REDIRECT_URI", "https://x/cb");
    const url = buildLoginUrl("s1", { authType: "reauthenticate" });
    expect(url).toContain("state=s1");
    expect(url).toContain("auth_type=reauthenticate");
    expect(url).toContain("client_id=aid");
  });

  it("buildLoginUrl without state param", () => {
    setDenoEnv("META_APP_ID", "aid");
    setDenoEnv("META_REDIRECT_URI", "https://x/cb");
    const url = buildLoginUrl();
    expect(url).not.toContain("state=");
  });
});

// ─── verifyWebhookSignature edge cases ────────────────────────────────────

describe("verifyWebhookSignature", () => {
  it("returns false when META_APP_SECRET missing", () => {
    expect(verifyWebhookSignature("payload", "sha256=abc")).toBe(false);
  });

  it("returns false when signature header missing", () => {
    setDenoEnv("META_APP_SECRET", "secret");
    expect(verifyWebhookSignature("payload", null)).toBe(false);
  });

  it("returns true when signature matches computed hmac", () => {
    setDenoEnv("META_APP_SECRET", "secret");
    const expected =
      "sha256=" + realCreateHmac("sha256", "secret").update("payload").digest("hex");
    expect(verifyWebhookSignature("payload", expected)).toBe(true);
  });

  it("returns false when signature differs", () => {
    setDenoEnv("META_APP_SECRET", "secret");
    expect(verifyWebhookSignature("payload", "sha256=deadbeef")).toBe(false);
  });
});

// ─── acceptLeadgenTos ─────────────────────────────────────────────────────

describe("acceptLeadgenTos", () => {
  it("returns true on data.success=true", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });
    expect(await acceptLeadgenTos("page-1", "tok")).toBe(true);
  });

  it("returns true on data.accepted=true", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ accepted: true }),
    });
    expect(await acceptLeadgenTos("page-1", "tok")).toBe(true);
  });

  it("returns false + warns when API returns error", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "denied" } }),
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await acceptLeadgenTos("page-1", "tok")).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns false on thrown fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await acceptLeadgenTos("page-1", "tok")).toBe(false);
    spy.mockRestore();
  });
});

// ─── getLeadFormFields ────────────────────────────────────────────────────

describe("getLeadFormFields", () => {
  it("returns mapped fields on success", async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          questions: [
            { key: "FULL_NAME", label: "Nome", type: "name" },
            { key: "EMAIL", label: "Email", type: "email" },
          ],
        }),
    });
    const result = await getLeadFormFields("form-1", "tok");
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("FULL_NAME");
  });

  it("returns [] when questions missing", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({}),
    });
    expect(await getLeadFormFields("f", "tok")).toEqual([]);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "bad form" } }),
    });
    await expect(getLeadFormFields("f", "tok")).rejects.toThrow(/getLeadFormFields/);
  });
});

// ─── listLeadForms pagination error + TOS not accepted ────────────────────

describe("listLeadForms — branches", () => {
  it("returns tos_not_accepted when page has not accepted", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ leadgen_tos_accepted: false }),
    });
    const r = await listLeadForms("page-1", "tok");
    expect(r.tos_not_accepted).toBe(true);
    expect(r.forms).toEqual([]);
    expect(r.tos_accept_url).toContain("page-1");
  });

  it("throws when paginated request errors mid-stream", async () => {
    let call = 0;
    mockFetch.mockImplementation(() => {
      call++;
      if (call === 1) {
        // TOS accepted
        return Promise.resolve({
          json: () => Promise.resolve({ leadgen_tos_accepted: true }),
        });
      }
      // Subsequent: error
      return Promise.resolve({
        json: () => Promise.resolve({ error: { message: "rate limited" } }),
      });
    });
    await expect(listLeadForms("page-1", "tok")).rejects.toThrow(/listLeadForms/);
  });

  it("paginates through multiple pages", async () => {
    let call = 0;
    mockFetch.mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          json: () => Promise.resolve({ leadgen_tos_accepted: true }),
        });
      }
      if (call === 2) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              data: [{ id: "f1", name: "Form 1", status: "ACTIVE" }],
              paging: { next: "https://next-page" },
            }),
        });
      }
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            data: [{ id: "f2", name: "Form 2", status: "ACTIVE" }],
          }),
      });
    });
    const r = await listLeadForms("page-1", "tok");
    expect(r.forms).toHaveLength(2);
  });
});

// ─── listPages IG fetch catch ─────────────────────────────────────────────

describe("listPages — IG fetch catch", () => {
  it("continues when IG username fetch throws", async () => {
    let call = 0;
    mockFetch.mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: "p1",
                  name: "Page 1",
                  access_token: "ptk",
                  instagram_business_account: { id: "ig-1" },
                },
              ],
            }),
        });
      }
      // IG fetch throws
      throw new Error("IG network");
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pages = await listPages("utk");
    expect(pages).toHaveLength(1);
    expect(pages[0].instagram_username).toBeUndefined();
    spy.mockRestore();
  });

  it("attaches instagram_username when IG fetch succeeds", async () => {
    let call = 0;
    mockFetch.mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: "p1",
                  name: "P1",
                  access_token: "ptk",
                  instagram_business_account: { id: "ig-1" },
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ username: "theuser" }),
      });
    });
    const pages = await listPages("utk");
    expect(pages[0].instagram_username).toBe("theuser");
  });
});

// ─── sendMediaMessage error branch ────────────────────────────────────────

describe("sendMediaMessage error", () => {
  it("throws when API returns error", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ error: { message: "rejected" } }),
    });
    await expect(
      sendMediaMessage("ptk", "rec", "https://x/img.jpg", "image", "messenger", "page-1"),
    ).rejects.toThrow(/sendMedia/);
  });
});
