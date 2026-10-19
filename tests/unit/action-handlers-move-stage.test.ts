// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { moveStage } from "../../supabase/functions/_shared/action-handlers/move-stage";
import { __clearPipelineResolutionCache } from "../../supabase/functions/_shared/pipeline-adapter";

// SCRUM-627: moveStage resolve o funil pelo adapter (cache module-level por
// org+ref) e a etapa por `pipeline_stages`. Cache limpo entre casos para as
// seeds de cada um valerem.
beforeEach(() => __clearPipelineResolutionCache());

function makeInput(overrides: Record<string, unknown> = {}) {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params: { target_stage: "agendado", target_pipe: "whatsapp" },
    ...overrides,
  };
}

describe("moveStage — shared action handler", () => {
  it("returns error when leadId is null", async () => {
    const result = await moveStage(makeInput({ leadId: null }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when target_stage is missing", async () => {
    const result = await moveStage(makeInput({ params: { target_pipe: "whatsapp" } }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("target_stage");
  });

  it("moves lead in whatsapp pipe — upserts pipeline_entries and updates leads.pipe_whatsapp", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pipeline_stages", [
      { id: "st-novo", stage_key: "novo", organization_id: "org-1", pipeline_id: "pipe-wpp-id", pipeline_type: "whatsapp", is_active: true },
      { id: "st-agendado", stage_key: "agendado", organization_id: "org-1", pipeline_id: "pipe-wpp-id", pipeline_type: "whatsapp", is_active: true },
    ]);
    mockTable("pipelines", [{ id: "pipe-wpp-id", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "agendado", target_pipe: "whatsapp" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_stage).toBe("agendado");
    expect(result.data?.target_pipe).toBe("whatsapp");
    const inserted = getInserted("pipeline_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ stage_key: "agendado", lead_id: "lead-1" });
  });

  it("moves lead in confirmacao pipe — upserts pipeline_entries only (no leads update)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("pipeline_stages", [
      { id: "st-marcada", stage_key: "marcada", organization_id: "org-1", pipeline_id: "pipe-conf-id", pipeline_type: "confirmacao", is_active: true },
    ]);
    mockTable("pipelines", [{ id: "pipe-conf-id", organization_id: "org-1", slug: "confirmacao", type: "system" }]);
    mockTable("pipeline_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "marcada", target_pipe: "confirmacao" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("confirmacao");
    const inserted = getInserted("pipeline_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ stage_key: "marcada" });
  });

  it("moves lead in upsell_base pipe — updates upsell_clients.tipo_cliente_tempo", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("upsell_clients", [{ lead_id: "lead-1", tipo_cliente_tempo: "ativo" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "inativo", target_pipe: "upsell_base" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("upsell_base");
  });

  it("moves lead in upsell_gestao pipe — updates upsell_clients.gestao_stage", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("upsell_clients", [{ lead_id: "lead-1", gestao_stage: "onboarding" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "ativo", target_pipe: "upsell_gestao" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("upsell_gestao");
  });

  it("moves lead in campanha pipe — looks up stage by name and updates campanha_leads", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("campanha_stages", [{ id: "cs-1", name: "Engajado" }]);
    mockTable("campanha_leads", [{ lead_id: "lead-1", stage_id: "cs-0" }]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "engajado", target_pipe: "campanha" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("campanha");
  });

  it("moves lead in custom pipeline — validates stage and calls canonical create RPC", async () => {
    const { sb, mockTable, mockRpc, getRpcCalls } = createMockSupabase();
    const customPipeId = "custom-pipe-uuid";
    const stageId = "custom-stage-uuid";
    // SCRUM-627: o funil resolve pelo adapter (`pipelines`) e a etapa pela
    // tabela unificada `pipeline_stages` — as seeds acompanham.
    mockTable("pipelines", [{ id: customPipeId, organization_id: "org-1", slug: customPipeId, type: "custom", is_active: true }]);
    mockTable("pipeline_stages", [{
      id: stageId, stage_key: stageId, pipeline_id: customPipeId, organization_id: "org-1", is_active: true,
      is_final_positive: false, target_pipeline_id: null, target_stage_id: null,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);
    mockRpc("fn_entrada_custom_criar", { id: "entry-created" });

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: stageId, target_pipe: customPipeId },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe(customPipeId);
    expect(getRpcCalls()).toContainEqual({
      name: "fn_entrada_custom_criar",
      params: expect.objectContaining({
        p_lead_id: "lead-1",
        p_organization_id: "org-1",
        p_pipeline_id: customPipeId,
        p_stage_id: stageId,
      }),
    });
  });

  it("custom pipeline auto-transition — on is_final_positive, creates entry in target pipeline", async () => {
    const { sb, mockTable, mockRpc, getRpcCalls } = createMockSupabase();
    const sourcePipeId = "source-pipe";
    const targetPipeId = "target-pipe";
    const sourceStageId = "source-stage-final";
    const targetStageId = "target-stage-initial";

    mockTable("pipelines", [{ id: sourcePipeId, organization_id: "org-1", slug: sourcePipeId, type: "custom", is_active: true }]);
    mockTable("pipeline_stages", [{
      id: sourceStageId, stage_key: sourceStageId, pipeline_id: sourcePipeId, organization_id: "org-1", is_active: true,
      is_final_positive: true, target_pipeline_id: targetPipeId, target_stage_id: targetStageId,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);
    mockRpc("fn_entrada_custom_criar", { id: "entry-created" });

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: sourceStageId, target_pipe: sourcePipeId },
    });

    expect(result.success).toBe(true);
    const creates = getRpcCalls().filter((call) => call.name === "fn_entrada_custom_criar");
    expect(creates).toHaveLength(2);
    expect(creates[1].params).toEqual(expect.objectContaining({
      p_pipeline_id: targetPipeId,
      p_stage_id: targetStageId,
    }));
  });

  it("rejects invalid stage for standard pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-wpp-id", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_stages", [
      { id: "st-novo", stage_key: "novo", organization_id: "org-1", pipeline_id: "pipe-wpp-id", pipeline_type: "whatsapp", is_active: true },
      { id: "st-agendado", stage_key: "agendado", organization_id: "org-1", pipeline_id: "pipe-wpp-id", pipeline_type: "whatsapp", is_active: true },
    ]);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "inexistente", target_pipe: "whatsapp" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("inválida");
  });

  it("returns error for custom pipeline with invalid stage ID", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", [{ id: "some-uuid-pipeline", organization_id: "org-1", slug: "some-uuid-pipeline", type: "custom", is_active: true }]);
    mockTable("pipeline_stages", []);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "nonexistent-stage", target_pipe: "some-uuid-pipeline" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrada");
  });

  it("SCRUM-627: funil de destino inexistente devolve erro tipado do adapter", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipelines", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "x", target_pipe: "funil-que-nao-existe" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("pipeline_not_found");
  });

  it("SCRUM-627: funil custom aceita a etapa por STAGE_KEY além do uuid", async () => {
    const { sb, mockTable, mockRpc, getRpcCalls } = createMockSupabase();
    mockTable("pipelines", [{ id: "pipe-orc", organization_id: "org-1", slug: "orcamentos", type: "custom", is_active: true }]);
    mockTable("pipeline_stages", [{
      id: "st-triagem-id", stage_key: "triagem", pipeline_id: "pipe-orc", organization_id: "org-1", is_active: true,
      is_final_positive: false, target_pipeline_id: null, target_stage_id: null,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);
    mockRpc("fn_entrada_custom_criar", { id: "entry-created" });

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: "triagem", target_pipe: "orcamentos" },
    });

    expect(result.success).toBe(true);
    expect(getRpcCalls()).toContainEqual({
      name: "fn_entrada_custom_criar",
      params: expect.objectContaining({
        p_pipeline_id: "pipe-orc",
        p_stage_id: "st-triagem-id",
      }),
    });
  });
});

// ===========================================================================
// inv:H4-08 (SCRUM-102) — funil CUSTOMIZADO não duplica card
//
// POR QUE ESTES CASOS EXISTEM
// ---------------------------
// Até o M1, o par `(pipeline_id, lead_id)` era único em `custom_pipe_entries`.
// Quem escrevia podia ler com `.maybeSingle()` e confiar em "0 ou 1 linha", e o
// banco funcionava como rede de segurança: um INSERT indevido morria em 23505.
//
// Depois do M1 o cadeado saiu (recompra: o mesmo lead pode ter mais de um
// negócio no mesmo funil). Com N linhas, o postgrest-js ZERA o `data` e devolve
// PGRST116 em `.maybeSingle()` — ou seja, "existem 2" passa a ser indistinguível
// de "não existe". Neste caminho isso não é um erro de leitura qualquer: quem
// lê "não existe" INSERE. E este caminho é o do Copilot e dos workflows, que
// rodam sozinhos, em loop, sem ninguém olhando — o efeito é o mesmo lead ganhar
// mais um card no MESMO funil a cada passagem do agente.
//
// `moveStage` (`_shared/action-handlers/move-stage.ts`) é o motor único desses
// dois caminhos — `_shared/actions/index.ts:96,120` (ações de IA),
// `_shared/workflow-action-handler.ts:14` (nós de workflow), mais a API pública
// e o quick-blast. É por isso que a prova é feita AQUI e não numa cópia da
// regra: é esta função que roda em produção.
//
// A suíte acima já cobria o caminho de INSERT (funil custom vazio) e o de erro
// de etapa inválida. O que faltava — e é exatamente onde a duplicação nasce — é
// o caminho em que JÁ EXISTE entry: uma, várias, todas fechadas, ou em outro
// funil. É o que os casos abaixo cobrem.
//
// FAKE DE BANCO COM ESTADO
// ------------------------
// `createMockSupabase` não persiste INSERT de volta na tabela lida nem modela o
// embed `stage:custom_pipeline_stages(stage_role)`, e colapsa os três `.order()`
// num só. As duas coisas importam aqui: a prova central é "duas passagens
// seguidas geram UM card" (precisa de leitura-após-escrita) e a escolha do
// negócio corrente depende do papel da etapa e da ordenação completa. Por isso
// estes casos usam um fake local que:
//   - guarda as linhas de verdade (INSERT aparece na próxima leitura);
//   - resolve o embed pela FK `stage_id → custom_pipeline_stages.stage_role`;
//   - aplica a ordenação inteira (stage_changed_at, created_at, id — todos DESC,
//     NULLS LAST, espelhando `nullsFirst: false` da query de produção).
// O fake é o BANCO. A lógica sob teste continua sendo a de produção.
// ===========================================================================

type FakeStage = {
  id: string;
  pipeline_id: string;
  organization_id: string;
  stage_role?: "open" | "won" | "lost";
  is_final_positive?: boolean;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  target_pipe_type?: string | null;
  target_stage_key?: string | null;
};

type FakeEntry = {
  id: string;
  lead_id: string;
  organization_id: string;
  pipeline_id: string;
  stage_id: string;
  entered_at?: string | null;
  stage_changed_at?: string | null;
  created_at?: string | null;
};

/** DESC com NULLS LAST — espelha `.order(col, { ascending: false, nullsFirst: false })`. */
function descNullsLast(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

function createCustomPipeDb(opts: {
  stages: FakeStage[];
  entries?: FakeEntry[];
  /** Erro devolvido pela LEITURA de `custom_pipe_entries` (simula falha transitória). */
  entriesReadError?: { message: string } | null;
  featureFlags?: Record<string, unknown>;
}) {
  const stages = opts.stages.map((s) => ({ ...s }));
  const entries: FakeEntry[] = (opts.entries ?? []).map((e) => ({ ...e }));
  const inserted: FakeEntry[] = [];
  const updated: Array<{ id: string; payload: Record<string, unknown> }> = [];
  let seq = 0;

  const roleOf = (stageId: string) => {
    const s = stages.find((x) => x.id === stageId);
    return s ? { stage_role: s.stage_role ?? "open" } : null;
  };

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> | null = null;

    // SCRUM-627: moveStage resolve o funil por `pipelines` e a etapa por
    // `pipeline_stages` (tabela unificada). O fake serve as duas derivando das
    // MESMAS stages — id vira slug/stage_key, então os refs dos casos valem
    // tanto como uuid quanto como key.
    const pipelineRows = (): Record<string, unknown>[] => {
      const ids = [...new Set(stages.map((st) => st.pipeline_id))];
      return ids.map((id) => ({
        id, slug: id, name: id, type: "custom", is_active: true,
        organization_id: stages.find((st) => st.pipeline_id === id)!.organization_id,
      }));
    };
    const unifiedStageRows = (): Record<string, unknown>[] =>
      stages.map((st) => ({
        stage_key: st.id, is_active: true,
        is_final_positive: st.is_final_positive ?? false,
        target_pipeline_id: st.target_pipeline_id ?? null,
        target_stage_id: st.target_stage_id ?? null,
        target_pipe_type: st.target_pipe_type ?? null,
        target_stage_key: st.target_stage_key ?? null,
        ...st,
      }));

    const projectedEntries = (): Record<string, unknown>[] =>
      entries.map((entry) => ({
        ...entry,
        pipeline_type: "custom",
        stage_role: roleOf(entry.stage_id)?.stage_role ?? "open",
      }));

    // `pipeline_entries` é a tabela que `moverNegocioQueDisparou` lê pelo
    // `entryId`. No fake a etapa é identificada pelo id, então `stage_key`
    // deriva de `stage_id` — a mesma convenção de `unifiedStageRows`.
    const rawEntries = (): Record<string, unknown>[] =>
      entries.map((entry) => ({ ...entry, stage_key: entry.stage_id }));

    const source = (): Record<string, unknown>[] =>
      table === "custom_pipeline_stages"
        ? (stages as unknown as Record<string, unknown>[])
        : table === "pipeline_stages"
          ? unifiedStageRows()
        : table === "pipelines"
          ? pipelineRows()
        : table === "negocio_projetado"
          ? projectedEntries()
        : table === "pipeline_entries"
          ? rawEntries()
          : table === "organizations"
            ? [{ id: "__any__", feature_flags: opts.featureFlags ?? {} }]
            : [];

    const matched = () =>
      source().filter((row) =>
        filters.every(([col, val]) =>
          // `organizations` é linha única no fake; o filtro por id é irrelevante.
          table === "organizations" ? true : row[col] === val,
        ),
      );

    const readEntries = () => {
      const rows = matched().slice() as unknown as FakeEntry[];
      rows.sort(
        (a, b) =>
          descNullsLast(a.stage_changed_at, b.stage_changed_at) ||
          descNullsLast(a.created_at, b.created_at) ||
          descNullsLast(a.id, b.id),
      );
      return rows.map((r) => ({
        id: r.id,
        pipeline_id: r.pipeline_id,
        stage_role: roleOf(r.stage_id)?.stage_role ?? "open",
      }));
    };

    const run = () => {
      if (mode === "insert") {
        const row = { id: `gen-${++seq}`, ...(payload as unknown as FakeEntry) };
        entries.push(row);
        inserted.push(row);
        return { data: null, error: null };
      }
      if (mode === "update") {
        const rows = matched();
        for (const row of rows) {
          Object.assign(row, payload);
          updated.push({ id: row.id as string, payload: { ...(payload as object) } });
        }
        return { data: null, error: null };
      }
      if (table === "negocio_projetado") {
        if (opts.entriesReadError) return { data: null, error: opts.entriesReadError };
        return { data: readEntries(), error: null };
      }
      return { data: matched(), error: null };
    };

    const chain: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) chain[m] = () => chain;
    chain.eq = (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    };
    chain.insert = (rows: Record<string, unknown>) => {
      mode = "insert";
      payload = rows;
      return chain;
    };
    chain.update = (vals: Record<string, unknown>) => {
      mode = "update";
      payload = vals;
      return chain;
    };
    chain.maybeSingle = () => {
      const res = run() as { data: unknown; error: unknown };
      const list = (res.data ?? []) as unknown[];
      return Promise.resolve({ data: list[0] ?? null, error: res.error });
    };
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(run()).then(resolve, reject);
    return chain;
  }

  async function rpc(name: string, params: Record<string, unknown>) {
    if (name === "fn_entrada_custom_criar") {
      const row: FakeEntry = {
        id: `gen-${++seq}`,
        lead_id: params.p_lead_id as string,
        organization_id: params.p_organization_id as string,
        pipeline_id: params.p_pipeline_id as string,
        stage_id: params.p_stage_id as string,
        entered_at: params.p_entered_at as string,
        stage_changed_at: params.p_stage_changed_at as string,
        created_at: params.p_entered_at as string,
      };
      entries.push(row);
      inserted.push(row);
      return { data: row, error: null };
    }
    if (name === "fn_entrada_custom_atualizar") {
      const entry = entries.find((row) => row.id === params.p_entry_id);
      if (!entry) return { data: null, error: { message: "entry not found" } };
      const payload = params.p_patch as Record<string, unknown>;
      Object.assign(entry, payload);
      updated.push({ id: entry.id, payload: { ...payload } });
      return { data: entry, error: null };
    }
    // Espelha `public.mover_negocio` (20271119000002): valida a etapa DENTRO do
    // funil de destino, funde com o card que o lead já tem lá (devolvendo o id
    // sobrevivente) e, no caso comum, MOVE a própria linha — mesmo id, novo
    // funil. É o MOVE do ADR-0023 §4, por oposição ao INSERT do caminho custom.
    if (name === "mover_negocio") {
      const entry = entries.find((row) => row.id === params.p_entry_id);
      if (!entry) return { data: null, error: { message: "Negócio não encontrado." } };

      const alvoPipe = params.p_target_pipeline_id as string;
      const alvoStage = params.p_target_stage_key as string;
      if (!stages.some((s) => s.pipeline_id === alvoPipe && s.id === alvoStage)) {
        return { data: null, error: { message: `Etapa "${alvoStage}" não existe no funil ${alvoPipe}.` } };
      }

      // Passo 2a da RPC: chegando onde o lead já tem card, o de lá sobrevive.
      const existente = entries.find(
        (row) => row.id !== entry.id && row.pipeline_id === alvoPipe && row.lead_id === entry.lead_id,
      );
      if (existente) {
        entries.splice(entries.indexOf(entry), 1);
        updated.push({ id: existente.id, payload: { stage_id: alvoStage } });
        return { data: existente.id, error: null };
      }

      Object.assign(entry, { pipeline_id: alvoPipe, stage_id: alvoStage });
      updated.push({ id: entry.id, payload: { pipeline_id: alvoPipe, stage_id: alvoStage } });
      return { data: entry.id, error: null };
    }
    return { data: null, error: { message: `RPC not mocked: ${name}` } };
  }

  return { sb: { from, rpc } as never, entries, inserted, updated };
}

