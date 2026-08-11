/* eslint-disable @typescript-eslint/no-explicit-any -- Suíte de dublês: estado de fixture e mocks de borda do handler de followups. O `any` está nas formas de mock, não no código sob teste. */
// @vitest-environment node
/**
 * POR QUE ESTE TESTE EXISTE — inv:H4-03 (SCRUM-97)
 * =================================================
 *
 * `process-copilot-followups` roda em pg_cron a cada 5 min e **manda mensagem
 * de WhatsApp**. Quem esse handler seleciona, recebe. Não é uma tela que mostra
 * dado errado: é o cliente lendo "vi que você ainda não agendou" no celular
 * depois de já ter comprado.
 *
 * O defeito que esta suíte impede é o handler voltar a decidir o lote lendo
 * `leads.pipe_whatsapp`. Essa coluna é **espelho legado**, e o ADR-0023 mediu o
 * que acontece com ela depois da decisão 4 (avançar é MOVE, não cópia):
 *
 *   > "Na move, `NEW.pipeline_id` já é Orçamentos, o slug não é mais `whatsapp`,
 *   >  e a função **não escreve nada**. `leads.pipe_whatsapp` não vai a vazio;
 *   >  ele **congela no último estágio de WhatsApp, permanentemente**."
 *   >  — docs/adr/0023-negocio-is-the-funnel-unit.md, nota de revisão da decisão 10
 *
 * E o ADR mede o estrago já existente: **1.885 Leads em 34 orgs** onde o espelho
 * discorda do card. Congelado é pior que vazio — vazio degrada em silêncio
 * (nenhum filtro casa, ninguém recebe), congelado **mente**: `filter_pipes` e
 * `filter_stages` casam SEMPRE em vez de nunca, e o follow-up dispara.
 *
 * O alvo é o bloco de decisão inline em
 * `supabase/functions/process-copilot-followups/index.ts` (filter_pipes ~291-309,
 * filter_stages ~310-327). A fonte correta é `getPipeEntriesByLeads` — o Negócio.
 *
 * COMO ESTA SUÍTE SE COSTURA AO CÓDIGO QUE RODA
 * ----------------------------------------------
 * Não há módulo extraído aqui, e de propósito. O teste substitui `Deno.serve`
 * ANTES do import (via `vi.hoisted`), captura o handler que o próprio
 * `index.ts` registra, e o invoca. A função exercitada é **literalmente a que o
 * cron chama** — mesma closure, mesmas linhas. Mutar o bloco de filtro em
 * `index.ts` reprova esta suíte; é o mesmo padrão já usado em
 * `tests/unit/mass-send-create-permission.test.ts`.
 *
 * As fixtures de `leads` carregam `pipe_whatsapp` PREENCHIDO de propósito,
 * mesmo o SELECT de produção não pedindo essa coluna hoje. Se alguém devolver a
 * coluna ao SELECT (é uma linha), a decisão não pode passar a usá-la — o dado
 * estar ao alcance da mão é justamente a condição em que a regressão acontece.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap: Deno global + captura do handler, antes de qualquer import.
// ─────────────────────────────────────────────────────────────────────────────
const { getHandler, envStore } = vi.hoisted(() => {
  let _handler: any = null;
  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CRON_SECRET: "cron-secret-de-teste",
    ALLOWED_ORIGINS: "http://localhost:8080",
    // OPENROUTER_API_KEY ausente de propósito: mantém o caminho do template
    // fixo, sem chamada de LLM. A decisão sob teste é anterior à geração.
  };

  (globalThis as any).Deno = {
    env: {
      get: (k: string) => envStore[k] ?? undefined,
      set: (k: string, v: string) => { envStore[k] = v; },
      delete: (k: string) => { delete envStore[k]; },
      toObject: () => ({ ...envStore }),
    },
    serve: (fn: any) => { _handler = fn; },
  };

  return {
    getHandler: () => _handler as (req: Request) => Promise<Response>,
    envStore,
  };
});

// ── Estado controlado pelos casos ────────────────────────────────────────────
type Entry = { lead_id: string; stage_key: string };

const state: {
  rules: any[];
  candidates: any[];
  leads: any[];
  execRows: any[];
  entries: Record<"whatsapp" | "confirmacao" | "propostas", Entry[]>;
  leadsSelectArgs: string[];
  adapterCalls: { leadIds: string[]; orgId: string; slug: string }[];
  sends: { leadId: string; messageContent: string }[];
} = {
  rules: [],
  candidates: [],
  leads: [],
  execRows: [],
  entries: { whatsapp: [], confirmacao: [], propostas: [] },
  leadsSelectArgs: [],
  adapterCalls: [],
  sends: [],
};

// ── Mocks de borda (tudo que NÃO é a decisão sob teste) ──────────────────────
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, h: (req: Request) => Promise<Response>) => h,
}));
vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../supabase/functions/_shared/anti-ban-jitter.ts", () => ({
  sleepJitter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: vi.fn().mockResolvedValue({ canceled: false }),
}));
vi.mock("../../supabase/functions/agent-message/agent-engine.ts", () => ({
  AgentEngine: class { generateFollowupMessage() { return Promise.resolve("gerada"); } },
}));
vi.mock("../../supabase/functions/agent-message/openrouter-client.ts", () => ({
  OpenRouterClient: class {},
}));

// O envio é o OBSERVÁVEL da suíte: "quem esse handler seleciona, recebe".
vi.mock("../../supabase/functions/_shared/followup-sender.ts", () => ({
  sendFollowupMessage: vi.fn(async (_sb: any, p: any) => {
    state.sends.push({ leadId: p.leadId, messageContent: p.messageContent });
    return { success: true };
  }),
}));

// A fonte canônica do funil. Fica sob controle do teste para que a divergência
// espelho-congelado × Negócio-real possa ser construída. A corretude do próprio
// adapter é coberta por `supabase/functions/_shared/pipeline-adapter*.test.ts`.
vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntriesByLeads: vi.fn(
    async (_sb: any, leadIds: string[], orgId: string, slug: "whatsapp" | "confirmacao" | "propostas") => {
      state.adapterCalls.push({ leadIds: [...leadIds], orgId, slug });
      return state.entries[slug].filter((e) => leadIds.includes(e.lead_id));
    },
  ),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => fakeSupabase,
}));

// ── Cliente Supabase falso, encadeável e "thenable" ──────────────────────────
function resolveQuery(table: string, ctx: any) {
  switch (table) {
    case "copilot_agent_followup_rules":
      return { data: state.rules, error: null };
    case "whatsapp_instances":
      return { data: { instance_name: "instancia-teste" }, error: null };
    case "leads": {
      state.leadsSelectArgs.push(String(ctx.selectArg ?? ""));
      const ids: string[] = ctx.filters.id ?? [];
      return { data: state.leads.filter((l) => ids.includes(l.id)), error: null };
    }
    case "copilot_followup_execution_log":
      return { data: state.execRows, error: null };
    case "copilot_followup_step_log":
      return { data: [], error: null };
    default:
      return { data: [], error: null };
  }
}

const fakeSupabase: any = {
  from(table: string) {
    const ctx: any = { filters: {}, selectArg: null };
    const b: any = {
      select: (arg?: string) => { ctx.selectArg = arg; return b; },
      eq: (c: string, v: any) => { ctx.filters[c] = v; return b; },
      in: (c: string, v: any) => { ctx.filters[c] = v; return b; },
      order: () => b,
      limit: () => b,
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => b,
      delete: () => b,
      single: () => Promise.resolve(resolveQuery(table, ctx)),
      maybeSingle: () => Promise.resolve(resolveQuery(table, ctx)),
      then: (ok: any, err: any) => Promise.resolve(resolveQuery(table, ctx)).then(ok, err),
    };
    return b;
  },
  rpc: (_name: string, _params: any) => Promise.resolve({ data: state.candidates, error: null }),
};

// Importa a edge function REAL — dispara o Deno.serve stubbado e captura o handler.
import "../../supabase/functions/process-copilot-followups/index.ts";

// ── Helpers de fixture ───────────────────────────────────────────────────────
const ORG = "org-do-agente";
const ONTEM = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

function makeRule(over: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    agent_id: "agent-1",
    trigger_type: "no_response",
    trigger_delay_hours: 24,
    trigger_delay_minutes: 0,
    max_followups: 3,
    filter_tags: [],
    filter_tags_exclude: [],
    filter_origins: [],
    filter_pipes: [],
    filter_stages: [],
    message_template: "Oi {nome}, tudo bem?",
    use_last_context: false,
    followup_style: null,
    // false → getNextSendTime (módulo REAL) devolve o próprio qualifiedAt,
    // então o agendamento nunca é o motivo do skip nestes casos.
    send_only_business_hours: false,
    business_hours_start: "09:00",
    business_hours_end: "18:00",
    send_days: ["seg", "ter", "qua", "qui", "sex"],
    timezone: "America/Sao_Paulo",
    sequence_steps: null,
    copilot_agents: { organization_id: ORG, whatsapp_instance_id: "inst-1" },
    ...over,
  };
}

/** Lead com o espelho legado PREENCHIDO — a condição em que a regressão acontece. */
function makeLead(id: string, espelhoCongelado: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Lead ${id}`,
    company: "Empresa",
    phone: "5511999990000",
    email: "a@b.com",
    origin: "meta_ads",
    segment: "b2b",
    ai_disabled: false,
    // ── ESPELHO LEGADO congelado (ADR-0023 decisão 10) ──
    pipe_whatsapp: espelhoCongelado,
    lead_tags: [],
    upsell_clients: [],
    campanha_leads: [],
    ...over,
  };
}

async function runCron() {
  const req = new Request("http://localhost/process-copilot-followups", {
    method: "POST",
    headers: { "x-cron-secret": envStore.CRON_SECRET, "Content-Type": "application/json" },
  });
  const res = await getHandler()(req);
  return { res, body: await res.json() };
}

beforeEach(() => {
  state.rules = [];
  state.candidates = [];
  state.leads = [];
  state.execRows = [];
  state.entries = { whatsapp: [], confirmacao: [], propostas: [] };
  state.leadsSelectArgs = [];
  state.adapterCalls = [];
  state.sends = [];
});

// ═════════════════════════════════════════════════════════════════════════════
describe("process-copilot-followups — filter_pipes decide pelo Negócio, nunca pelo espelho leads.pipe_whatsapp", () => {
  it("não manda follow-up de WhatsApp para lead cujo Negócio saiu do funil por MOVE, mesmo com o espelho congelado em 'compareceu'", async () => {
    // Cenário exato do ADR-0023: o Negócio avançou para Orçamentos/propostas.
    // O trigger não escreve nada na move, então leads.pipe_whatsapp ficou
    // parado em 'compareceu' para sempre. Não há entry no funil whatsapp.
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [{ lead_id: "lead-vendido", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-vendido", "compareceu")];
    state.entries.whatsapp = []; // Negócio NÃO está mais aqui
    state.entries.propostas = [{ lead_id: "lead-vendido", stage_key: "vendido" }];

    const { body } = await runCron();

    expect(state.sends).toEqual([]);
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it("manda follow-up quando o Negócio está de fato aberto no funil WhatsApp — o filtro não é um bloqueio cego", async () => {
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [{ lead_id: "lead-ativo", last_outgoing_at: ONTEM }];
    // Espelho VAZIO e Negócio PRESENTE: o inverso do caso anterior. Se a decisão
    // lesse o espelho, este lead seria injustamente pulado.
    state.leads = [makeLead("lead-ativo", null)];
    state.entries.whatsapp = [{ lead_id: "lead-ativo", stage_key: "abordado" }];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-ativo"]);
    expect(body.sent).toBe(1);
  });

  it("separa dois leads do MESMO lote pelo Negócio: quem moveu fica de fora, quem continua no funil recebe", async () => {
    // Prova que a decisão é por lead a partir da entry, e não um efeito global
    // do lote (um filtro que zera tudo passaria nos dois casos acima isolados).
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [
      { lead_id: "lead-moveu", last_outgoing_at: ONTEM },
      { lead_id: "lead-ficou", last_outgoing_at: ONTEM },
    ];
    state.leads = [
      makeLead("lead-moveu", "agendado"), // espelho congelado mentindo
      makeLead("lead-ficou", "agendado"),
    ];
    state.entries.whatsapp = [{ lead_id: "lead-ficou", stage_key: "agendado" }];
    state.entries.propostas = [{ lead_id: "lead-moveu", stage_key: "enviada" }];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-ficou"]);
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("filter_pipes casa por OR entre funis: o mesmo lead que moveu entra quando 'propostas' está na regra", async () => {
    // Fronteira: o skip do primeiro caso é por AUSÊNCIA no funil pedido, não
    // por o lead ter "sumido". Com o funil de destino na regra, ele volta.
    state.rules = [makeRule({ filter_pipes: ["whatsapp", "propostas"] })];
    state.candidates = [{ lead_id: "lead-moveu", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-moveu", "compareceu")];
    state.entries.propostas = [{ lead_id: "lead-moveu", stage_key: "enviada" }];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-moveu"]);
    expect(body.sent).toBe(1);
  });

  it("filter_pipes vazio não filtra nada: lead sem Negócio nenhum ainda recebe (ausência de filtro ≠ exclusão)", async () => {
    state.rules = [makeRule({ filter_pipes: [] })];
    state.candidates = [{ lead_id: "lead-sem-funil", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-sem-funil", null)];

    const { body } = await runCron();

    expect(body.sent).toBe(1);
  });

  it("lead sem Negócio em funil algum é pulado quando a regra exige um funil — ausência não vira match", async () => {
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [{ lead_id: "lead-orfao", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-orfao", null)];

    const { body } = await runCron();

    expect(state.sends).toEqual([]);
    expect(body.skipped).toBe(1);
  });

  it("funis que não são Negócio continuam valendo: upsell_base casa por upsell_clients, sem entry de pipeline", async () => {
    // Guarda de escopo: a repontuação para o Negócio cobre os TRÊS funis de
    // sistema. Se alguém apagar o bloco inteiro em vez de trocar a fonte,
    // upsell/campanha param de casar e este caso reprova.
    state.rules = [makeRule({ filter_pipes: ["upsell_base"] })];
    state.candidates = [{ lead_id: "lead-carteira", last_outgoing_at: ONTEM }];
    state.leads = [
      makeLead("lead-carteira", null, {
        upsell_clients: [{ tipo_cliente_tempo: "recorrente", gestao_stage: null }],
      }),
    ];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-carteira"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("process-copilot-followups — filter_stages lê o stage do Negócio, nunca o do espelho", () => {
  it("não dispara 'ainda não agendou' para quem o espelho ainda mostra em 'agendado' mas cujo Negócio já foi vendido", async () => {
    // O dano de produção descrito em inv:H4-03, na sua forma mais literal.
    state.rules = [
      makeRule({
        filter_stages: ["agendado"],
        message_template: "Oi {nome}, vi que você ainda não agendou.",
      }),
    ];
    state.candidates = [{ lead_id: "lead-comprou", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-comprou", "agendado")];
    state.entries.whatsapp = [];
    state.entries.propostas = [{ lead_id: "lead-comprou", stage_key: "vendido" }];

    const { body } = await runCron();

    expect(state.sends).toEqual([]);
    expect(body.skipped).toBe(1);
  });

  it("o stage que casa é o do Negócio: espelho parado em 'novo' não impede match em 'agendado' vindo da entry", async () => {
    state.rules = [makeRule({ filter_stages: ["agendado"] })];
    state.candidates = [{ lead_id: "lead-avancou", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-avancou", "novo")]; // espelho desatualizado para trás
    state.entries.whatsapp = [{ lead_id: "lead-avancou", stage_key: "agendado" }];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-avancou"]);
    expect(body.sent).toBe(1);
  });

  it("filter_stages enxerga stage dos funis confirmacao e propostas, também pela entry", async () => {
    state.rules = [makeRule({ filter_stages: ["enviada"] })];
    state.candidates = [{ lead_id: "lead-proposta", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-proposta", "compareceu")];
    state.entries.propostas = [{ lead_id: "lead-proposta", stage_key: "enviada" }];

    const { body } = await runCron();

    expect(state.sends.map((s) => s.leadId)).toEqual(["lead-proposta"]);
  });

  it("filter_pipes e filter_stages são AND: bater o funil pelo Negócio não basta se o stage do Negócio não bate", async () => {
    state.rules = [makeRule({ filter_pipes: ["whatsapp"], filter_stages: ["agendado"] })];
    state.candidates = [{ lead_id: "lead-atrasado", last_outgoing_at: ONTEM }];
    // Espelho diria 'agendado' e o lead passaria; a entry diz 'abordado'.
    state.leads = [makeLead("lead-atrasado", "agendado")];
    state.entries.whatsapp = [{ lead_id: "lead-atrasado", stage_key: "abordado" }];

    const { body } = await runCron();

    expect(state.sends).toEqual([]);
    expect(body.skipped).toBe(1);
  });

  it("stage vazio na entry não vira match: allStages descarta string vazia antes de comparar", async () => {
    // Fronteira do `.filter(Boolean)`. Sem ele, uma regra com filter_stages
    // contendo "" casaria com todo mundo.
    state.rules = [makeRule({ filter_stages: [""] })];
    state.candidates = [{ lead_id: "lead-x", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-x", "compareceu")];
    state.entries.whatsapp = [{ lead_id: "lead-x", stage_key: "abordado" }];

    const { body } = await runCron();

    expect(state.sends).toEqual([]);
    expect(body.skipped).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("process-copilot-followups — contrato de leitura do funil", () => {
  it("consulta os TRÊS funis de sistema pelo adapter de Negócio, com os leads do lote e a org do agente", async () => {
    // Multi-tenant: a org vem da junção copilot_agents, não do corpo da regra.
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [{ lead_id: "lead-a", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-a", null)];
    state.entries.whatsapp = [{ lead_id: "lead-a", stage_key: "abordado" }];

    await runCron();

    expect(state.adapterCalls.map((c) => c.slug).sort()).toEqual([
      "confirmacao",
      "propostas",
      "whatsapp",
    ]);
    for (const call of state.adapterCalls) {
      expect(call.orgId).toBe(ORG);
      expect(call.leadIds).toEqual(["lead-a"]);
    }
  });

  it("o SELECT de leads não pede a coluna-espelho pipe_whatsapp (complemento: a prova principal é comportamental, acima)", async () => {
    state.rules = [makeRule({ filter_pipes: ["whatsapp"] })];
    state.candidates = [{ lead_id: "lead-a", last_outgoing_at: ONTEM }];
    state.leads = [makeLead("lead-a", null)];
    state.entries.whatsapp = [{ lead_id: "lead-a", stage_key: "abordado" }];

    await runCron();

    expect(state.leadsSelectArgs.length).toBeGreaterThan(0);
    for (const sel of state.leadsSelectArgs) {
      expect(sel).not.toMatch(/pipe_whatsapp/);
    }
  });
});
