/**
 * Global idempotency contract for whatsapp_messages.
 *
 * Invariant: every write to whatsapp_messages in supabase/functions/** must be
 * an upsert with onConflict="message_id,instance_id". This guarantees that no
 * two edge functions can create a duplicate row for the same Evolution/SZ/etc.
 * message, regardless of event replay, race between outbound-sender and
 * webhook echo, or retry loops.
 *
 * The UNIQUE(message_id, instance_id) constraint exists since
 * 20260127000000_add_whatsapp_messages.sql:37.
 *
 * Tests here scan the source of every edge function. Adding a new write path
 * that uses .insert( on whatsapp_messages will fail this contract.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const FUNCTIONS_DIR = resolve(__dirname, "../../supabase/functions");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const allTsFiles = walk(FUNCTIONS_DIR);

describe("whatsapp_messages global idempotency contract", () => {
  it("no edge function writes whatsapp_messages via .insert(", () => {
    const offenders: string[] = [];
    for (const file of allTsFiles) {
      const source = readFileSync(file, "utf8");
      if (/whatsapp_messages"\)\s*\.insert\(/.test(source)) {
        offenders.push(file.replace(FUNCTIONS_DIR + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every whatsapp_messages upsert specifies onConflict=message_id,instance_id", () => {
    const offenders: Array<{ file: string; excerpt: string }> = [];
    for (const file of allTsFiles) {
      const source = readFileSync(file, "utf8");
      const upsertBlocks = source.match(
        /whatsapp_messages"\)\s*\.upsert\([\s\S]*?\}\s*,\s*\{[^}]*\}\s*\)/g,
      ) ?? [];

      for (const block of upsertBlocks) {
        if (!/onConflict:\s*"message_id,instance_id"/.test(block)) {
          offenders.push({
            file: file.replace(FUNCTIONS_DIR + "/", ""),
            excerpt: block.slice(0, 120),
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("webhook echo paths use ignoreDuplicates:true (preserve first write)", () => {
    // Webhooks receive echoes of messages the dispatcher/sender already wrote.
    // The first row is the source of truth — do not overwrite.
    //
    // Exception: legacy send.message handler may write Storage-backed
    // media_url and must refresh it over a null/CDN URL. That block is anchored
    // by the "SEND_MESSAGE_MEDIA_REFRESH" marker in the 8 lines above.
    // `join()` devolve `\` no Windows e `/` no Linux. Ancorar a regex em `/`
    // fazia o filtro achar ZERO arquivos na máquina do dev — e um teste que só
    // passa no runner é um teste que ninguém roda antes de subir.
    const webhookFiles = allTsFiles.filter((f) =>
      /(whatsapp-webhook|sz-chat-webhook)[\\/]index\.ts$/.test(f),
    );
    expect(webhookFiles.length).toBeGreaterThan(0);

    const upsertRe = /whatsapp_messages"\)\s*\.upsert\([\s\S]*?\}\s*,\s*(\{[^}]*\})\s*\)/g;

    for (const file of webhookFiles) {
      const source = readFileSync(file, "utf8");

      for (const match of source.matchAll(upsertRe)) {
        const fullMatch = match[0];
        const optsText = match[1];
        const startIdx = match.index ?? 0;
        const contextBefore = source.slice(Math.max(0, startIdx - 400), startIdx);

        if (/SEND_MESSAGE_MEDIA_REFRESH/.test(contextBefore)) continue;

        expect(
          optsText,
          `${file.replace(FUNCTIONS_DIR + "/", "")} webhook upsert must use ignoreDuplicates:true`,
        ).toMatch(/ignoreDuplicates:\s*true/);
      }
    }
  });

  it("dispatcher/sender paths use ignoreDuplicates:false (source of truth)", () => {
    // Dispatchers (outbound-sender, action-handler, followup-sender, campaign
    // / pipe rule dispatchers, scheduled messages) are the source of truth
    // for content. If a row already exists for the same message_id, the
    // dispatcher's version should overwrite — hence ignoreDuplicates:false.
    const dispatcherFiles = allTsFiles.filter((f) =>
      /(outbound-sender|workflow-action-handler|followup-sender|ai-action-executor|campaign-rule-dispatch|pipe-rule-dispatch|process-scheduled-user-messages)\.ts$|process-scheduled-user-messages\/index\.ts$/.test(f),
    );
    expect(dispatcherFiles.length).toBeGreaterThan(0);

    for (const file of dispatcherFiles) {
      const source = readFileSync(file, "utf8");
      const upsertBlocks = source.match(
        /whatsapp_messages"\)\s*\.upsert\([\s\S]*?\}\s*,\s*\{[^}]*\}\s*\)/g,
      ) ?? [];

      for (const block of upsertBlocks) {
        expect(
          block,
          `${file.replace(FUNCTIONS_DIR + "/", "")} dispatcher upsert must use ignoreDuplicates:false`,
        ).toMatch(/ignoreDuplicates:\s*false/);
      }
    }
  });

  it("no edge function that writes whatsapp_messages swallows errors via string match on 'duplicate'", () => {
    // Scope: only files that write whatsapp_messages. Other files (e.g. lead-service
    // race-condition handling on leads) legitimately use 'duplicate' string match
    // for a different concern and are out of scope.
    const offenders: string[] = [];
    for (const file of allTsFiles) {
      const source = readFileSync(file, "utf8");
      const writesWhatsappMessages =
        /whatsapp_messages"\)\s*\.(?:insert|upsert)\(/.test(source);
      if (!writesWhatsappMessages) continue;
      if (/\.message\??\.\s*includes\(\s*"duplicate"\s*\)/.test(source)) {
        offenders.push(file.replace(FUNCTIONS_DIR + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
