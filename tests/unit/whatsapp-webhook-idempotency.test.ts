/**
 * Contract tests for whatsapp-webhook idempotency invariants.
 * Preserves contract from commit 3066b5e for the Uazapi provider.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEBHOOK_PATH = resolve(
  __dirname,
  "../../supabase/functions/whatsapp-webhook/index.ts"
);

const source = readFileSync(WEBHOOK_PATH, "utf8");

describe("whatsapp-webhook whatsapp_messages idempotency contract", () => {
  it("never uses .insert( on whatsapp_messages", () => {
    const matches = source.match(/whatsapp_messages"\)\s*\.insert\(/g) ?? [];
    expect(matches).toEqual([]);
  });

  it("every whatsapp_messages upsert uses onConflict message_id,instance_id", () => {
    const upsertBlocks =
      source.match(
        /whatsapp_messages"\)\s*\.upsert\([\s\S]*?,\s*\{[\s\S]*?\}\s*\)/g
      ) ?? [];
    expect(upsertBlocks.length).toBeGreaterThan(0);
    for (const block of upsertBlocks) {
      expect(block).toMatch(/onConflict:\s*"message_id,instance_id"/);
    }
  });

  it("echo path uses ignoreDuplicates:true (defense in depth)", () => {
    const block = source.match(
      /whatsapp_messages"\)\s*\.upsert\([\s\S]*?onConflict:\s*"message_id,instance_id",\s*ignoreDuplicates:\s*true/
    );
    expect(block).toBeTruthy();
  });
});
