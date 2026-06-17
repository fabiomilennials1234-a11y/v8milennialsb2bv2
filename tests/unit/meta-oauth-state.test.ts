/**
 * meta-oauth-state — HMAC-signed OAuth `state` (hotfix: tenant-binding forgery).
 *
 * The Meta OAuth `state` carried userId/orgId as plain base64 JSON; the public
 * callback trusted it and wrote with service_role → an attacker could bind a
 * victim org's Meta connection. These tests pin that a tampered, foreign-secret,
 * or expired state is rejected, and a genuine one round-trips.
 */
import { describe, it, expect } from "vitest";
import {
  signMetaState,
  verifyMetaState,
} from "../../supabase/functions/_shared/meta-oauth-state.ts";

const SECRET = "test-app-secret";

describe("meta-oauth-state HMAC", () => {
  it("round-trips a genuine signed state", async () => {
    const payload = { userId: "u1", orgId: "org-1", connectionType: "facebook", nonce: "n", exp: 9999999999000 };
    const token = await signMetaState(payload, SECRET);
    const out = await verifyMetaState(token, SECRET, { now: 1000 });
    expect(out).toMatchObject({ userId: "u1", orgId: "org-1", connectionType: "facebook" });
  });

  it("rejects a tampered payload (forged orgId)", async () => {
    const token = await signMetaState({ userId: "u1", orgId: "org-1", exp: 9999999999000 }, SECRET);
    // Attacker swaps the payload segment for a forged org, keeps the old signature.
    const forged = btoa(JSON.stringify({ userId: "u1", orgId: "VICTIM-ORG", exp: 9999999999000 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `${forged}.${token.split(".")[1]}`;
    expect(await verifyMetaState(tampered, SECRET, { now: 1000 })).toBeNull();
  });

  it("rejects a state signed with a different secret", async () => {
    const token = await signMetaState({ userId: "u1", orgId: "org-1", exp: 9999999999000 }, "other-secret");
    expect(await verifyMetaState(token, SECRET, { now: 1000 })).toBeNull();
  });

  it("rejects an expired state", async () => {
    const token = await signMetaState({ userId: "u1", orgId: "org-1", exp: 5000 }, SECRET);
    expect(await verifyMetaState(token, SECRET, { now: 6000 })).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifyMetaState("", SECRET, { now: 1000 })).toBeNull();
    expect(await verifyMetaState("nodot", SECRET, { now: 1000 })).toBeNull();
    expect(await verifyMetaState("a.b.c", SECRET, { now: 1000 })).toBeNull();
  });
});
