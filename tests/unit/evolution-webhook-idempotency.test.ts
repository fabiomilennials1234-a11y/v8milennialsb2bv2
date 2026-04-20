/**
 * Contract tests for evolution-webhook/index.ts idempotency invariants.
 *
 * Invariant: every write to whatsapp_messages in the Evolution webhook must be
 * an upsert with onConflict="message_id,instance_id". This guarantees that
 * echoes of messages already persisted by outbound-sender or
 * workflow-action-handler (keyed by the same Evolution key.id) do not create
 * duplicate rows nor overwrite the humanized content + sent_by_ai flag.
 *
 * The UNIQUE(message_id, instance_id) constraint exists since
 * 20260127000000_add_whatsapp_messages.sql:37.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEBHOOK_PATH = resolve(
  __dirname,
  "../../supabase/functions/evolution-webhook/index.ts",
);

const source = readFileSync(WEBHOOK_PATH, "utf8");

describe("evolution-webhook whatsapp_messages idempotency contract", () => {
  it("never uses .insert( on whatsapp_messages", () => {
    const matches = source.match(/whatsapp_messages"\)\s*\.insert\(/g) ?? [];
    expect(matches).toEqual([]);
  });

  it("every whatsapp_messages upsert uses onConflict message_id,instance_id", () => {
    const upsertBlocks = source.match(
      /whatsapp_messages"\)\s*\.upsert\([\s\S]*?\}\s*,\s*\{[^}]*\}\s*\)/g,
    ) ?? [];

    expect(upsertBlocks.length).toBeGreaterThan(0);

    for (const block of upsertBlocks) {
      expect(block).toMatch(/onConflict:\s*"message_id,instance_id"/);
    }
  });

  it("echo paths that must not overwrite humanized content use ignoreDuplicates:true", () => {
    // messages.upsert handler + two agent-reply paths. The send.message handler
    // is intentionally excluded: it upserts with ignoreDuplicates:false to
    // refresh media_url (Storage URL) after MESSAGES_UPSERT lands first.
    const conservativeUpserts = [
      // Inbound/outbound echo from Evolution (messages.upsert event)
      /push_name:\s*msg\.pushName,[\s\S]*?onConflict:\s*"message_id,instance_id",\s*ignoreDuplicates:\s*true/,
      // Agent TTS reply (ptt)
      /message_type:\s*"ptt",[\s\S]*?sent_by_ai:\s*true,\s*\}\s*,\s*\{\s*onConflict:\s*"message_id,instance_id",\s*ignoreDuplicates:\s*true/,
      // Agent text reply
      /message_id:\s*`agent_\$\{Date\.now\(\)\}[\s\S]*?sent_by_ai:\s*true,\s*\}\s*,\s*\{\s*onConflict:\s*"message_id,instance_id",\s*ignoreDuplicates:\s*true/,
    ];

    for (const pattern of conservativeUpserts) {
      expect(source).toMatch(pattern);
    }
  });

  it("does not swallow insert errors via string match on 'duplicate'", () => {
    // Dead code after moving to upsert — its presence would suggest the insert
    // was reintroduced somewhere and the swallow is masking a real failure.
    expect(source).not.toMatch(/message\?\.\s*includes\(\s*"duplicate"\s*\)/);
  });
});
