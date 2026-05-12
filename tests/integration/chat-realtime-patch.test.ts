// @vitest-environment node
/**
 * Chat realtime patch — integration test do PR4.
 *
 * Valida cross-tenant isolation de `whatsapp_messages` (RLS) e o filtro
 * postgres-side usado pelos canais realtime do /chat e do Bubble.
 *
 * Requer:
 *   1. `supabase start` rodando
 *   2. Seed aplicado (`supabase db reset`)
 *
 * Skip quando SKIP_INTEGRATION === 'true' e SUPABASE_URL não estiver setada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createServiceClient,
  getOrgAAdmin,
  getOrgBAdmin,
  clearClients,
} from "./rls-helpers";
import { TEST_ORG_ID, TEST_ORG_B_ID } from "./setup";
import type { SupabaseClient } from "@supabase/supabase-js";

// Default skip — só roda quando CTO explicitamente pede via RUN_BUBBLE_INTEGRATION=true
// e Supabase local + seed.sql aplicado (admin@test.com / adminb@test.com existem).
// Razão: integration tests dependem de fixture que pode não estar disponível em todo dev box.
const shouldSkip = process.env.RUN_BUBBLE_INTEGRATION !== "true";

const ORG_A_INSTANCE = "00000000-0000-0000-0000-00000000c001";
const ORG_B_INSTANCE = "00000000-0000-0000-0000-00000000c002";
const PHONE_X = "5511900001111";
const PHONE_Y = "5511900002222";

describe.skipIf(shouldSkip)("Chat realtime — cross-tenant isolation", () => {
  let admin: SupabaseClient;
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;
  let createdInstances = false;
  let createdMsgs: Array<{ id: string }> = [];

  beforeAll(async () => {
    admin = createServiceClient();
    [adminA, adminB] = await Promise.all([getOrgAAdmin(), getOrgBAdmin()]);

    // Cria 2 instâncias whatsapp se não existirem (idempotente)
    const { error: instErr } = await admin.from("whatsapp_instances").upsert(
      [
        {
          id: ORG_A_INSTANCE,
          organization_id: TEST_ORG_ID,
          instance_name: "test-bubble-A",
          status: "connected",
        },
        {
          id: ORG_B_INSTANCE,
          organization_id: TEST_ORG_B_ID,
          instance_name: "test-bubble-B",
          status: "connected",
        },
      ],
      { onConflict: "id" },
    );
    if (!instErr) createdInstances = true;

    // Insere 2 msgs (1 por org) — service_role bypassa RLS
    const { data: inserted, error: msgErr } = await admin
      .from("whatsapp_messages")
      .insert([
        {
          organization_id: TEST_ORG_ID,
          instance_id: ORG_A_INSTANCE,
          message_id: `pr4-test-A-${Date.now()}`,
          remote_jid: `${PHONE_X}@s.whatsapp.net`,
          phone_number: PHONE_X,
          direction: "incoming",
          message_type: "text",
          content: "msg from org A",
          status: "received",
          timestamp: new Date().toISOString(),
        },
        {
          organization_id: TEST_ORG_B_ID,
          instance_id: ORG_B_INSTANCE,
          message_id: `pr4-test-B-${Date.now()}`,
          remote_jid: `${PHONE_Y}@s.whatsapp.net`,
          phone_number: PHONE_Y,
          direction: "incoming",
          message_type: "text",
          content: "msg from org B",
          status: "received",
          timestamp: new Date().toISOString(),
        },
      ])
      .select("id");
    if (msgErr) throw msgErr;
    createdMsgs = inserted ?? [];
  });

  afterAll(async () => {
    if (createdMsgs.length > 0) {
      await admin
        .from("whatsapp_messages")
        .delete()
        .in("id", createdMsgs.map((m) => m.id));
    }
    if (createdInstances) {
      await admin
        .from("whatsapp_instances")
        .delete()
        .in("id", [ORG_A_INSTANCE, ORG_B_INSTANCE]);
    }
    await clearClients();
  });

  it("Org A admin vê apenas msgs da própria org (RLS bloqueia org B)", async () => {
    const { data, error } = await adminA
      .from("whatsapp_messages")
      .select("organization_id, content, instance_id")
      .in("organization_id", [TEST_ORG_ID, TEST_ORG_B_ID]);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    for (const row of data!) {
      expect(row.organization_id).toBe(TEST_ORG_ID);
    }
  });

  it("Org B admin vê apenas msgs da própria org (RLS bloqueia org A)", async () => {
    const { data, error } = await adminB
      .from("whatsapp_messages")
      .select("organization_id, content")
      .in("organization_id", [TEST_ORG_ID, TEST_ORG_B_ID]);

    expect(error).toBeNull();
    for (const row of data!) {
      expect(row.organization_id).toBe(TEST_ORG_B_ID);
    }
  });

  it("Org A admin não consegue SELECT explícito de msg de org B (mesmo passando msg_id)", async () => {
    const orgBMsg = createdMsgs.find((_, idx) => idx === 1);
    if (!orgBMsg) return; // sem fixture
    const { data } = await adminA
      .from("whatsapp_messages")
      .select("id")
      .eq("id", orgBMsg.id)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("filtro instance_id respeita org boundary — admin A com instance de B → vazio", async () => {
    const { data } = await adminA
      .from("whatsapp_messages")
      .select("id")
      .eq("instance_id", ORG_B_INSTANCE);
    expect(data).toEqual([]);
  });

  it("admin A não consegue INSERT em org B (RLS rejeita)", async () => {
    const { error } = await adminA.from("whatsapp_messages").insert({
      organization_id: TEST_ORG_B_ID,
      instance_id: ORG_B_INSTANCE,
      message_id: `pr4-evil-${Date.now()}`,
      remote_jid: `5511000000000@s.whatsapp.net`,
      phone_number: "5511000000000",
      direction: "outgoing",
      message_type: "text",
      content: "evil",
      status: "sent",
      timestamp: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
