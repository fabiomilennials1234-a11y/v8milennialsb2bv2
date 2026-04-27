/**
 * Tests for dispatcher.ts DB functions: addMessageToMemory + logDecision.
 * Usa mock supabase.
 */

import { describe, it, expect, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";
import {
  addMessageToMemory,
  logDecision,
} from "../../../supabase/functions/_shared/copilot/dispatcher.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const CONV = "11111111-1111-1111-1111-111111111111";

describe("addMessageToMemory", () => {
  it("upsert message com idempotency_key gerado", async () => {
    const { sb, mockTable, getInserted, getUpsertOpts } = createMockSupabase();
    mockTable("conversation_messages", []);

    await addMessageToMemory(sb, CONV, "assistant", "Olá, tudo bem?");

    const inserted = getInserted("conversation_messages");
    expect(inserted.length).toBe(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.conversation_id).toBe(CONV);
    expect(row.role).toBe("assistant");
    expect(row.content).toBe("Olá, tudo bem?");
    expect(row.idempotency_key).toMatch(/^assistant:[a-f0-9]{16}:\d+$/);
  });

  it("upsert opts inclui ignoreDuplicates true", async () => {
    const { sb, mockTable, getUpsertOpts } = createMockSupabase();
    mockTable("conversation_messages", []);

    await addMessageToMemory(sb, CONV, "user", "test");

    const opts = getUpsertOpts("conversation_messages") as Array<{ onConflict?: string; ignoreDuplicates?: boolean }>;
    expect(opts.length).toBe(1);
    expect(opts[0]?.onConflict).toBe("conversation_id,idempotency_key");
    expect(opts[0]?.ignoreDuplicates).toBe(true);
  });

  it("conversation temporária (temp_*) skipa insert", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("conversation_messages", []);

    await addMessageToMemory(sb, "temp_xyz", "assistant", "test");

    expect(getInserted("conversation_messages").length).toBe(0);
  });

  it("idempotency_key consistente pra mesmo content+role+bucket", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("conversation_messages", []);

    await addMessageToMemory(sb, CONV, "user", "mesma msg");
    await addMessageToMemory(sb, CONV, "user", "mesma msg");

    const inserted = getInserted("conversation_messages");
    expect(inserted.length).toBe(2); // mock não dedupa, mas keys idênticas
    expect((inserted[0] as Record<string, unknown>).idempotency_key)
      .toBe((inserted[1] as Record<string, unknown>).idempotency_key);
  });

  it("idempotency_key diferente pra role diferente", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("conversation_messages", []);

    await addMessageToMemory(sb, CONV, "user", "mesma msg");
    await addMessageToMemory(sb, CONV, "assistant", "mesma msg");

    const inserted = getInserted("conversation_messages");
    expect((inserted[0] as Record<string, unknown>).idempotency_key)
      .not.toBe((inserted[1] as Record<string, unknown>).idempotency_key);
  });
});

describe("logDecision", () => {
  it("insert agent_decision_logs com defaults success=true", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("agent_decision_logs", []);

    await logDecision(sb, ORG, CONV, "NEW_LEAD", "QUALIFYING", { action: "qualify_lead" }, { id: "agent-1" });

    const inserted = getInserted("agent_decision_logs");
    expect(inserted.length).toBe(1);
    const row = inserted[0] as Record<string, unknown>;
    expect(row.conversation_id).toBe(CONV);
    expect(row.organization_id).toBe(ORG);
    expect(row.state_before).toBe("NEW_LEAD");
    expect(row.state_after).toBe("QUALIFYING");
    expect(row.action_decided).toBe("qualify_lead");
    expect(row.success).toBe(true);
    expect(row.error_message).toBeNull();
  });

  it("aceita opts.success=false + errorMessage", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("agent_decision_logs", []);

    await logDecision(
      sb,
      ORG,
      CONV,
      "QUALIFYING",
      "QUALIFYING",
      { action: "schedule_meeting" },
      { id: "agent-1" },
      { success: false, errorMessage: "calendar API down" },
    );

    const row = getInserted("agent_decision_logs")[0] as Record<string, unknown>;
    expect(row.success).toBe(false);
    expect(row.error_message).toBe("calendar API down");
  });

  it("action null usa fallback RESPOND_ONLY", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("agent_decision_logs", []);

    await logDecision(sb, ORG, CONV, "NEW_LEAD", "QUALIFYING", null, {});

    const row = getInserted("agent_decision_logs")[0] as Record<string, unknown>;
    expect(row.action_decided).toBe("RESPOND_ONLY");
  });

  it("conversation temp_* skipa insert", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("agent_decision_logs", []);

    await logDecision(sb, ORG, "temp_xyz", "NEW_LEAD", "QUALIFYING", { action: "x" }, {});

    expect(getInserted("agent_decision_logs").length).toBe(0);
  });

  it("capabilities snapshot salvo em capabilities_snapshot", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("agent_decision_logs", []);

    const caps = { id: "agent-1", name: "Test", skills: ["a", "b"] };
    await logDecision(sb, ORG, CONV, "NEW_LEAD", "QUALIFYING", null, caps);

    const row = getInserted("agent_decision_logs")[0] as Record<string, unknown>;
    expect(row.capabilities_snapshot).toEqual(caps);
    expect(row.reasoning).toContain(JSON.stringify(caps));
  });
});
