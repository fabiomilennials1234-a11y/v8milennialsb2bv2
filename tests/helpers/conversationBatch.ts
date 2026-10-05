import type { BatchContact } from "../../src/modules/communication/lib/conversationBatch";

export function batchContact(phone: string, instance = "box-a"): BatchContact {
  return { channel: "whatsapp", instance_id: instance, phone_number: phone, push_name: phone,
    last_message: null, last_message_time: "2026-10-05T12:00:00Z", last_message_direction: "incoming",
    last_message_sent_source: null, unread_count: 0, lead_id: null, lead_name: null,
    conversation_id: null, archived_at: null, tags: [], is_group: false };
}