const ORG = "org-h4-08";
const PIPE = "pipe-custom-h4-08";

/** Etapas do funil custom sob teste: uma aberta, uma ganha, uma perdida. */
const STAGES: FakeStage[] = [
  { id: "st-open-1", pipeline_id: PIPE, organization_id: ORG, stage_role: "open" },
  { id: "st-open-2", pipeline_id: PIPE, organization_id: ORG, stage_role: "open" },
  { id: "st-won", pipeline_id: PIPE, organization_id: ORG, stage_role: "won" },
  { id: "st-lost", pipeline_id: PIPE, organization_id: ORG, stage_role: "lost" },
];

function move(sb: never, stageId: string, pipelineId = PIPE, entryId?: string) {
  return moveStage({
    supabase: sb,
    organizationId: ORG,
    leadId: "lead-1",
    conversationId: null,
    ...(entryId ? { entryId } : {}),
    params: { target_stage: stageId, target_pipe: pipelineId },
  });
}

describe("moveStage — funil customizado não duplica card (inv:H4-08 / SCRUM-102)", () => {
  // O `beforeEach` que limpava o cache de `isDealManualOnly` saiu junto com o
  // gate: a #1774 apagou `_shared/deal-policy.ts` e deixou este import órfão,
  // o que impedia o arquivo de COLETAR (0 testes rodavam).
  it("com negócio já aberto no funil, MOVE o card existente e não cria um segundo", async () => {
    const db = createCustomPipeDb({
      stages: STAGES,
      entries: [{
        id: "entry-aberta", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
        stage_id: "st-open-1", stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T09:00:00Z",
      }],
    });

    const result = await move(db.sb, "st-open-2");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(1);
    expect(db.updated.map((u) => u.id)).toEqual(["entry-aberta"]);
    expect(db.entries[0].stage_id).toBe("st-open-2");
  });

  it("com DOIS negócios no mesmo funil, move o ABERTO, deixa o ganho onde está e não insere um terceiro", async () => {
    // Cenário que só o M1 tornou possível: recompra. O ganho vem PRIMEIRO na
    // ordem do SQL (stage_changed_at mais recente) de propósito — se o critério
    // fosse "a primeira linha", o negócio ganho sairia da etapa de ganho, que é
    // o gatilho de `sale_reversed`, irreversível (decisão G do CTO).
    const db = createCustomPipeDb({
      stages: STAGES,
      entries: [
        {
          id: "entry-aberta", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
          stage_id: "st-open-1", stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T09:00:00Z",
        },
        {
          id: "entry-ganha", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
          stage_id: "st-won", stage_changed_at: "2026-08-04T10:00:00Z", created_at: "2026-07-01T09:00:00Z",
        },
      ],
    });

    const result = await move(db.sb, "st-open-2");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(2);
    expect(db.updated.map((u) => u.id)).toEqual(["entry-aberta"]);
    expect(db.entries.find((e) => e.id === "entry-ganha")!.stage_id).toBe("st-won");
    expect(db.entries.find((e) => e.id === "entry-aberta")!.stage_id).toBe("st-open-2");
  });

  it("com TODOS os negócios fechados, reabre o mais recente em vez de abrir mais um card", async () => {
    // Fronteira do critério: "não achei negócio ABERTO" não pode virar INSERT,
    // senão um lead com histórico de ganho/perda ganharia card novo a cada
    // passagem do agente — que é a duplicação vista pelo cliente no kanban.
    const db = createCustomPipeDb({
      stages: STAGES,
      entries: [
        {
          id: "entry-perdida", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
          stage_id: "st-lost", stage_changed_at: "2026-06-01T10:00:00Z", created_at: "2026-05-01T09:00:00Z",
        },
        {
          id: "entry-ganha", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
          stage_id: "st-won", stage_changed_at: "2026-08-04T10:00:00Z", created_at: "2026-07-01T09:00:00Z",
        },
      ],
    });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(2);
    // Mais recente por stage_changed_at DESC = a ganha.
    expect(db.updated.map((u) => u.id)).toEqual(["entry-ganha"]);
  });

  it("duas passagens seguidas do Copilot no MESMO funil produzem UM card, não dois", async () => {
    // A prova de fim-a-fim do defeito: o turn do Copilot roda em loop. Antes, a
    // segunda passagem lia "não existe" e inseria — e a terceira, e a quarta.
    const db = createCustomPipeDb({ stages: STAGES, entries: [] });

    const first = await move(db.sb, "st-open-1");
    const second = await move(db.sb, "st-open-2");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].stage_id).toBe("st-open-2");
  });

  it("cinco passagens seguidas continuam produzindo UM card", async () => {
    // Teto do loop: a garantia tem de ser invariante, não "aguenta duas".
    const db = createCustomPipeDb({ stages: STAGES, entries: [] });

    for (let i = 0; i < 5; i++) {
      const r = await move(db.sb, i % 2 === 0 ? "st-open-1" : "st-open-2");
      expect(r.success).toBe(true);
    }

    expect(db.entries).toHaveLength(1);
    expect(db.inserted).toHaveLength(1);
  });

  it("negócio ÚNICO aberto em OUTRO funil customizado é MOVIDO, não copiado (chamado 52b4f4ca)", async () => {
    // Este caso já existiu afirmando o CONTRÁRIO ("não conta como existente —
    // insere no funil pedido"), sob o argumento de que um lead pode estar em
    // vários funis ao mesmo tempo. O argumento é verdadeiro, mas não é deste
    // verbo: quem PÕE o lead num funil a mais é `duplicateToPipe`
    // (`_shared/action-handlers/pipe-operations.ts:72`). `move_stage` é MOVE —
    // ADR-0023 §4, "o Negócio guarda uma posição por vez, e avançar é um MOVE,
    // não uma cópia".
    //
    // Era exatamente este caminho que duplicava na Rafthel: gatilho
    // `lead_created` não traz `entryId`, o ramo custom ia direto para o INSERT
    // e o lead terminava com um card aberto em CADA funil.
    const outroPipe = "pipe-custom-outro";
    const db = createCustomPipeDb({
      stages: [
        ...STAGES,
        { id: "st-outro", pipeline_id: outroPipe, organization_id: ORG, stage_role: "open" },
      ],
      entries: [{
        id: "entry-outro-funil", lead_id: "lead-1", organization_id: ORG, pipeline_id: outroPipe,
        stage_id: "st-outro", stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T09:00:00Z",
      }],
    });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(1);
    // MESMO card: mesmo id, agora no funil pedido.
    expect(db.entries[0].id).toBe("entry-outro-funil");
    expect(db.entries[0].pipeline_id).toBe(PIPE);
    expect(db.entries[0].stage_id).toBe("st-open-1");
  });

  it("auto-transição is_final_positive não duplica card quando o lead já está no funil de destino", async () => {
    // O segundo sítio de INSERT do mesmo arquivo. A suíte acima cobre o destino
    // VAZIO (cria); aqui o destino já tem negócio — e a mesma regra tem de valer,
    // senão a duplicação só muda de linha.
    const destino = "pipe-custom-destino";
    const db = createCustomPipeDb({
      stages: [
        {
          id: "st-final", pipeline_id: PIPE, organization_id: ORG, stage_role: "won",
          is_final_positive: true, target_pipeline_id: destino, target_stage_id: "st-destino-2",
        },
        { id: "st-destino-1", pipeline_id: destino, organization_id: ORG, stage_role: "open" },
        { id: "st-destino-2", pipeline_id: destino, organization_id: ORG, stage_role: "open" },
      ],
      entries: [{
        id: "entry-destino", lead_id: "lead-1", organization_id: ORG, pipeline_id: destino,
        stage_id: "st-destino-1", stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T09:00:00Z",
      }],
    });

    const result = await move(db.sb, "st-final");

    expect(result.success).toBe(true);
    // O invariante é de CONTAGEM: uma posição por funil, nunca duas.
    expect(db.inserted).toHaveLength(1);
    expect(db.entries.filter((e) => e.pipeline_id === destino)).toHaveLength(1);
    expect(db.entries.filter((e) => e.pipeline_id === PIPE)).toHaveLength(1);

    // Qual LINHA ocupa cada posição mudou com o chamado 52b4f4ca, e a mudança é
    // o conserto, não um efeito colateral: o card que o lead já tinha é MOVIDO
    // para a etapa pedida (antes ele ficava parado e nascia um gêmeo em PIPE) e
    // a auto-transição é que repõe a posição no funil de destino.
    expect(db.entries.find((e) => e.id === "entry-destino")).toMatchObject({
      pipeline_id: PIPE, stage_id: "st-final",
    });
    expect(db.inserted[0]).toMatchObject({ pipeline_id: destino, stage_id: "st-destino-2" });
  });

  it("falha ao LER custom_pipe_entries não vira INSERT — o erro propaga", async () => {
    // Ausência de resposta ≠ ausência de negócio. Se um soluço de rede caísse no
    // ramo do INSERT, cada falha transitória deixaria um card duplicado
    // permanente no kanban do cliente, sem ninguém para desfazer. Falhar alto é
    // recuperável: o próximo turn do agente tenta de novo.
    const db = createCustomPipeDb({
      stages: STAGES,
      entries: [],
      entriesReadError: { message: "connection reset" },
    });

    await expect(move(db.sb, "st-open-1")).rejects.toBeTruthy();

    expect(db.inserted).toHaveLength(0);
    expect(db.updated).toHaveLength(0);
    expect(db.entries).toHaveLength(0);
  });
});

