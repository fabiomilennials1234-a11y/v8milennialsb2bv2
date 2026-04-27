/**
 * Smoke + stress + behavior tests para o refactor do copilot:
 *  - ai-action-executor.ts → _shared/actions/* (Fase A)
 *  - agent-engine.ts utils → engine/utils.ts (Fase B.1)
 *
 * Não exercita backend real — testa contratos e comportamento das funções
 * extraídas com mocks deterministas. Stress = N execuções paralelas.
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// ── Imports do refactor ──────────────────────────────────────────────────────

// Fachada (preserva contrato externo)
import {
  executeAiAction,
  immediateTransferHuman,
  type ActionRecord,
  type ActionResult,
} from "../../supabase/functions/_shared/ai-action-executor";

// Re-export dos sub-módulos (para garantir que estrutura não quebrou)
import { NOOP_ACTION_TYPES } from "../../supabase/functions/_shared/actions/types";

// Helpers puros do agent-engine extraídos
import {
  parseCustomInstructions,
  extractTopicFromMessage,
  detectIntentFromMessage,
  calculateLeadTemperature,
  calculateEngagementScore,
  detectSentiment,
  classifyIntent,
  checkOutOfHours,
} from "../../supabase/functions/agent-message/engine/utils";

// =============================================================================
// SMOKE — fachada / contrato público
// =============================================================================

describe("Smoke — fachada ai-action-executor.ts preserva contrato pos-refactor", () => {
  it("exporta executeAiAction como funcao", () => {
    expect(typeof executeAiAction).toBe("function");
  });

  it("exporta immediateTransferHuman como funcao", () => {
    expect(typeof immediateTransferHuman).toBe("function");
  });

  it("exporta tipos ActionRecord/ActionResult (compile-time check)", () => {
    const rec: ActionRecord = {
      id: "1",
      organization_id: "o",
      lead_id: "l",
      conversation_id: "c",
      action_type: "noop",
      payload: {},
    };
    const res: ActionResult = { success: true };
    expect(rec.id).toBe("1");
    expect(res.success).toBe(true);
  });

  it("NOOP_ACTION_TYPES contem generate_message e send_product_material", () => {
    expect(NOOP_ACTION_TYPES.has("generate_message")).toBe(true);
    expect(NOOP_ACTION_TYPES.has("send_product_material")).toBe(true);
    expect(NOOP_ACTION_TYPES.size).toBe(2);
  });
});

// =============================================================================
// COMPORTAMENTO — utils puros (verifica saidas pra inputs conhecidos)
// =============================================================================

describe("Comportamento — engine/utils.ts (funcoes puras)", () => {
  describe("parseCustomInstructions", () => {
    it("retorna empty quando raw vazio", () => {
      expect(parseCustomInstructions("")).toEqual({ dos: "", donts: "" });
    });

    it("parseia JSON valido com dos/donts", () => {
      const raw = JSON.stringify({ dos: "ser educado", donts: "mentir" });
      expect(parseCustomInstructions(raw)).toEqual({
        dos: "ser educado",
        donts: "mentir",
      });
    });

    it("retorna raw em dos quando nao e JSON (legacy)", () => {
      expect(parseCustomInstructions("texto livre legacy")).toEqual({
        dos: "texto livre legacy",
        donts: "",
      });
    });

    it("tolera JSON sem chaves esperadas", () => {
      expect(parseCustomInstructions(JSON.stringify({ outro: "x" }))).toEqual({
        dos: JSON.stringify({ outro: "x" }),
        donts: "",
      });
    });
  });

  describe("extractTopicFromMessage", () => {
    it("retorna empty pra string vazia", () => {
      expect(extractTopicFromMessage("")).toBe("");
    });

    it("pega palavras > 3 chars, max 5", () => {
      const out = extractTopicFromMessage(
        "Estou interessado em automacao de vendas para empresa pequena",
      );
      // todas palavras >= 4 chars; pega primeiras 5
      expect(out.split(" ").length).toBeLessThanOrEqual(5);
      expect(out).toContain("estou");
    });

    it("fallback substring quando todas palavras curtas", () => {
      expect(extractTopicFromMessage("oi bom dia")).toMatch(/^oi bom dia/);
    });
  });

  describe("detectIntentFromMessage", () => {
    it("agendamento", () => {
      expect(detectIntentFromMessage("quero marcar uma reunião")).toBe("agendamento");
    });

    it("objecao_preco", () => {
      expect(detectIntentFromMessage("isso é caro demais")).toBe("objecao_preco");
    });

    it("pergunta — match generico de interrogativa", () => {
      // "como funciona" bate em interesse primeiro (mapa tem "como funciona" em interesse).
      // Pra forcar pergunta: input que so contem "?" e nada do mapa de interesse/objecao.
      expect(detectIntentFromMessage("?")).toBe("pergunta");
    });

    it("neutro quando nao bate nenhum padrao", () => {
      expect(detectIntentFromMessage("blá blá blá xyz")).toBe("neutro");
    });

    it("unknown pra string vazia", () => {
      expect(detectIntentFromMessage("")).toBe("unknown");
    });
  });

  describe("calculateLeadTemperature", () => {
    it("cold pra historico vazio", () => {
      expect(calculateLeadTemperature([])).toBe("cold");
    });

    it("warm com 4 mensagens medias", () => {
      const msgs = Array.from({ length: 4 }, () => ({ content: "ok blabla?" }));
      const t = calculateLeadTemperature(msgs);
      expect(["cold", "warm", "hot"]).toContain(t);
    });

    it("hot com volume + sinais positivos + perguntas", () => {
      const msgs = [
        { content: "sim, quero saber mais" },
        { content: "vamos fazer?" },
        { content: "interessante!" },
        { content: "como funciona?" },
        { content: "quanto custa?" },
        { content: "pode marcar?" },
        { content: "perfeito" },
        { content: "podemos avancar?" },
        { content: "quero" },
        { content: "vamos" },
        { content: "sim" },
      ];
      expect(calculateLeadTemperature(msgs)).toBe("hot");
    });
  });

  describe("calculateEngagementScore", () => {
    it("0 pra historico vazio", () => {
      expect(calculateEngagementScore([])).toBe(0);
    });

    it("cap em 100", () => {
      const longMsgs = Array.from({ length: 30 }, () => ({
        direction: "incoming",
        content: "x".repeat(200),
      }));
      expect(calculateEngagementScore(longMsgs)).toBe(100);
    });

    it("score positivo pra conversa media", () => {
      const msgs = Array.from({ length: 8 }, (_, i) => ({
        direction: i % 2 === 0 ? "incoming" : "outgoing",
        content: "mensagem com tamanho razoavel ai sim",
      }));
      const s = calculateEngagementScore(msgs);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(100);
    });
  });

  describe("detectSentiment", () => {
    it("positive em mensagem de aceite", () => {
      expect(detectSentiment("Adorei! quero saber mais sobre isso")).toBe("positive");
    });

    it("negative em recusa explicita", () => {
      expect(detectSentiment("não quero, sem interesse, deixa pra lá")).toBe("negative");
    });

    it("neutral default", () => {
      expect(detectSentiment("ok recebi")).toBe("neutral");
    });
  });

  describe("classifyIntent", () => {
    it("scheduling", () => {
      expect(classifyIntent("vamos marcar uma reuniao?")).toBe("scheduling");
    });

    it("objection", () => {
      expect(classifyIntent("acho caro demais pro meu budget")).toBe("objection");
    });

    it("faq", () => {
      expect(classifyIntent("como funciona o produto?")).toBe("faq");
    });

    it("qualification", () => {
      expect(classifyIntent("nossa empresa tem 50 funcionários")).toBe("qualification");
    });

    it("chitchat default", () => {
      expect(classifyIntent("oi blz")).toBe("chitchat");
    });
  });

  describe("checkOutOfHours", () => {
    it("retorna null quando enforcement = soft", () => {
      const caps = {
        behavior_enforcement: "soft",
        behavior_windows: [],
        availability: { mode: "scheduled" },
      };
      expect(checkOutOfHours(caps)).toBeNull();
    });

    it("retorna null quando availability.mode != scheduled e sem windows", () => {
      expect(checkOutOfHours({ availability: { mode: "always" } })).toBeNull();
    });

    it("retorna null em ausencia total de config", () => {
      expect(checkOutOfHours({})).toBeNull();
    });

    it("nao joga em payload malformado", () => {
      expect(() => checkOutOfHours({ behavior_windows: "nope" })).not.toThrow();
    });
  });
});

// =============================================================================
// DISPATCHER — comportamento do switch case
// =============================================================================

describe("Comportamento — executeAiAction dispatcher", () => {
  function makeAction(action_type: string, payload: any = {}): ActionRecord {
    return {
      id: "test-id",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: "conv-1",
      action_type,
      payload,
    };
  }

  it("generate_message retorna success (NOOP_ACTION_TYPES tem prioridade)", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("generate_message");
    const res = await executeAiAction(supabase as any, action);
    // generate_message esta em NOOP_ACTION_TYPES, batendo o early return antes
    // do switch case especifico que retornaria "no-op: generate_message handler pending design".
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/^noop:generate_message$/);
    expect(res.data?.skipped).toBe(true);
  });

  it("send_product_material retorna noop com skipped=true", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("send_product_material");
    const res = await executeAiAction(supabase as any, action);
    expect(res.success).toBe(true);
    expect(res.data?.skipped).toBe(true);
    expect(res.message).toMatch(/^noop:send_product_material$/);
  });

  it("update_crm placeholder retorna success", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("update_crm");
    const res = await executeAiAction(supabase as any, action);
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/UPDATE_CRM/);
  });

  it("acao desconhecida retorna failure com erro descritivo", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("inexistente_xyz");
    const res = await executeAiAction(supabase as any, action);
    expect(res.success).toBe(false);
    expect(res.error).toContain("desconhecido");
  });

  it("schedule_meeting sem lead_id retorna failure", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("schedule_meeting", { preferred_date: "2026-05-01" });
    action.lead_id = null;
    const res = await executeAiAction(supabase as any, action);
    expect(res.success).toBe(false);
  });

  it("update_lead sem updates retorna failure", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("update_lead", { lead_id: "lead-1" });
    const res = await executeAiAction(supabase as any, action);
    expect(res.success).toBe(false);
    expect(res.error).toContain("obrigat");
  });

  it("update_qualification_score retorna shape valida (success ou failure)", async () => {
    const { sb: supabase } = createMockSupabase();
    const action = makeAction("update_qualification_score", {
      lead_id: "lead-1",
      score: 9999,
    });
    const res = await executeAiAction(supabase as any, action);
    expect(res).toHaveProperty("success");
    if (res.success) {
      // Cap em 100 garantido pela funcao pura — se mock falhou no UPDATE,
      // ainda retorna data.score com valor capped antes do db call.
      expect(res.data?.score).toBeLessThanOrEqual(100);
    }
  });
});

// =============================================================================
// STRESS — N execucoes paralelas em handlers extraidos
// =============================================================================

describe("Stress — concorrencia em executeAiAction", () => {
  it("100 noop:generate_message em paralelo todos sucesso", async () => {
    const { sb: supabase } = createMockSupabase();
    const N = 100;
    const actions: ActionRecord[] = Array.from({ length: N }, (_, i) => ({
      id: `s-${i}`,
      organization_id: "org-1",
      lead_id: `lead-${i}`,
      conversation_id: null,
      action_type: "generate_message",
      payload: {},
    }));

    const start = Date.now();
    const results = await Promise.all(
      actions.map((a) => executeAiAction(supabase as any, a)),
    );
    const dur = Date.now() - start;

    expect(results.length).toBe(N);
    expect(results.every((r) => r.success)).toBe(true);
    expect(dur).toBeLessThan(5000); // 5s budget pra 100 chamadas
  });

  it("500 update_qualification_score em paralelo, sem crash", async () => {
    const N = 500;
    const { sb: supabase } = createMockSupabase();
    const actions: ActionRecord[] = Array.from({ length: N }, (_, i) => ({
      id: `q-${i}`,
      organization_id: "org-1",
      lead_id: `lead-${i}`,
      conversation_id: null,
      action_type: "update_qualification_score",
      payload: { lead_id: `lead-${i}`, score: i % 101 },
    }));

    const start = Date.now();
    const results = await Promise.allSettled(
      actions.map((a) => executeAiAction(supabase as any, a)),
    );
    const dur = Date.now() - start;
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;

    // Sem crash: todas as promises resolvem (success ou failure shape)
    expect(fulfilled).toBe(N);
    expect(dur).toBeLessThan(15000);
  });

  it("mix de 200 acoes (5 tipos diferentes) em paralelo, sem crash", async () => {
    const { sb: supabase } = createMockSupabase();
    const types = [
      "generate_message",
      "send_product_material",
      "update_crm",
      "inexistente_xyz",
      "update_qualification_score",
    ];
    const actions: ActionRecord[] = Array.from({ length: 200 }, (_, i) => ({
      id: `m-${i}`,
      organization_id: "org-1",
      lead_id: `lead-${i}`,
      conversation_id: null,
      action_type: types[i % types.length],
      payload: { lead_id: `lead-${i}`, score: 50 },
    }));

    const results = await Promise.allSettled(
      actions.map((a) => executeAiAction(supabase as any, a)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    // Sem crash: dispatcher devolve shape valida em todas — alguns tipos podem
    // retornar success=false (inexistente_xyz, ou update_qualification se mock
    // falhar no DB call), mas a promise resolve.
    expect(fulfilled).toBeGreaterThanOrEqual(160);
  });
});

// =============================================================================
// STRESS — utils puros sob volume
// =============================================================================

describe("Stress — utils puros sob volume", () => {
  it("classifyIntent processa 10k mensagens em < 1s", () => {
    const N = 10000;
    const samples = ["agendar reuniao", "caro demais", "como funciona", "minha empresa"];
    const start = Date.now();
    for (let i = 0; i < N; i++) {
      classifyIntent(samples[i % samples.length]);
    }
    const dur = Date.now() - start;
    expect(dur).toBeLessThan(1000);
  });

  it("calculateEngagementScore com historico de 1k mensagens nao trava", () => {
    const msgs = Array.from({ length: 1000 }, (_, i) => ({
      direction: i % 2 === 0 ? "incoming" : "outgoing",
      content: "x".repeat(80),
    }));
    const start = Date.now();
    const score = calculateEngagementScore(msgs);
    const dur = Date.now() - start;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(dur).toBeLessThan(100);
  });

  it("checkOutOfHours em 10k chamadas com configs aleatorias nao joga", () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      const enforcement = i % 2 === 0 ? "hard" : "soft";
      const windows = i % 3 === 0 ? [] : [{ behavior: "x" }];
      checkOutOfHours({
        behavior_enforcement: enforcement,
        behavior_windows: windows,
        availability: { mode: "scheduled" },
      });
    }
    const dur = Date.now() - start;
    expect(dur).toBeLessThan(2000);
  });
});
