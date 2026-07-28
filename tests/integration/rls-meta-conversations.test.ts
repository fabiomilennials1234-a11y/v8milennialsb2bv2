// @vitest-environment node
/**
 * RLS: inbox Meta — meta_conversations.
 *
 * Invariantes (migration 20270728000000_meta_conversations.sql):
 *   - Isolamento por org: org A lê/escreve só o que é de org A.
 *   - Insert carimbando organization_id de outra org é negado.
 *   - Master atravessa orgs (master ghost).
 *   - link_meta_conversation_to_lead recusa lead de OUTRA org, mesmo quando a
 *     conversa é da minha — furo que a RLS sozinha não pega, porque a linha
 *     alvo do UPDATE é legitimamente minha.
 *   - mark_meta_conversation_read não alcança conversa de outra org.
 *   - Uma conversa por (meta_page_id, external_user_id) — alvo do upsert
 *     idempotente do webhook.
 *
 * A tabela é assinada via Realtime (useMetaRealtime), então as policies usam
 * get_my_organization_ids()/is_master_user() e NUNCA subquery inline em
 * team_members — inline causa recursão quando apply_rls() roda no Realtime.
 *
 * Prerequisites: `supabase start` + `supabase db reset` (seed aplicado).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  supabase as svc,
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_LEAD_ALPHA_ID,
  TEST_MEMBER_1_ID,
  TEST_MEMBER_B_ID,
} from "./setup";
import {
  getOrgAMember1,
  getOrgBMember,
  getMaster,
  clearClients,
} from "./rls-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === "true";

describe.skipIf(shouldSkip)("RLS: meta_conversations", () => {
  let memberA: SupabaseClient;
  let memberB: SupabaseClient;

  let connectionAId: string;
  let connectionBId: string;
  let pageAId: string;
  let pageBId: string;
  let convAId: string;
  let convBId: string;
  let leadBId: string;

  const stamp = Date.now();

  beforeAll(async () => {
    memberA = await getOrgAMember1();
    memberB = await getOrgBMember();

    // meta_pages exige meta_connection_id; criamos uma conexão por org.
    // user_id / facebook_user_id / token_expires_at são NOT NULL em meta_connections.
    const mkConnection = async (orgId: string, userId: string, suffix: string) => {
      const { data, error } = await svc
        .from("meta_connections")
        .insert({
          organization_id: orgId,
          user_id: userId,
          facebook_user_id: `itest-fb-${suffix}-${stamp}`,
          access_token: "itest-token",
          token_expires_at: new Date(Date.now() + 60 * 86400_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data!.id as string;
    };

    const mkPage = async (orgId: string, connId: string, suffix: string) => {
      const { data, error } = await svc
        .from("meta_pages")
        .insert({
          organization_id: orgId,
          meta_connection_id: connId,
          page_id: `itest-page-${suffix}-${stamp}`,
          page_name: `[itest] page ${suffix}`,
          page_access_token: "itest-page-token",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data!.id as string;
    };

    connectionAId = await mkConnection(TEST_ORG_ID, TEST_MEMBER_1_ID, "a");
    connectionBId = await mkConnection(TEST_ORG_B_ID, TEST_MEMBER_B_ID, "b");
    pageAId = await mkPage(TEST_ORG_ID, connectionAId, "a");
    pageBId = await mkPage(TEST_ORG_B_ID, connectionBId, "b");

    const mkConv = async (orgId: string, pageId: string, suffix: string) => {
      const { data, error } = await svc
        .from("meta_conversations")
        .insert({
          organization_id: orgId,
          meta_page_id: pageId,
          channel: "messenger",
          external_user_id: `itest-psid-${suffix}-${stamp}`,
          unread_count: 3,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data!.id as string;
    };

    convAId = await mkConv(TEST_ORG_ID, pageAId, "a");
    convBId = await mkConv(TEST_ORG_B_ID, pageBId, "b");

    // Lead pertencente à org B — alvo do teste de vínculo cross-tenant.
    const { data: lb, error: lbErr } = await svc
      .from("leads")
      .insert({ organization_id: TEST_ORG_B_ID, name: "[itest] lead orgB" })
      .select("id")
      .single();
    if (lbErr) throw lbErr;
    leadBId = lb!.id;
  });

  afterAll(async () => {
    await svc.from("meta_conversations").delete().in("id", [convAId, convBId]);
    await svc.from("leads").delete().eq("id", leadBId);
    await svc.from("meta_pages").delete().in("id", [pageAId, pageBId]);
    await svc.from("meta_connections").delete().in("id", [connectionAId, connectionBId]);
    clearClients();
  });

  it("membro da org A lê a conversa da org A", async () => {
    const { data, error } = await memberA
      .from("meta_conversations")
      .select("id")
      .eq("id", convAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("membro da org A não enxerga conversa da org B", async () => {
    const { data } = await memberA
      .from("meta_conversations")
      .select("id")
      .eq("id", convBId);
    expect(data).toHaveLength(0);
  });

  it("insert carimbando organization_id de outra org é negado", async () => {
    const { error } = await memberA.from("meta_conversations").insert({
      organization_id: TEST_ORG_B_ID,
      meta_page_id: pageBId,
      channel: "messenger",
      external_user_id: `itest-psid-forjado-${stamp}`,
    });
    expect(error).not.toBeNull();
  });

  it("master atravessa org", async () => {
    const master = await getMaster();
    const { data } = await master
      .from("meta_conversations")
      .select("id")
      .in("id", [convAId, convBId]);
    expect(data?.length).toBe(2);
  });

  it("(meta_page_id, external_user_id) é único — upsert do webhook é idempotente", async () => {
    const { data: existing } = await svc
      .from("meta_conversations")
      .select("external_user_id")
      .eq("id", convAId)
      .single();

    const { error } = await svc.from("meta_conversations").insert({
      organization_id: TEST_ORG_ID,
      meta_page_id: pageAId,
      channel: "messenger",
      external_user_id: existing!.external_user_id,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("mark_meta_conversation_read zera a própria org", async () => {
    const { error } = await memberA.rpc("mark_meta_conversation_read", {
      p_conversation_id: convAId,
    });
    expect(error).toBeNull();

    const { data } = await svc
      .from("meta_conversations")
      .select("unread_count")
      .eq("id", convAId)
      .single();
    expect(data!.unread_count).toBe(0);
  });

  it("mark_meta_conversation_read não alcança conversa de outra org", async () => {
    await memberA.rpc("mark_meta_conversation_read", { p_conversation_id: convBId });

    const { data } = await svc
      .from("meta_conversations")
      .select("unread_count")
      .eq("id", convBId)
      .single();
    // A RLS filtrou o UPDATE: a linha da org B continua intacta.
    expect(data!.unread_count).toBe(3);
  });

  it("link_meta_conversation_to_lead recusa lead de outra org na minha conversa", async () => {
    const { error } = await memberA.rpc("link_meta_conversation_to_lead", {
      p_conversation_id: convAId,
      p_lead_id: leadBId,
    });
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("meta_conversations")
      .select("lead_id")
      .eq("id", convAId)
      .single();
    expect(data!.lead_id).toBeNull();
  });

  it("link_meta_conversation_to_lead vincula lead da própria org", async () => {
    const { error } = await memberA.rpc("link_meta_conversation_to_lead", {
      p_conversation_id: convAId,
      p_lead_id: TEST_LEAD_ALPHA_ID,
    });
    expect(error).toBeNull();

    const { data } = await svc
      .from("meta_conversations")
      .select("lead_id")
      .eq("id", convAId)
      .single();
    expect(data!.lead_id).toBe(TEST_LEAD_ALPHA_ID);
  });

  it("membro da org B não vincula lead na conversa da org A", async () => {
    const { error } = await memberB.rpc("link_meta_conversation_to_lead", {
      p_conversation_id: convAId,
      p_lead_id: leadBId,
    });
    expect(error).not.toBeNull();
  });
});
