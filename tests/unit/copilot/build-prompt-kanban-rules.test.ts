/**
 * build-prompt §4.1 — REGRAS DA ETAPA ATUAL por funil das rules (SCRUM-628).
 *
 * Antes a seção casava regras contra a união hardcoded whatsapp/confirmacao/
 * propostas/upsell/campanha lida do leadData. Agora cada regra aponta um FUNIL
 * (uuid ou slug) e a posição do lead vem da entry dele em `pipeline_entries`
 * naquele funil — inclusive funil custom. Campanha segue como eixo próprio.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pipelines, entriesByPipeline } = vi.hoisted(() => ({
  pipelines: {} as Record<string, { id: string; slug: string; name: string; type: string; is_active: boolean }>,
  entriesByPipeline: {} as Record<string, unknown>,
}));

vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../supabase/functions/_shared/pipeline-adapter.ts")>();
  return {
    ...original,
    resolvePipeline: vi.fn(async (_sb: unknown, orgId: string, ref: string) => {
      const found = pipelines[ref];
      if (!found) throw new original.PipelineResolutionError("pipeline_not_found", orgId, ref);
      return found;
    }),
    getPipeEntry: vi.fn(
      async (_sb: unknown, _leadId: string, _orgId: string, pipelineId: string) =>
        entriesByPipeline[pipelineId] ?? null,
    ),
  };
});

import { buildDynamicPrompt } from "../../../supabase/functions/agent-message/engine/build-prompt.ts";

/** Client mínimo: só o lookup de lead_history (handoff recente) chega ao DB. */
interface StubChain {
  select: () => StubChain;
  eq: () => StubChain;
  not: () => StubChain;
  order: () => StubChain;
  limit: () => StubChain;
  maybeSingle: () => Promise<{ data: null; error: null }>;
}
function supabaseStub() {
  const b: StubChain = {
    select: () => b,
    eq: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { from: () => b } as never;
}

const CUSTOM_PIPE_ID = "11111111-2222-3333-4444-555555555555";
const CUSTOM_STAGE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    supabase: supabaseStub(),
    capabilities: {
      system_prompt: "PROMPT BASE",
      availability: {},
      ...((overrides.capabilities as Record<string, unknown>) ?? {}),
    },
    conversation: { state: "INITIAL", turn_count: 1, context: {}, organization_id: "org-1" },
    leadData: { organization_id: "org-1", ...((overrides.leadData as Record<string, unknown>) ?? {}) },
    currentLeadId: "lead-1",
    conversationContext: null,
    incomingMessageType: "text",
  } as never;
}

beforeEach(() => {
  for (const k of Object.keys(pipelines)) delete pipelines[k];
  for (const k of Object.keys(entriesByPipeline)) delete entriesByPipeline[k];
});

describe("buildDynamicPrompt — regras da etapa atual (kanban)", () => {
  it("regra em FUNIL CUSTOM (formato novo uuid+uuid) entra no prompt quando a entry está na etapa", async () => {
    pipelines[CUSTOM_PIPE_ID] = {
      id: CUSTOM_PIPE_ID, slug: "pos-venda", name: "Pós-venda", type: "custom", is_active: true,
    };
    entriesByPipeline[CUSTOM_PIPE_ID] = {
      id: "e1", pipeline_id: CUSTOM_PIPE_ID, stage_id: CUSTOM_STAGE_ID, stage_key: "entrada",
    };

    const prompt = await buildDynamicPrompt(baseParams({
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [{
          pipe_type: CUSTOM_PIPE_ID,
          stage_name: CUSTOM_STAGE_ID,
          goal: "Renovar o contrato",
          behavior: "Tom consultivo",
          allowed_actions: ["schedule_meeting"],
          forbidden_actions: ["update_crm"],
        }],
      },
    }));

    expect(prompt).toContain("# REGRAS DA ETAPA ATUAL (Kanban)");
    expect(prompt).toContain('na etapa "entrada" do funil Pós-venda');
    expect(prompt).toContain("Renovar o contrato");
    expect(prompt).toContain("Tom consultivo");
    expect(prompt).toContain("schedule_meeting");
  });

  it("regra legada (slug + stage_key, case-insensitive) continua casando — config salva não quebra", async () => {
    pipelines["whatsapp"] = {
      id: "pipe-wpp", slug: "whatsapp", name: "WhatsApp", type: "system", is_active: true,
    };
    entriesByPipeline["pipe-wpp"] = {
      id: "e1", pipeline_id: "pipe-wpp", stage_id: "st-1", stage_key: "novo",
    };

    const prompt = await buildDynamicPrompt(baseParams({
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [{
          pipe_type: "whatsapp", stage_name: "NOVO", goal: "Abordar rápido", behavior: "",
        }],
      },
    }));

    expect(prompt).toContain('na etapa "novo" do funil WhatsApp');
    expect(prompt).toContain("Abordar rápido");
  });

  it("lead sem entry no funil da regra: seção não aparece", async () => {
    pipelines["whatsapp"] = {
      id: "pipe-wpp", slug: "whatsapp", name: "WhatsApp", type: "system", is_active: true,
    };

    const prompt = await buildDynamicPrompt(baseParams({
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [{ pipe_type: "whatsapp", stage_name: "novo", goal: "g", behavior: "b" }],
      },
    }));

    expect(prompt).not.toContain("# REGRAS DA ETAPA ATUAL (Kanban)");
  });

  it("regra apontando funil que a org não tem mais fica MUDA — prompt não quebra", async () => {
    const prompt = await buildDynamicPrompt(baseParams({
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [{ pipe_type: "funil-apagado", stage_name: "x", goal: "g", behavior: "b" }],
      },
    }));

    expect(prompt).toContain("PROMPT BASE");
    expect(prompt).not.toContain("# REGRAS DA ETAPA ATUAL (Kanban)");
  });

  it("campanha continua sendo outro eixo: casa pelo nome da etapa da campanha no leadData", async () => {
    const prompt = await buildDynamicPrompt(baseParams({
      leadData: { organization_id: "org-1", campanha_stage: "Disparo Inicial" },
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [{
          pipe_type: "campanha", stage_name: "disparo inicial", goal: "Confirmar interesse", behavior: "",
        }],
      },
    }));

    expect(prompt).toContain('na etapa "Disparo Inicial" do funil Campanhas');
    expect(prompt).toContain("Confirmar interesse");
  });

  it("refs diferentes para o MESMO funil (slug + uuid) não duplicam a seção", async () => {
    pipelines["whatsapp"] = {
      id: "pipe-wpp", slug: "whatsapp", name: "WhatsApp", type: "system", is_active: true,
    };
    pipelines["pipe-wpp"] = pipelines["whatsapp"];
    entriesByPipeline["pipe-wpp"] = {
      id: "e1", pipeline_id: "pipe-wpp", stage_id: "st-1", stage_key: "novo",
    };

    const prompt = await buildDynamicPrompt(baseParams({
      capabilities: {
        system_prompt: "PROMPT BASE",
        availability: {},
        copilot_agent_kanban_rules: [
          { pipe_type: "whatsapp", stage_name: "novo", goal: "só uma vez", behavior: "" },
          { pipe_type: "pipe-wpp", stage_name: "outra_etapa", goal: "não casa", behavior: "" },
        ],
      },
    }));

    expect(prompt.split("só uma vez").length - 1).toBe(1);
    expect(prompt).not.toContain("não casa");
  });
});