// ===========================================================================
// CHAMADO 52b4f4ca — mover entre funis CUSTOM é MOVE, não cópia
// ---------------------------------------------------------------------------
// Sintoma na Rafthel: o nó `move_stage` de um workflow levava o lead de
// Comercial para Lead Ruim e o lead terminava com UM CARD ABERTO EM CADA FUNIL.
//
// Duas causas somadas:
//   1. só o ramo de funil de SISTEMA tentava `moverNegocioQueDisparou` (a RPC
//      `mover_negocio`, que MOVE). O ramo custom ia para `moverOuCriarCardCustom`,
//      que anda o card já existente NO DESTINO ou cria um — a origem não sai do
//      lugar, logo o resultado é cópia. O comentário que justificava isso ("a
//      RPC recusa destino custom") estava velho: desde
//      `20271119000002_preserve_closed_card_on_forwarding.sql` a RPC valida a
//      etapa em `pipeline_stages` e aceita destino customizado;
//   2. no gatilho `lead_created` não existe `entryId` (é gatilho da pessoa, não
//      do negócio — `types.ts:20`), então nem o ramo de sistema saberia qual
//      card mover. Daí o fallback por card único aberto.
//
// Os casos abaixo fixam as duas pontas e, principalmente, as FRONTEIRAS: sem
// `entryId` só é seguro mover quando não há dúvida sobre qual card é o certo.
// ===========================================================================
describe("moveStage — funil custom MOVE em vez de copiar (chamado 52b4f4ca)", () => {
  const ORIGEM = "pipe-custom-origem";
  const STAGES_2F: FakeStage[] = [
    ...STAGES,
    { id: "st-origem", pipeline_id: ORIGEM, organization_id: ORG, stage_role: "open" },
    { id: "st-origem-won", pipeline_id: ORIGEM, organization_id: ORG, stage_role: "won" },
  ];
  const cardNaOrigem = (id = "entry-origem", stage = "st-origem") => ({
    id, lead_id: "lead-1", organization_id: ORG, pipeline_id: ORIGEM, stage_id: stage,
    stage_changed_at: "2026-08-01T10:00:00Z", created_at: "2026-08-01T09:00:00Z",
  });

  it("K1 — com entryId, MOVE o card que disparou: mesmo id, novo funil, nenhum card novo", async () => {
    const db = createCustomPipeDb({ stages: STAGES_2F, entries: [cardNaOrigem()] });

    const result = await move(db.sb, "st-open-1", PIPE, "entry-origem");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].id).toBe("entry-origem");
    expect(db.entries[0].pipeline_id).toBe(PIPE);
    expect(db.entries[0].stage_id).toBe("st-open-1");
  });

  it("K1b — com entryId, o card movido é O QUE DISPAROU, não o 'corrente' por heurística", async () => {
    // Dois cards abertos na origem. `moverOuCriarCardCustom` escolheria por
    // ordenação; com `entryId` não há escolha a fazer — move o que disparou.
    const db = createCustomPipeDb({
      stages: STAGES_2F,
      entries: [
        cardNaOrigem("entry-antigo", "st-origem"),
        { ...cardNaOrigem("entry-recente", "st-origem"), stage_changed_at: "2026-09-01T10:00:00Z" },
      ],
    });

    const result = await move(db.sb, "st-open-1", PIPE, "entry-antigo");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries.find((e) => e.id === "entry-antigo")!.pipeline_id).toBe(PIPE);
    expect(db.entries.find((e) => e.id === "entry-recente")!.pipeline_id).toBe(ORIGEM);
  });

  it("K2 — sem entryId e com UM card aberto em outro funil, MOVE esse card", async () => {
    const db = createCustomPipeDb({ stages: STAGES_2F, entries: [cardNaOrigem()] });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].id).toBe("entry-origem");
    expect(db.entries[0].pipeline_id).toBe(PIPE);
  });

  it("K2 — sem entryId e com ZERO card, cria no destino (comportamento antigo)", async () => {
    const db = createCustomPipeDb({ stages: STAGES_2F, entries: [] });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ pipeline_id: PIPE, stage_id: "st-open-1", lead_id: "lead-1" });
    expect(db.entries).toHaveLength(1);
  });

  it("K2 — sem entryId e com DOIS cards abertos em outros funis, não chuta: cria no destino", async () => {
    const terceiro = "pipe-custom-terceiro";
    const db = createCustomPipeDb({
      stages: [
        ...STAGES_2F,
        { id: "st-terceiro", pipeline_id: terceiro, organization_id: ORG, stage_role: "open" },
      ],
      entries: [
        cardNaOrigem(),
        { ...cardNaOrigem("entry-terceiro", "st-terceiro"), pipeline_id: terceiro },
      ],
    });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.entries).toHaveLength(3);
    // Nenhum dos dois saiu do lugar.
    expect(db.entries.find((e) => e.id === "entry-origem")!.pipeline_id).toBe(ORIGEM);
    expect(db.entries.find((e) => e.id === "entry-terceiro")!.pipeline_id).toBe(terceiro);
  });

  it("K2 — sem entryId, card GANHO em outro funil não é movido (decisão G, sale_reversed)", async () => {
    // Tirar um negócio ganho da etapa de ganho dispara `sale_reversed`, que é
    // irreversível. Card fechado não é candidato: o lead ganha card novo.
    const db = createCustomPipeDb({
      stages: STAGES_2F,
      entries: [cardNaOrigem("entry-ganho", "st-origem-won")],
    });

    const result = await move(db.sb, "st-open-1");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(1);
    expect(db.entries.find((e) => e.id === "entry-ganho")!.pipeline_id).toBe(ORIGEM);
    expect(db.entries.find((e) => e.id === "entry-ganho")!.stage_id).toBe("st-origem-won");
  });

  it("K2 — card aberto JÁ no destino manda: anda de etapa lá e ignora o de fora", async () => {
    // Com card no destino não há o que mover de outro funil — o lead já está
    // aqui. Mexer no de fora seria esvaziar um funil que ninguém pediu.
    const db = createCustomPipeDb({
      stages: STAGES_2F,
      entries: [
        cardNaOrigem(),
        {
          id: "entry-destino", lead_id: "lead-1", organization_id: ORG, pipeline_id: PIPE,
          stage_id: "st-open-1", stage_changed_at: "2026-08-02T10:00:00Z", created_at: "2026-08-02T09:00:00Z",
        },
      ],
    });

    const result = await move(db.sb, "st-open-2");

    expect(result.success).toBe(true);
    expect(db.inserted).toHaveLength(0);
    expect(db.entries).toHaveLength(2);
    expect(db.entries.find((e) => e.id === "entry-destino")!.stage_id).toBe("st-open-2");
    expect(db.entries.find((e) => e.id === "entry-origem")!.pipeline_id).toBe(ORIGEM);
  });
});
