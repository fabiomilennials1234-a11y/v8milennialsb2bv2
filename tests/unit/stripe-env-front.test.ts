// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keyMatchesLivemode, parsePublishableKey } from "@/modules/billing/lib/stripe-env";

describe("parsePublishableKey", () => {
  it("só pk_test_ e pk_live_", () => {
    expect(parsePublishableKey("pk_test_abc123")).toEqual({ ok: true, key: "pk_test_abc123", livemode: false });
    expect(parsePublishableKey("pk_live_abc123")).toEqual({ ok: true, key: "pk_live_abc123", livemode: true });
    for (const bad of [undefined, null, "", "pk_", "pk_test_", "sk_test_abc", "rk_live_abc", "whsec_abc", 42]) {
      expect(parsePublishableKey(bad)).toEqual({ ok: false });
    }
  });
  it("divergência com livemode do servidor recusa nos dois sentidos", () => {
    expect(keyMatchesLivemode(parsePublishableKey("pk_test_a"), false)).toBe(true);
    expect(keyMatchesLivemode(parsePublishableKey("pk_test_a"), true)).toBe(false);
    expect(keyMatchesLivemode(parsePublishableKey("pk_live_a"), false)).toBe(false);
    expect(keyMatchesLivemode({ ok: false }, false)).toBe(false);
  });
});
