/**
 * Unit tests for connected-account number extraction (whatsapp-owner.ts).
 * This is the risky parsing surface — Uazapi's owner field name/shape is
 * unstable, so extraction is field-agnostic and defensive.
 */
import { describe, it, expect } from "vitest";
import {
  jidToPhone,
  extractOwnerNumber,
} from "../../supabase/functions/_shared/whatsapp-owner.ts";

describe("jidToPhone", () => {
  it("strips @s.whatsapp.net suffix", () => {
    expect(jidToPhone("5548999998888@s.whatsapp.net")).toBe("5548999998888");
  });

  it("strips @c.us suffix", () => {
    expect(jidToPhone("554899998888@c.us")).toBe("554899998888");
  });

  it("strips :NN multi-device suffix before the @", () => {
    expect(jidToPhone("5548999998888:12@s.whatsapp.net")).toBe("5548999998888");
  });

  it("accepts bare digits", () => {
    expect(jidToPhone("554899998888")).toBe("554899998888");
  });

  it("rejects group JIDs", () => {
    expect(jidToPhone("120363041234567890@g.us")).toBeUndefined();
  });

  it("rejects @lid LinkedID handles regardless of length", () => {
    expect(jidToPhone("12036305@lid")).toBeUndefined();
    expect(jidToPhone("1234567890123@lid")).toBeUndefined();
    expect(jidToPhone("123456789012345@lid")).toBeUndefined();
  });

  it("rejects implausibly long values", () => {
    expect(jidToPhone("12345678901234567")).toBeUndefined();
  });

  it("returns undefined for non-string / empty input", () => {
    expect(jidToPhone(undefined)).toBeUndefined();
    expect(jidToPhone(null)).toBeUndefined();
    expect(jidToPhone(123456789012 as unknown)).toBeUndefined();
    expect(jidToPhone("")).toBeUndefined();
    expect(jidToPhone({} as unknown)).toBeUndefined();
  });
});

describe("extractOwnerNumber", () => {
  it("reads top-level owner field", () => {
    expect(
      extractOwnerNumber({ status: "connected", connected: true, owner: "554899998888@s.whatsapp.net" }),
    ).toBe("554899998888");
  });

  it("reads nested instance.owner", () => {
    expect(extractOwnerNumber({ instance: { owner: "554899998888" } })).toBe("554899998888");
  });

  it("reads jid from the /instance/init status object", () => {
    expect(
      extractOwnerNumber({ status: { connected: true, loggedIn: true, jid: "5548999998888:5@s.whatsapp.net" } }),
    ).toBe("5548999998888");
  });

  it("reads jid from nested instance.status object", () => {
    expect(
      extractOwnerNumber({ instance: { status: { jid: "554899998888@s.whatsapp.net" } } }),
    ).toBe("554899998888");
  });

  it("reads alternative key names (wid)", () => {
    expect(extractOwnerNumber({ wid: "554899998888" })).toBe("554899998888");
  });

  it("prefers owner over other keys", () => {
    expect(extractOwnerNumber({ owner: "554811112222", jid: "554833334444" })).toBe("554811112222");
  });

  it("skips a group-JID owner and falls through to a real number", () => {
    expect(
      extractOwnerNumber({ owner: "120363041234567890@g.us", jid: "554899998888@s.whatsapp.net" }),
    ).toBe("554899998888");
  });

  it("skips an @lid handle and falls through to a real number", () => {
    expect(
      extractOwnerNumber({ jid: "1234567890123@lid", number: "554899998888" }),
    ).toBe("554899998888");
  });

  it("returns undefined when the only candidate is an @lid handle", () => {
    expect(extractOwnerNumber({ wid: "1234567890123@lid" })).toBeUndefined();
  });

  it("returns undefined when status is a plain string and no owner present", () => {
    expect(extractOwnerNumber({ status: "connected", connected: true })).toBeUndefined();
  });

  it("returns undefined for empty / non-object input", () => {
    expect(extractOwnerNumber({})).toBeUndefined();
    expect(extractOwnerNumber(null)).toBeUndefined();
    expect(extractOwnerNumber(undefined)).toBeUndefined();
    expect(extractOwnerNumber("connected")).toBeUndefined();
  });
});
