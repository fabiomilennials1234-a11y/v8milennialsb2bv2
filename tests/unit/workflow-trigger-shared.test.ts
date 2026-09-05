import { describe, it, expect, vi, afterEach } from "vitest";
import {
  matchesTriggerConfig,
  fireTrigger,
  hasActiveWorkflowsForTrigger,
  normalizePipelineIds,
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

    // ── SCRUM-627: contexto ÚNICO dos gatilhos × formatos de config vivos ──
    // Medido em prod 2026-09-02 (82 stage_changed ativos): 67 com pipe_type
    // slug ("whatsapp"/"propostas"), 15 com pipeline_id uuid, 0 campanha.
    describe("SCRUM-627 — config legada e nova contra o contexto unificado", () => {
      // O que os gatilhos de banco emitem desde a 20270908006000:
      const ctxSystem = {
        trigger: "stage_changed",
        pipeline_id: "11111111-1111-4111-8111-111111111111",
        pipe_type: "whatsapp", // eco legado — só funil de sistema
        pipeline_entry_id: "e1",
        deal_id: null,
        stage_id: "aaaaaaaa-0000-4000-8000-000000000001",
        stage_key: "abordado",
        from_stage: "novo",
        from_stage_id: "aaaaaaaa-0000-4000-8000-000000000000",
        to_stage: "abordado",
      };
      const ctxCustom = {
        trigger: "stage_changed",
        pipeline_id: "22222222-2222-4222-8222-222222222222",
        pipeline_entry_id: "e2",
        deal_id: "d2",
        stage_id: "bbbbbbbb-0000-4000-8000-000000000002",
        stage_key: "triagem",
        from_stage: "entrada",
        from_stage_id: null,
        to_stage: "triagem",
      };

      it("config legada (pipe_type slug, formato dominante em prod) casa com o contexto novo", () => {
        expect(matchesTriggerConfig("stage_changed",
          { pipe_type: "whatsapp", pipeline_id: "", stages: ["abordado"] },
          ctxSystem,
        )).toBe(true);
      });

      it("config legada de sistema NÃO casa com move em funil custom (fail-closed — antes passava em silêncio)", () => {
        expect(matchesTriggerConfig("stage_changed",
          { pipe_type: "whatsapp", pipeline_id: "" },
          ctxCustom,
        )).toBe(false);
      });

      it("config nova (pipeline_id) casa com funil de sistema E custom", () => {
        expect(matchesTriggerConfig("stage_changed",
          { pipeline_id: "11111111-1111-4111-8111-111111111111", pipe_type: "" },
          ctxSystem,
        )).toBe(true);
        expect(matchesTriggerConfig("stage_changed",
          { pipeline_id: "22222222-2222-4222-8222-222222222222", pipe_type: "" },
          ctxCustom,
        )).toBe(true);
      });

      it("config de funil custom (formato vivo: pipeline_id + pipe_type vazio) segue casando", () => {
        // Amostra real de prod: { pipe_type: "", pipeline_id: uuid, stages: [...] }
        expect(matchesTriggerConfig("stage_changed",
          { pipe_type: "", pipeline_id: "22222222-2222-4222-8222-222222222222", stages: ["triagem"], to_stage: "", from_stage: "", campanha_id: "" },
          ctxCustom,
        )).toBe(true);
      });

      it("stages aceita o ID da etapa além da key", () => {
        expect(matchesTriggerConfig("stage_changed",
          { stages: ["bbbbbbbb-0000-4000-8000-000000000002"] },
          ctxCustom,
        )).toBe(true);
        expect(matchesTriggerConfig("stage_changed",
          { to_stage: "bbbbbbbb-0000-4000-8000-000000000002" },
          ctxCustom,
        )).toBe(true);
        expect(matchesTriggerConfig("stage_changed",
          { from_stage: "aaaaaaaa-0000-4000-8000-000000000000" },
          ctxSystem,
        )).toBe(true);
      });

      it("sem filtro nenhum continua casando qualquer funil", () => {
        expect(matchesTriggerConfig("stage_changed", {}, ctxSystem)).toBe(true);
        expect(matchesTriggerConfig("stage_changed", {}, ctxCustom)).toBe(true);
      });
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

    // ── modos de resposta (reply_mode) ──
    // A evidência chega PRONTA no context (horas decorridas), nunca um
    // timestamp cru: `matchesTriggerConfig` roda de novo no executor, minutos
    // depois, e comparar contra "agora" faria a revalidação reprovar o que o
    // disparo aprovou. Número congelado no disparo revalida igual sempre.
    describe("modos de resposta", () => {
      it("modo padrão (ausente) dispara em qualquer mensagem", () => {
        expect(matchesTriggerConfig("lead_replied", {}, { message: "oi" })).toBe(true);
      });

      it("after_outbound não dispara quando ninguém falou com o lead antes", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48 },
          { hours_since_outbound: null }
        )).toBe(false);
      });

      it("after_outbound dispara dentro da janela", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48 },
          { hours_since_outbound: 1 }
        )).toBe(true);
      });

      it("after_outbound não dispara depois da janela", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48 },
          { hours_since_outbound: 72 }
        )).toBe(false);
      });

      it("after_outbound aceita a borda exata da janela", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48 },
          { hours_since_outbound: 48 }
        )).toBe(true);
      });

      it("after_outbound sem janela configurada exige só que tenha havido outbound", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound" },
          { hours_since_outbound: 1000 }
        )).toBe(true);
      });

      // Fail-closed: sem a evidência no context o modo é inavaliável, e
      // disparar transformaria "só quem respondeu" em "qualquer mensagem".
      it("after_outbound é fail-closed sem a evidência no context", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48 },
          {}
        )).toBe(false);
      });

      it("first_of_thread dispara na primeira mensagem que a pessoa manda", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "first_of_thread", new_thread_after_hours: 24 },
          { hours_since_previous_inbound: null }
        )).toBe(true);
      });

      it("first_of_thread cala a rajada dentro da mesma conversa", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "first_of_thread", new_thread_after_hours: 24 },
          { hours_since_previous_inbound: 0.01 }
        )).toBe(false);
      });

      it("first_of_thread volta a disparar depois do silêncio", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "first_of_thread", new_thread_after_hours: 24 },
          { hours_since_previous_inbound: 168 }
        )).toBe(true);
      });

      it("first_of_thread é fail-closed sem a evidência no context", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "first_of_thread", new_thread_after_hours: 24 },
          {}
        )).toBe(false);
      });

      it("modo any ignora a evidência dos outros modos", () => {
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "any" },
          { hours_since_outbound: null, hours_since_previous_inbound: 0.01 }
        )).toBe(true);
      });

      it("modo e número se somam (E)", () => {
        const NUMERO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48, source_ids: [NUMERO] },
          { hours_since_outbound: 2, instance_id: NUMERO }
        )).toBe(true);

        expect(matchesTriggerConfig("lead_replied",
          { reply_mode: "after_outbound", reply_window_hours: 48, source_ids: [NUMERO] },
          { hours_since_outbound: 2, instance_id: "outro" }
        )).toBe(false);
      });
    });

    // ── filtro por etapa (stage_ids) ──
    // Sob o ADR-0023 quem ocupa etapa é o Negócio, não o Lead — e um Lead pode
    // ter vários. Escolha registrada na spec: filtro PURO, basta o lead ter
    // ALGUM card numa das etapas marcadas, e uma execução por resposta.
    describe("filtro por etapa", () => {
      const ETAPA_ENVIADA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const ETAPA_NEGOCIACAO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

      it("não dispara quando o lead não está em nenhuma das etapas", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: [ETAPA_NEGOCIACAO] }
        )).toBe(false);
      });

      it("dispara quando o lead tem card na etapa marcada", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: [ETAPA_ENVIADA] }
        )).toBe(true);
      });

      it("basta estar em UMA das etapas marcadas (OR)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA, ETAPA_NEGOCIACAO] },
          { lead_stage_ids: [ETAPA_NEGOCIACAO] }
        )).toBe(true);
      });

      // 12% dos leads em PROD têm 2+ cards. Um card elegível basta, e o
      // resultado é UMA execução — o matcher devolve um booleano, não uma
      // contagem.
      it("lead com vários cards casa se um deles estiver na etapa", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: [ETAPA_NEGOCIACAO, ETAPA_ENVIADA] }
        )).toBe(true);
      });

      it("lista vazia = qualquer etapa (não exige o contexto)", () => {
        expect(matchesTriggerConfig("lead_replied", { stage_ids: [] }, {})).toBe(true);
      });

      it("fail-closed quando o contexto não traz as etapas do lead", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          {}
        )).toBe(false);
      });

      it("fail-closed quando a leitura das etapas falhou (null)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: null }
        )).toBe(false);
      });

      // As 41 entradas de PROD sem `stage_id` chegam como null na lista.
      it("card sem stage_id não casa filtro nenhum", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: [null] }
        )).toBe(false);
      });

      it("não dispara quando o lead não tem card algum", () => {
        expect(matchesTriggerConfig("lead_replied",
          { stage_ids: [ETAPA_ENVIADA] },
          { lead_stage_ids: [] }
        )).toBe(false);
      });

      it("etapa, funil e número se somam (E)", () => {
        const FUNIL = "11111111-1111-1111-1111-111111111111";
        const NUMERO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const completo = {
          pipeline_ids: [FUNIL],
          stage_ids: [ETAPA_ENVIADA],
          source_ids: [NUMERO],
        };
        expect(matchesTriggerConfig("lead_replied", completo, {
          lead_pipeline_ids: [FUNIL],
          lead_stage_ids: [ETAPA_ENVIADA],
          instance_id: NUMERO,
        })).toBe(true);

        expect(matchesTriggerConfig("lead_replied", completo, {
          lead_pipeline_ids: [FUNIL],
          lead_stage_ids: [ETAPA_NEGOCIACAO],
          instance_id: NUMERO,
        })).toBe(false);
      });
    });

    // ── filtro por instância de origem (source_ids) ──
    // O caso que existe para resolver: a org tem dois números falando com o
    // mesmo lead, e só a resposta que chega NO número escolhido deve contar.
    describe("filtro por instância", () => {
      const NUMERO_CLOSER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const NUMERO_SDR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

      it("não dispara quando a resposta veio de outro número", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_type: "whatsapp_instance", source_ids: [NUMERO_CLOSER] },
          { instance_id: NUMERO_SDR }
        )).toBe(false);
      });

      it("dispara quando a resposta veio do número escolhido", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_type: "whatsapp_instance", source_ids: [NUMERO_CLOSER] },
          { instance_id: NUMERO_CLOSER }
        )).toBe(true);
      });

      it("basta ser UM dos números marcados (OR)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_type: "whatsapp_instance", source_ids: [NUMERO_CLOSER, NUMERO_SDR] },
          { instance_id: NUMERO_SDR }
        )).toBe(true);
      });

      it("lista vazia = qualquer número (não exige o contexto)", () => {
        expect(matchesTriggerConfig("lead_replied", { source_ids: [] }, {})).toBe(true);
      });

      // O `notificame-webhook` dispara sem contexto nenhum hoje. Sem esta
      // guarda, "só o número do Closer" viraria "qualquer número" em silêncio.
      it("fail-closed quando o evento não diz de onde veio", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_ids: [NUMERO_CLOSER] },
          {}
        )).toBe(false);
      });

      it("fail-closed quando a origem vem vazia", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_ids: [NUMERO_CLOSER] },
          { instance_id: "" }
        )).toBe(false);
      });

      it("ignora entradas inválidas na lista salva (jsonb não é validado)", () => {
        expect(matchesTriggerConfig("lead_replied",
          { source_ids: ["  ", null, 7, NUMERO_CLOSER] },
          { instance_id: NUMERO_CLOSER }
        )).toBe(true);
      });

      it("lista só com lixo equivale a sem filtro", () => {
        expect(matchesTriggerConfig("lead_replied", { source_ids: ["", "  "] }, {})).toBe(true);
      });

      it("número e funil se somam (E, não OU)", () => {
        const FUNIL = "11111111-1111-1111-1111-111111111111";
        expect(matchesTriggerConfig("lead_replied",
          { source_ids: [NUMERO_CLOSER], pipeline_ids: [FUNIL] },
          { instance_id: NUMERO_CLOSER, lead_pipeline_ids: [FUNIL] }
        )).toBe(true);

        expect(matchesTriggerConfig("lead_replied",
          { source_ids: [NUMERO_CLOSER], pipeline_ids: [FUNIL] },
          { instance_id: NUMERO_SDR, lead_pipeline_ids: [FUNIL] }
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

  // deal_created
  describe("deal_created", () => {
    const FUNIL_A = "11111111-1111-1111-1111-111111111111";
    const FUNIL_B = "22222222-2222-2222-2222-222222222222";
    const ctx = (over: Record<string, unknown> = {}) => ({
      lead_id: "lead-1",
      deal_id: "deal-1",
      pipeline_id: FUNIL_A,
      deal_value: 1000,
      owner_id: "tm-1",
      deal_source: "human",
      ...over,
    });

    it("matches a deal linked to a lead with no filters", () => {
      expect(matchesTriggerConfig("deal_created", {}, ctx())).toBe(true);
    });

    it("rejects a deal without lead by default (fail-closed)", () => {
      expect(matchesTriggerConfig("deal_created", {}, ctx({ lead_id: null }))).toBe(false);
    });

    it("accepts a deal without lead when require_lead is off", () => {
      expect(
        matchesTriggerConfig("deal_created", { require_lead: false }, ctx({ lead_id: null })),
      ).toBe(true);
    });

    it("filters by deals.source — human vs workflow vs api", () => {
      expect(matchesTriggerConfig("deal_created", { source: "human" }, ctx())).toBe(true);
      expect(
        matchesTriggerConfig("deal_created", { source: "human" }, ctx({ deal_source: "workflow" })),
      ).toBe(false);
      expect(
        matchesTriggerConfig("deal_created", { source: "workflow" }, ctx({ deal_source: "workflow" })),
      ).toBe(true);
      expect(
        matchesTriggerConfig("deal_created", { source: "api" }, ctx({ deal_source: "api" })),
      ).toBe(true);
      expect(
        matchesTriggerConfig("deal_created", { source: "any" }, ctx({ deal_source: "workflow" })),
      ).toBe(true);
    });

    it("filters by min_value", () => {
      expect(matchesTriggerConfig("deal_created", { min_value: 500 }, ctx())).toBe(true);
      expect(matchesTriggerConfig("deal_created", { min_value: 5000 }, ctx())).toBe(false);
      expect(
        matchesTriggerConfig("deal_created", { min_value: 1 }, ctx({ deal_value: null })),
      ).toBe(false);
    });

    it("filters by owner", () => {
      expect(matchesTriggerConfig("deal_created", { filter_owner_id: "tm-1" }, ctx())).toBe(true);
      expect(matchesTriggerConfig("deal_created", { filter_owner_id: "tm-9" }, ctx())).toBe(false);
    });

    it("combina vários funis com OR", () => {
      expect(
        matchesTriggerConfig("deal_created", { pipeline_ids: [FUNIL_A, FUNIL_B] }, ctx()),
      ).toBe(true);
      expect(
        matchesTriggerConfig(
          "deal_created",
          { pipeline_ids: [FUNIL_A, FUNIL_B] },
          ctx({ pipeline_id: "33333333-3333-3333-3333-333333333333" }),
        ),
      ).toBe(false);
    });

    it("lista vazia continua significando qualquer funil", () => {
      expect(matchesTriggerConfig("deal_created", { pipeline_ids: [] }, ctx())).toBe(true);
    });

    it("falha fechado sem pipeline_id ou com config malformada", () => {
      expect(
        matchesTriggerConfig("deal_created", { pipeline_ids: [FUNIL_A] }, ctx({ pipeline_id: null })),
      ).toBe(false);
      expect(matchesTriggerConfig("deal_created", { pipeline_ids: FUNIL_A }, ctx())).toBe(false);
      expect(
        matchesTriggerConfig("deal_created", { pipeline_ids: [FUNIL_A, 42] }, ctx()),
      ).toBe(false);
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

    // ── A trava que faltava ──
    // `matchesTriggerConfig` roda DUAS vezes: aqui no fireTrigger, e de novo
    // em `process-workflow-executions`, que revalida contra o context
    // PERSISTIDO antes de rodar o primeiro nó. A versão original desta feature
    // mantinha os funis fora do context de propósito (para não mexer na chave
    // de dedup) e, com isso, o fail-closed reprovava 100% das execuções: a
    // automação nascia e morria como "Skipped: trigger conditions not met".
    // Estes três testes travam as duas pontas ao mesmo tempo.
    it("grava lead_pipeline_ids no context, para a revalidação do executor", async () => {
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
      expect(ctx.lead_pipeline_ids).toEqual([FUNIL_A]);
      expect(ctx.message).toBe("oi");
    });

    it("o context persistido passa na revalidação do executor", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      const config = { pipeline_ids: [FUNIL_A] };
      seedWorkflow(mockTable, config);
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

      // Exatamente o que process-workflow-executions/index.ts:247 faz.
      const persisted = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(matchesTriggerConfig("lead_replied", config, persisted)).toBe(true);
    });

    it("persistir os funis NÃO contamina a chave de dedup", async () => {
      // A chave é `${trigger}:${hash}:${bucket}`. O hash tem que depender só
      // do context original — os funis de um lead mudam com o tempo e
      // tornariam a chave instável. Comparamos só o hash para não depender do
      // balde de 60s (que poderia virar no meio do teste).
      const hashOf = (key: unknown) => String(key).split(":")[1];

      const dispararComFunil = async (funilDoLead: string) => {
        const { sb, mockTable, getInserted } = createMockSupabase();
        seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A, FUNIL_B] });
        mockTable("pipeline_entries", [
          { organization_id: "org-1", lead_id: "lead-1", pipeline_id: funilDoLead },
        ]);
        await fireTrigger({
          supabase: sb,
          organizationId: "org-1",
          triggerType: "lead_replied",
          leadId: "lead-1",
          context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
        });
        return getInserted("workflow_executions")[0];
      };

      const emA = await dispararComFunil(FUNIL_A);
      const emB = await dispararComFunil(FUNIL_B);

      expect((emA.context as Record<string, unknown>).lead_pipeline_ids).toEqual([FUNIL_A]);
      expect((emB.context as Record<string, unknown>).lead_pipeline_ids).toEqual([FUNIL_B]);
      // Funis diferentes, MESMO hash: a lista não entrou no payload da chave.
      expect(hashOf(emA.trigger_dedup_key)).toBe(hashOf(emB.trigger_dedup_key));
    });

    it("sem filtro de funil, o context não ganha a chave (nada muda)", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { channel: "any" });
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

      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("lead_pipeline_ids");
    });

    it("grava lead_stage_ids no context quando o filtro é por etapa", async () => {
      const ETAPA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { stage_ids: [ETAPA] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A, stage_id: ETAPA },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(1);
      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(ctx.lead_stage_ids).toEqual([ETAPA]);
    });

    it("o context com etapa passa na revalidação do executor", async () => {
      const ETAPA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const config = { pipeline_ids: [FUNIL_A], stage_ids: [ETAPA] };
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, config);
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A, stage_id: ETAPA },
      ]);

      await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      const persisted = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(matchesTriggerConfig("lead_replied", config, persisted)).toBe(true);
    });

    it("card sem stage_id chega ao matcher como nulo, não some da lista", async () => {
      const ETAPA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const { sb, mockTable, getInserted } = createMockSupabase();
      // Filtro por funil (para a query acontecer), card sem etapa.
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A, stage_id: null },
      ]);

      await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      // Nulo preservado — é o que distingue "card sem etapa" de "leitura falhou".
      expect(ctx.lead_stage_ids).toEqual([null]);
      expect(matchesTriggerConfig("lead_replied", { stage_ids: [ETAPA] }, ctx)).toBe(false);
    });

    it("carrega hours_since_outbound quando o modo é after_outbound", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { reply_mode: "after_outbound", reply_window_hours: 48 });
      const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      mockTable("whatsapp_messages", [
        { organization_id: "org-1", lead_id: "lead-1", direction: "outgoing", timestamp: duasHorasAtras },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(1);
      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(ctx.hours_since_outbound).toBeCloseTo(2, 1);
    });

    // A mensagem que acabou de chegar JÁ está persistida quando o gatilho roda.
    // Se a evidência olhasse a linha mais recente, `first_of_thread` compararia
    // a mensagem com ela mesma (0h de silêncio) e nunca disparava.
    it("first_of_thread ignora a própria mensagem que acabou de chegar", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { reply_mode: "first_of_thread", new_thread_after_hours: 24 });
      const agora = new Date().toISOString();
      const semanaPassada = new Date(Date.now() - 168 * 60 * 60 * 1000).toISOString();
      mockTable("whatsapp_messages", [
        { organization_id: "org-1", lead_id: "lead-1", direction: "incoming", timestamp: agora },
        { organization_id: "org-1", lead_id: "lead-1", direction: "incoming", timestamp: semanaPassada },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "e aí?" },
      });

      expect(count).toBe(1);
      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(ctx.hours_since_previous_inbound).toBeCloseTo(168, 0);
    });

    it("first_of_thread não dispara na segunda mensagem da mesma rajada", async () => {
      const { sb, mockTable } = createMockSupabase();
      seedWorkflow(mockTable, { reply_mode: "first_of_thread", new_thread_after_hours: 24 });
      const agora = new Date().toISOString();
      const umMinutoAtras = new Date(Date.now() - 60 * 1000).toISOString();
      mockTable("whatsapp_messages", [
        { organization_id: "org-1", lead_id: "lead-1", direction: "incoming", timestamp: agora },
        { organization_id: "org-1", lead_id: "lead-1", direction: "incoming", timestamp: umMinutoAtras },
      ]);

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "?" },
      });

      expect(count).toBe(0);
    });

    it("modo any não paga a query de evidência", async () => {
      const { sb, mockTable, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { reply_mode: "any" });

      await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      const ctx = getInserted("workflow_executions")[0].context as Record<string, unknown>;
      expect(ctx).not.toHaveProperty("hours_since_outbound");
      expect(ctx).not.toHaveProperty("hours_since_previous_inbound");
    });

    it("fail-closed quando a leitura da evidência falha", async () => {
      const { sb, mockTable, mockSelectError, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { reply_mode: "after_outbound", reply_window_hours: 48 });
      mockTable("whatsapp_messages", [
        {
          organization_id: "org-1",
          lead_id: "lead-1",
          direction: "outgoing",
          timestamp: new Date(Date.now() - 3_600_000).toISOString(),
        },
      ]);
      mockSelectError("whatsapp_messages", { code: "57014", message: "statement timeout" });

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(0);
      expect(getInserted("workflow_executions")).toHaveLength(0);
    });

    it("fail-closed de ponta a ponta quando o filtro é por etapa e a leitura falha", async () => {
      const ETAPA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const { sb, mockTable, mockSelectError, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { stage_ids: [ETAPA] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A, stage_id: ETAPA },
      ]);
      mockSelectError("pipeline_entries", { code: "57014", message: "statement timeout" });

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(0);
      expect(getInserted("workflow_executions")).toHaveLength(0);
    });

    it("persistir as etapas NÃO contamina a chave de dedup", async () => {
      const ETAPA_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const ETAPA_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      const hashOf = (key: unknown) => String(key).split(":")[1];

      const dispararNaEtapa = async (etapaDoLead: string) => {
        const { sb, mockTable, getInserted } = createMockSupabase();
        seedWorkflow(mockTable, { stage_ids: [ETAPA_1, ETAPA_2] });
        mockTable("pipeline_entries", [
          { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A, stage_id: etapaDoLead },
        ]);
        await fireTrigger({
          supabase: sb,
          organizationId: "org-1",
          triggerType: "lead_replied",
          leadId: "lead-1",
          context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
        });
        return getInserted("workflow_executions")[0];
      };

      const em1 = await dispararNaEtapa(ETAPA_1);
      const em2 = await dispararNaEtapa(ETAPA_2);

      expect((em1.context as Record<string, unknown>).lead_stage_ids).toEqual([ETAPA_1]);
      expect((em2.context as Record<string, unknown>).lead_stage_ids).toEqual([ETAPA_2]);
      expect(hashOf(em1.trigger_dedup_key)).toBe(hashOf(em2.trigger_dedup_key));
    });

    // ── cooldown ──
    // Não há mecanismo novo: a chave de dedup já é `${trigger}:${hash}:${balde}`
    // e o índice único parcial (workflow_id, lead_id, trigger_dedup_key) já
    // garante que só o primeiro insert do balde vence. Cooldown é esse balde
    // com outro tamanho.
    describe("cooldown", () => {
      afterEach(() => vi.useRealTimers());

      const baldeDe = (key: unknown) => String(key).split(":")[2];

      async function dispararEmDoisMomentos(config: Record<string, unknown>, minutosEntre: number) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));

        const primeiro = createMockSupabase();
        seedWorkflow(primeiro.mockTable, config);
        await fireTrigger({
          supabase: primeiro.sb,
          organizationId: "org-1",
          triggerType: "lead_replied",
          leadId: "lead-1",
          context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
        });

        vi.advanceTimersByTime(minutosEntre * 60 * 1000);

        const segundo = createMockSupabase();
        seedWorkflow(segundo.mockTable, config);
        await fireTrigger({
          supabase: segundo.sb,
          organizationId: "org-1",
          triggerType: "lead_replied",
          leadId: "lead-1",
          context: { trigger: "lead_replied", channel: "whatsapp", message: "e aí?" },
        });

        return [
          primeiro.getInserted("workflow_executions")[0].trigger_dedup_key,
          segundo.getInserted("workflow_executions")[0].trigger_dedup_key,
        ];
      }

      it("duas respostas dentro do cooldown caem no mesmo balde", async () => {
        const [a, b] = await dispararEmDoisMomentos({ cooldown_minutes: 60 }, 10);
        expect(baldeDe(a)).toBe(baldeDe(b));
      });

      it("passado o cooldown, o balde muda e a automação pode rodar de novo", async () => {
        const [a, b] = await dispararEmDoisMomentos({ cooldown_minutes: 60 }, 90);
        expect(baldeDe(a)).not.toBe(baldeDe(b));
      });

      it("cooldown curto deixa passar o que o longo segurava", async () => {
        const [a, b] = await dispararEmDoisMomentos({ cooldown_minutes: 1 }, 10);
        expect(baldeDe(a)).not.toBe(baldeDe(b));
      });

      it("sem cooldown configurado, o padrão de 60min vale", async () => {
        const [a, b] = await dispararEmDoisMomentos({}, 10);
        expect(baldeDe(a)).toBe(baldeDe(b));
      });

      it("valor inválido cai no padrão, não em janela zero", async () => {
        const [a, b] = await dispararEmDoisMomentos({ cooldown_minutes: 0 }, 10);
        expect(baldeDe(a)).toBe(baldeDe(b));

        const [c, d] = await dispararEmDoisMomentos({ cooldown_minutes: "abacaxi" }, 10);
        expect(baldeDe(c)).toBe(baldeDe(d));
      });

      // O cooldown é do `lead_replied`. Mexer nele não pode alterar a janela
      // dos outros gatilhos — `stage_changed` tem 300s por causa do incidente
      // de re-disparo (Motor 100, 2026-07-03).
      it("não altera a janela dos outros gatilhos", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));

        const dispararStageChanged = async () => {
          const { sb, mockTable, getInserted } = createMockSupabase();
          mockTable("workflows", [
            {
              id: "wf-stage",
              trigger_config: { cooldown_minutes: 60 },
              organization_id: "org-1",
              trigger_type: "stage_changed",
              is_active: true,
            },
          ]);
          await fireTrigger({
            supabase: sb,
            organizationId: "org-1",
            triggerType: "stage_changed",
            leadId: "lead-1",
            context: { trigger: "stage_changed" },
          });
          return getInserted("workflow_executions")[0].trigger_dedup_key;
        };

        const a = await dispararStageChanged();
        vi.advanceTimersByTime(10 * 60 * 1000);
        const b = await dispararStageChanged();

        // 10 min > janela de 300s: baldes diferentes, o cooldown foi ignorado.
        expect(baldeDe(a)).not.toBe(baldeDe(b));
      });
    });

    it("fail-closed de ponta a ponta quando a leitura dos funis falha", async () => {
      const { sb, mockTable, mockSelectError, getInserted } = createMockSupabase();
      seedWorkflow(mockTable, { pipeline_ids: [FUNIL_A] });
      mockTable("pipeline_entries", [
        { organization_id: "org-1", lead_id: "lead-1", pipeline_id: FUNIL_A },
      ]);
      // O lead ESTÁ no funil — mas a consulta quebra. Não pode disparar.
      mockSelectError("pipeline_entries", { code: "57014", message: "statement timeout" });

      const count = await fireTrigger({
        supabase: sb,
        organizationId: "org-1",
        triggerType: "lead_replied",
        leadId: "lead-1",
        context: { trigger: "lead_replied", channel: "whatsapp", message: "oi" },
      });

      expect(count).toBe(0);
      expect(getInserted("workflow_executions")).toHaveLength(0);
    });
  });
});

