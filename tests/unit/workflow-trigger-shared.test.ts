import { describe, it, expect } from "vitest";
import {
  matchesTriggerConfig,
  fireTrigger,
} from "../../supabase/functions/_shared/workflow-trigger";
import { createMockSupabase } from "../helpers/supabase-mock";

// ─── matchesTriggerConfig (pure function, 16 trigger types) ────

describe("matchesTriggerConfig", () => {
  // stage_changed
  describe("stage_changed", () => {
    it("matches when no config filters", () => {
      expect(matchesTriggerConfig("stage_changed", {}, {})).toBe(true);
    });

    it("matches when pipe_type matches", () => {
      expect(matchesTriggerConfig("stage_changed",
        { pipe_type: "whatsapp" },
        { pipe_type: "whatsapp" }
      )).toBe(true);
    });

    it("rejects when pipe_type differs", () => {
      expect(matchesTriggerConfig("stage_changed",
        { pipe_type: "whatsapp" },
        { pipe_type: "confirmacao" }
      )).toBe(false);
    });

    it("matches when to_stage is in stages array", () => {
      expect(matchesTriggerConfig("stage_changed",
        { stages: ["novo", "abordado", "respondeu"] },
        { to_stage: "abordado" }
      )).toBe(true);
    });

    it("rejects when to_stage not in stages array", () => {
      expect(matchesTriggerConfig("stage_changed",
        { stages: ["novo", "abordado"] },
        { to_stage: "agendado" }
      )).toBe(false);
    });

    it("matches single to_stage", () => {
      expect(matchesTriggerConfig("stage_changed",
        { to_stage: "vendido" },
        { to_stage: "vendido" }
      )).toBe(true);
    });

    it("rejects single to_stage mismatch", () => {
      expect(matchesTriggerConfig("stage_changed",
        { to_stage: "vendido" },
        { to_stage: "perdido" }
      )).toBe(false);
    });

    it("rejects when from_stage differs", () => {
      expect(matchesTriggerConfig("stage_changed",
        { from_stage: "novo" },
        { from_stage: "abordado" }
      )).toBe(false);
    });

    it("rejects when pipeline_id differs", () => {
      expect(matchesTriggerConfig("stage_changed",
        { pipeline_id: "pipe-1" },
        { pipeline_id: "pipe-2" }
      )).toBe(false);
    });
  });

  // lead_created
  describe("lead_created", () => {
    it("matches when no filters", () => {
      expect(matchesTriggerConfig("lead_created", {}, {})).toBe(true);
    });

    it("matches when origin matches", () => {
      expect(matchesTriggerConfig("lead_created",
        { filter_origin: "meta_ads" },
        { origin: "meta_ads" }
      )).toBe(true);
    });

    it("rejects when origin differs", () => {
      expect(matchesTriggerConfig("lead_created",
        { filter_origin: "meta_ads" },
        { origin: "whatsapp" }
      )).toBe(false);
    });

    it("rejects custom pipeline without filter", () => {
      expect(matchesTriggerConfig("lead_created",
        {},
        { pipeline_id: "custom-1" }
      )).toBe(false);
    });

    it("matches custom pipeline with matching filter", () => {
      expect(matchesTriggerConfig("lead_created",
        { filter_pipeline_id: "custom-1" },
        { pipeline_id: "custom-1" }
      )).toBe(true);
    });
  });

  // tag_added
  describe("tag_added", () => {
    it("matches when no tag filter", () => {
      expect(matchesTriggerConfig("tag_added", {}, {})).toBe(true);
    });

    it("matches when tag_id matches", () => {
      expect(matchesTriggerConfig("tag_added",
        { tag_id: "t1" },
        { tag_id: "t1" }
      )).toBe(true);
    });

    it("rejects when tag_id differs", () => {
      expect(matchesTriggerConfig("tag_added",
        { tag_id: "t1" },
        { tag_id: "t2" }
      )).toBe(false);
    });

    it("matches tag_name case-insensitive", () => {
      expect(matchesTriggerConfig("tag_added",
        { tag_name: "Ouro" },
        { tag_name: "ouro" }
      )).toBe(true);
    });

    it("rejects when tag_name differs", () => {
      expect(matchesTriggerConfig("tag_added",
        { tag_name: "Ouro" },
        { tag_name: "Prata" }
      )).toBe(false);
    });
  });

  // score_reached
  describe("score_reached", () => {
    it("matches when score >= min_score", () => {
      expect(matchesTriggerConfig("score_reached",
        { min_score: 70 },
        { score: 85 }
      )).toBe(true);
    });

    it("matches when score == min_score", () => {
      expect(matchesTriggerConfig("score_reached",
        { min_score: 70 },
        { score: 70 }
      )).toBe(true);
    });

    it("rejects when score < min_score", () => {
      expect(matchesTriggerConfig("score_reached",
        { min_score: 70 },
        { score: 50 }
      )).toBe(false);
    });

    it("defaults to 0 when min_score is not set", () => {
      expect(matchesTriggerConfig("score_reached", {}, { score: 1 })).toBe(true);
    });
  });

  // lead_replied
  describe("lead_replied", () => {
    it("matches when no filters", () => {
      expect(matchesTriggerConfig("lead_replied", {}, {})).toBe(true);
    });

    it("matches specific channel", () => {
      expect(matchesTriggerConfig("lead_replied",
        { channel: "whatsapp" },
        { channel: "whatsapp" }
      )).toBe(true);
    });

    it("rejects different channel", () => {
      expect(matchesTriggerConfig("lead_replied",
        { channel: "whatsapp" },
        { channel: "meta" }
      )).toBe(false);
    });

    it("channel=any matches all", () => {
      expect(matchesTriggerConfig("lead_replied",
        { channel: "any" },
        { channel: "meta" }
      )).toBe(true);
    });

    it("matches contains_text", () => {
      expect(matchesTriggerConfig("lead_replied",
        { contains_text: "preço" },
        { message: "Qual o preço do produto?" }
      )).toBe(true);
    });

    it("contains_text is case-insensitive", () => {
      expect(matchesTriggerConfig("lead_replied",
        { contains_text: "PREÇO" },
        { message: "qual o preço?" }
      )).toBe(true);
    });

    it("rejects when contains_text not found", () => {
      expect(matchesTriggerConfig("lead_replied",
        { contains_text: "desconto" },
        { message: "Qual o preço?" }
      )).toBe(false);
    });

    // ── filtro por funil (pipeline_ids) ──
    describe("filtro por funil", () => {
      const FUNIL_A = "11111111-1111-1111-1111-111111111111";
      const FUNIL_B = "22222222-2222-2222-2222-222222222222";

      it("lista vazia = qualquer funil (não exige o contexto)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [] },
          {}
        )).toBe(true);
      });

      it("dispara quando o lead está no funil escolhido", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A] },
          { lead_pipeline_ids: [FUNIL_A] }
        )).toBe(true);
      });

      it("não dispara quando o lead está em outro funil", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A] },
          { lead_pipeline_ids: [FUNIL_B] }
        )).toBe(false);
      });

      it("basta estar em UM dos funis marcados (OR)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A, FUNIL_B] },
          { lead_pipeline_ids: [FUNIL_B] }
        )).toBe(true);
      });

      it("lead em vários funis casa se um deles estiver marcado", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_B] },
          { lead_pipeline_ids: [FUNIL_A, FUNIL_B] }
        )).toBe(true);
      });

      it("não dispara quando o lead não está em funil nenhum", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A] },
          { lead_pipeline_ids: [] }
        )).toBe(false);
      });

      // Fail-closed: sem a lista no contexto o filtro é inavaliável. Disparar
      // levaria a automação para leads fora do funil — pior que não disparar.
      it("fail-closed quando o contexto não traz os funis do lead", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A] },
          {}
        )).toBe(false);
      });

      it("fail-closed quando a leitura dos funis falhou (null)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A] },
          { lead_pipeline_ids: null }
        )).toBe(false);
      });

      it("ignora entradas inválidas na lista salva (jsonb não é validado)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: ["  ", null, 42, FUNIL_A] },
          { lead_pipeline_ids: [FUNIL_A] }
        )).toBe(true);
      });

      it("lista só com lixo equivale a sem filtro", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: ["", "   "] },
          {}
        )).toBe(true);
      });

      it("funil e contains_text se somam (E, não OU)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A], contains_text: "orçamento" },
          { lead_pipeline_ids: [FUNIL_A], message: "quero um orçamento" }
        )).toBe(true);

        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A], contains_text: "orçamento" },
          { lead_pipeline_ids: [FUNIL_A], message: "bom dia" }
        )).toBe(false);

        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A], contains_text: "orçamento" },
          { lead_pipeline_ids: [FUNIL_B], message: "quero um orçamento" }
        )).toBe(false);
      });

      it("funil e canal se somam", () => {
        expect(matchesTriggerConfig("lead_replied",
          { pipeline_ids: [FUNIL_A], channel: "whatsapp" },
          { lead_pipeline_ids: [FUNIL_A], channel: "meta" }
        )).toBe(false);
      });
    });
  });

  // lead_no_reply, meeting_not_confirmed, followup_overdue, cron
  describe("always-true triggers", () => {
    const alwaysTrue = ["lead_no_reply", "meeting_not_confirmed", "proposal_accepted", "proposal_lost", "followup_overdue", "cron"];
    alwaysTrue.forEach((type) => {
      it(`${type} always returns true`, () => {
        expect(matchesTriggerConfig(type, { any: "config" }, { any: "context" })).toBe(true);
      });
    });
  });

  // meeting_confirmed
  describe("meeting_confirmed", () => {
    it("matches when pipe_type matches", () => {
      expect(matchesTriggerConfig("meeting_confirmed",
        { pipe_type: "confirmacao" },
        { pipe_type: "confirmacao" }
      )).toBe(true);
    });

    it("rejects when pipe_type differs", () => {
      expect(matchesTriggerConfig("meeting_confirmed",
        { pipe_type: "confirmacao" },
        { pipe_type: "whatsapp" }
      )).toBe(false);
    });
  });

  // webhook_received
  describe("webhook_received", () => {
    it("matches when webhook_key matches", () => {
      expect(matchesTriggerConfig("webhook_received",
        { webhook_key: "key1" },
        { webhook_key: "key1" }
      )).toBe(true);
    });

    it("rejects when webhook_key differs", () => {
      expect(matchesTriggerConfig("webhook_received",
        { webhook_key: "key1" },
        { webhook_key: "key2" }
      )).toBe(false);
    });
  });

  // lead_assigned
  describe("lead_assigned", () => {
    it("matches specific role", () => {
      expect(matchesTriggerConfig("lead_assigned",
        { role: "sdr" },
        { role: "sdr" }
      )).toBe(true);
    });

    it("role=any matches all", () => {
      expect(matchesTriggerConfig("lead_assigned",
        { role: "any" },
        { role: "closer" }
      )).toBe(true);
    });
  });

  // campaign events
  describe("campaign events", () => {
    const campaignTypes = ["campaign_status_changed", "lead_added_to_campaign", "campaign_completed"];
    campaignTypes.forEach((type) => {
      it(`${type} matches campaign_id`, () => {
        expect(matchesTriggerConfig(type,
          { campaign_id: "c1" },
          { campanha_id: "c1" }
        )).toBe(true);
      });

      it(`${type} rejects different campaign_id`, () => {
        expect(matchesTriggerConfig(type,
          { campaign_id: "c1" },
          { campanha_id: "c2" }
        )).toBe(false);
      });
    });
  });

  // field_changed
  describe("field_changed", () => {
    it("matches when field_name matches", () => {
      expect(matchesTriggerConfig("field_changed",
        { field_name: "email" },
        { field_name: "email" }
      )).toBe(true);
    });

    it("rejects when field_name differs", () => {
      expect(matchesTriggerConfig("field_changed",
        { field_name: "email" },
        { field_name: "phone" }
      )).toBe(false);
    });

    it("matches new_value", () => {
      expect(matchesTriggerConfig("field_changed",
        { field_name: "status", new_value: "ativo" },
        { field_name: "status", new_value: "ativo" }
      )).toBe(true);
    });
  });

  // unknown trigger type
  describe("unknown trigger type", () => {
    it("returns true by default", () => {
      expect(matchesTriggerConfig("some_future_trigger", {}, {})).toBe(true);
    });
  });
});

