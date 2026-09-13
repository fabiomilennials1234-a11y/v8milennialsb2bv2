import { describe, expect, it } from "vitest";
import { echoStatus, statusesBeforeEcho } from "../../supabase/functions/whatsapp-webhook/echo-status";

describe("outgoing echo receipts", () => {
  it.each([["Pending", "pending"], ["Sent", "sent"], ["Delivered", "delivered"], ["Read", "read"]])("normalizes %s", (raw, expected) => {
    expect(echoStatus("outgoing", raw)).toBe(expected);
  });
  it("keeps incoming received independently of the sender status", () => expect(echoStatus("incoming", "Read")).toBe("received"));
  it("only promotes earlier receipt states", () => {
    expect(statusesBeforeEcho("sent")).toEqual(["pending"]);
    expect(statusesBeforeEcho("delivered")).toEqual(["pending", "sent"]);
    expect(statusesBeforeEcho("read")).toEqual(["pending", "sent", "delivered"]);
    expect(statusesBeforeEcho("pending")).toEqual([]);
  });
});