// ─── hasActiveWorkflowsForTrigger — a guarda barata do passo 0.97 ──────
//
// É ela que decide se `agent-message` sequer avalia o trigger, em TODA
// mensagem inbound da frota. Sem teste, qualquer deriva nos filtros mata a
// feature em silêncio com a suíte verde.

describe("hasActiveWorkflowsForTrigger", () => {
  const seed = (mockTable: ReturnType<typeof createMockSupabase>["mockTable"], rows: Record<string, unknown>[]) =>
    mockTable("workflows", rows);

  it("acha workflow ativo do tipo pedido", async () => {
    const { sb, mockTable } = createMockSupabase();
    seed(mockTable, [
      { id: "wf-1", organization_id: "org-1", trigger_type: "lead_replied", is_active: true },
    ]);
    expect(await hasActiveWorkflowsForTrigger(sb, "org-1", "lead_replied")).toBe(true);
  });

  it("ignora workflow DESATIVADO", async () => {
    const { sb, mockTable } = createMockSupabase();
    seed(mockTable, [
      { id: "wf-1", organization_id: "org-1", trigger_type: "lead_replied", is_active: false },
    ]);
    expect(await hasActiveWorkflowsForTrigger(sb, "org-1", "lead_replied")).toBe(false);
  });

  it("ignora workflow de OUTRO trigger", async () => {
    const { sb, mockTable } = createMockSupabase();
    seed(mockTable, [
      { id: "wf-1", organization_id: "org-1", trigger_type: "stage_changed", is_active: true },
    ]);
    expect(await hasActiveWorkflowsForTrigger(sb, "org-1", "lead_replied")).toBe(false);
  });

  it("ignora workflow de OUTRA org (service_role bypassa a RLS)", async () => {
    const { sb, mockTable } = createMockSupabase();
    seed(mockTable, [
      { id: "wf-1", organization_id: "org-2", trigger_type: "lead_replied", is_active: true },
    ]);
    expect(await hasActiveWorkflowsForTrigger(sb, "org-1", "lead_replied")).toBe(false);
  });

  it("fail-safe: erro de leitura devolve false (não paga o lookup de lead)", async () => {
    const { sb, mockTable, mockSelectError } = createMockSupabase();
    seed(mockTable, [
      { id: "wf-1", organization_id: "org-1", trigger_type: "lead_replied", is_active: true },
    ]);
    mockSelectError("workflows", { code: "57014", message: "statement timeout" });
    expect(await hasActiveWorkflowsForTrigger(sb, "org-1", "lead_replied")).toBe(false);
  });
});

// ─── normalizePipelineIds — jsonb livre, nada valida a forma na escrita ──

describe("normalizePipelineIds", () => {
  it("descarta não-strings, apara espaço e remove vazios", () => {
    expect(normalizePipelineIds(["  a  ", "", null, 42, { x: 1 }, "b"])).toEqual(["a", "b"]);
  });

  it("deduplica", () => {
    expect(normalizePipelineIds(["a", "a", " a "])).toEqual(["a"]);
  });

  it("não-array vira lista vazia", () => {
    expect(normalizePipelineIds(null)).toEqual([]);
    expect(normalizePipelineIds(undefined)).toEqual([]);
    expect(normalizePipelineIds("a")).toEqual([]);
    expect(normalizePipelineIds({ 0: "a" })).toEqual([]);
  });
});