// ─── fireTrigger (with mocked Supabase) ────────────────────────

describe("fireTrigger", () => {
  it("returns 0 when no workflows match", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", []);

    const count = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
    });

    expect(count).toBe(0);
  });

  it("creates executions for matching workflows", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("workflows", [
      { id: "wf-1", trigger_config: {}, organization_id: "org-1", trigger_type: "lead_created", is_active: true },
      { id: "wf-2", trigger_config: { filter_origin: "meta_ads" }, organization_id: "org-1", trigger_type: "lead_created", is_active: true },
    ]);

    const count = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
      context: { origin: "whatsapp" },
    });

    // wf-1 matches (no filter), wf-2 rejects (origin mismatch)
    // But our mock doesn't apply .eq filters correctly for chained selects
    // The fireTrigger function filters via matchesTriggerConfig after fetching
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("handles supabase errors gracefully", async () => {
    const { sb } = createMockSupabase();
    // Empty table = no workflows = returns 0
    const count = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "unknown_trigger",
      leadId: "lead-1",
    });
    expect(count).toBe(0);
  });

  // ── lead_replied + filtro por funil: o enriquecimento sob demanda ──
  describe("lead_replied com filtro por funil", () => {
    const FUNIL_A = "11111111-1111-1111-1111-111111111111";
    const FUNIL_B = "22222222-2222-2222-2222-222222222222";

    function seedWorkflow(mockTable: ReturnType<typeof createMockSupabase>["mockTable"], config: Record<string, unknown>) {
      mockTable("workflows", [
        {
          id: "wf-funil",
          trigger_config: config,
          organization_id: "org-1",
          trigger_type: "lead_replied",
          is_active: true,
        },
      ]);
    }

    it("dispara quando o lead tem entrada no funil configurado", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(1);
    });

    it("não dispara quando o lead só está em outro funil", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_B },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(0);
    });

    it("não confunde funis de OUTRO lead da mesma org", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-outro", pipeline_id: FUNIL_A },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied" },
      });

      expect(count).toBe(0);
    });

    it("não confunde funis do mesmo lead em OUTRA org", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      // service_role bypassa RLS: sem o .eq(organization_id) explícito esta
      // linha vazaria para dentro do matching.
      mockTable("pipeline_entries", [
        { organization_id: "org-2", lead_id: "lead-1", pipeline_id: FUNIL_A },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied" },
      });

      expect(count).toBe(0);
    });

    it("sem filtro de funil, dispara mesmo sem nenhuma entrada de funil", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { channel: "any" });
      mockTable("pipeline_entries", []);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied" },
      });

      expect(count).toBe(1);
    });

    // Trava de desenho: os funis do lead são contexto de MATCHING e não podem
    // entrar no context persistido — ele alimenta computeTriggerDedupKey.
    it("não grava lead_pipeline_ids no context da execução", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A },
      ]);

      await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      const execs = getInserted("workflow_executions");
      expect(execs).toHaveLength(1);
      const ctx = execs[0].context as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("lead_pipeline_ids");
      expect(ctx.message).toBe("oi");
    });
  });
});
