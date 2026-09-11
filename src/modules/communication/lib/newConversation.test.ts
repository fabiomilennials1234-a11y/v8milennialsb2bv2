import { describe, expect, it } from "vitest";
import { hasEstablishedOutgoing, newConversationUnavailableReason, prepareNewConversation } from "./newConversation";
import type { ChatContact, InboxBox } from "../hooks/chat/types";

const box: InboxBox = { kind: "whatsapp", id: "sales", name: "Vendas", status: "connected", provider: "uazapi" };
const contact = (overrides: Partial<ChatContact> = {}): ChatContact => ({
  channel: "whatsapp", instance_id: "sales", phone_number: "48999999999", push_name: null,
  last_message: null, last_message_time: "2026-09-09", last_message_direction: null,
  last_message_sent_source: null, unread_count: 0, lead_id: null, lead_name: null,
  conversation_id: null, archived_at: null, tags: [], is_group: false, ...overrides,
});

describe("new conversation without a lead", () => {
  it("opens an empty inbox using only the number and selected account", () => {
    expect(prepareNewConversation("(48) 99999-9999", box, [])).toEqual({ key: "whatsapp:sales:5548999999999", isNew: true });
  });
  it("reuses the canonical conversation even without a lead", () => {
    expect(prepareNewConversation("+55 (48) 99999-9999", box, [contact()])).toEqual({ key: "whatsapp:sales:48999999999", isNew: false });
  });
  it("does not reuse the same number from another account", () => {
    expect(prepareNewConversation("48999999999", box, [contact({ instance_id: "other" })])?.isNew).toBe(true);
  });
  it("keeps business landlines intact", () => {
    expect(prepareNewConversation("(51) 3407-3827", box, [])?.key).toBe("whatsapp:sales:555134073827");
  });
  it.each([null, { ...box, status: "disconnected" }, { ...box, provider: "notificame" }])("refuses unavailable or unsupported inboxes %j", (unavailable) => {
    expect(newConversationUnavailableReason(unavailable)).toBeTruthy();
    expect(prepareNewConversation("48999999999", unavailable, [])).toBeNull();
  });
  it.each(["", "123", "abc48999999999", "00000000000"])("rejects invalid number %s", (phone) => {
    expect(prepareNewConversation(phone, box, [])).toBeNull();
  });
  it.each(["pending", "failed", "retrying"])("does not unlock lead creation for %s sends", (status) => {
    expect(hasEstablishedOutgoing([{ direction: "outgoing", status }])).toBe(false);
  });
  it.each(["sent", "delivered", "read"])("unlocks lead creation after a successful %s send", (status) => {
    expect(hasEstablishedOutgoing([{ direction: "outgoing", status }])).toBe(true);
  });
});
