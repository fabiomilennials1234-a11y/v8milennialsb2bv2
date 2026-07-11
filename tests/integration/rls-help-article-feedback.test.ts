// @vitest-environment node
/**
 * RLS: Feedback do Artigo ("Foi útil?") — help_article_feedback.
 *
 * Invariantes (migration 20270126000000_help_article_feedback.sql):
 *   - Cada um vota no PRÓPRIO nome e só num artigo que consegue ler.
 *   - Um voto por (artigo, usuário), trocável por upsert (unique).
 *   - Cada um só LÊ o próprio voto — o agregado é outra história (RPC, B3).
 *   - Ninguém vota em nome de outro (impersonação negada).
 *   - Artigo de outra org (ou não publicado) não é votável.
 *
 * Prova mais forte foi feita por sonda em transação revertida no prod; este teste
 * é a rede de CI, auto-contido (cria o próprio artigo global publicado).
 *
 * Prerequisites: `supabase start` + `supabase db reset` (seed aplicado).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabase as svc, TEST_ORG_ID, TEST_MEMBER_1_ID } from "./setup";
import { getOrgAMember1, getOrgAMember2, getOrgBMember, clearClients } from "./rls-helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === "true";

describe.skipIf(shouldSkip)("RLS: help_article_feedback", () => {
  let member1: SupabaseClient;
  let categoryId: string;
  let globalArticleId: string;
  let orgAArticleId: string;

  beforeAll(async () => {
    member1 = await getOrgAMember1();

    const { data: cat } = await svc
      .from("help_categories")
      .insert({ name: "[itest] fb", slug: `itest-fb-${Date.now()}`, organization_id: null })
      .select("id")
      .single();
    categoryId = cat!.id;

    const { data: g } = await svc
      .from("help_articles")
      .insert({ category_id: categoryId, organization_id: null, title: "[itest] global", content: "x", is_published: true })
      .select("id")
      .single();
    globalArticleId = g!.id;

    const { data: o } = await svc
      .from("help_articles")
      .insert({ category_id: categoryId, organization_id: TEST_ORG_ID, title: "[itest] orgA", content: "x", is_published: true })
      .select("id")
      .single();
    orgAArticleId = o!.id;
  });

  afterAll(async () => {
    await svc.from("help_article_feedback").delete().eq("article_id", globalArticleId);
    await svc.from("help_article_feedback").delete().eq("article_id", orgAArticleId);
    await svc.from("help_articles").delete().in("id", [globalArticleId, orgAArticleId]);
    await svc.from("help_categories").delete().eq("id", categoryId);
    clearClients();
  });

  it("um membro vota num artigo global e o voto é dele", async () => {
    const { error } = await member1
      .from("help_article_feedback")
      .upsert({ article_id: globalArticleId, user_id: TEST_MEMBER_1_ID, helpful: true }, { onConflict: "article_id,user_id" });
    expect(error).toBeNull();

    const { data } = await member1.from("help_article_feedback").select("helpful,user_id").eq("article_id", globalArticleId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ helpful: true, user_id: TEST_MEMBER_1_ID });
  });

  it("votar de novo troca o voto, não duplica", async () => {
    await member1
      .from("help_article_feedback")
      .upsert({ article_id: globalArticleId, user_id: TEST_MEMBER_1_ID, helpful: false }, { onConflict: "article_id,user_id" });

    const { data } = await svc.from("help_article_feedback").select("helpful").eq("article_id", globalArticleId).eq("user_id", TEST_MEMBER_1_ID);
    expect(data).toHaveLength(1);
    expect(data![0].helpful).toBe(false);
  });

  it("não vota em nome de outro (impersonação negada)", async () => {
    const { error } = await member1
      .from("help_article_feedback")
      .insert({ article_id: globalArticleId, user_id: TEST_ORG_ID /* qualquer id != member1 */, helpful: true });
    expect(error).not.toBeNull();
  });

  it("não vota em artigo de outra org", async () => {
    const memberB = await getOrgBMember();
    const { error } = await memberB
      .from("help_article_feedback")
      .insert({ article_id: orgAArticleId, user_id: (await memberB.auth.getUser()).data.user!.id, helpful: true });
    expect(error).not.toBeNull();
  });

  it("cada um só lê o próprio voto", async () => {
    const member2 = await getOrgAMember2();
    const { data } = await member2.from("help_article_feedback").select("id").eq("article_id", globalArticleId);
    // member1 votou; member2 não deve ver a linha de member1.
    expect(data).toHaveLength(0);
  });
});
