// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { moveStage } from "../../supabase/functions/_shared/action-handlers/move-stage";
import { __resetDealPolicyCache } from "../../supabase/functions/_shared/deal-policy";

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
      { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      { stage_key: "agendado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
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
      { stage_key: "marcada", organization_id: "org-1", pipeline_type: "confirmacao", is_active: true },
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

  it("moves lead in custom pipeline — validates stage and upserts custom_pipe_entries", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    const customPipeId = "custom-pipe-uuid";
    const stageId = "custom-stage-uuid";
    mockTable("custom_pipeline_stages", [{
      id: stageId, pipeline_id: customPipeId, organization_id: "org-1",
      is_final_positive: false, target_pipeline_id: null, target_stage_id: null,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: stageId, target_pipe: customPipeId },
    });

    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe(customPipeId);
    const inserted = getInserted("custom_pipe_entries");
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatchObject({ lead_id: "lead-1", pipeline_id: customPipeId, stage_id: stageId });
  });

  it("custom pipeline auto-transition — on is_final_positive, creates entry in target pipeline", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    const sourcePipeId = "source-pipe";
    const targetPipeId = "target-pipe";
    const sourceStageId = "source-stage-final";
    const targetStageId = "target-stage-initial";

    mockTable("custom_pipeline_stages", [{
      id: sourceStageId, pipeline_id: sourcePipeId, organization_id: "org-1",
      is_final_positive: true, target_pipeline_id: targetPipeId, target_stage_id: targetStageId,
      target_pipe_type: null, target_stage_key: null,
    }]);
    mockTable("custom_pipe_entries", []);

    const result = await moveStage({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { target_stage: sourceStageId, target_pipe: sourcePipeId },
    });

    expect(result.success).toBe(true);
    const entries = getInserted("custom_pipe_entries");
    // Should have 2 entries: source pipeline + auto-transition to target pipeline
    expect(entries.length).toBe(2);
    expect(entries[1]).toMatchObject({ pipeline_id: targetPipeId, stage_id: targetStageId });
  });

  it("rejects invalid stage for standard pipe", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
      { stage_key: "agendado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
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
    mockTable("custom_pipeline_stages", []);
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

    const source = (): Record<string, unknown>[] =>
      table === "custom_pipeline_stages"
        ? (stages as unknown as Record<string, unknown>[])
        : table === "custom_pipe_entries"
          ? (entries as unknown as Record<string, unknown>[])
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
      return rows.map((r) => ({ id: r.id, stage: roleOf(r.stage_id) }));
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
      if (table === "custom_pipe_entries") {
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

  return { sb: { from } as never, entries, inserted, updated };
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

function move(sb: never, stageId: string, pipelineId = PIPE) {
  return moveStage({
    supabase: sb,
    organizationId: ORG,
    leadId: "lead-1",
    conversationId: null,
    params: { target_stage: stageId, target_pipe: pipelineId },
  });
}

describe("moveStage — funil customizado não duplica card (inv:H4-08 / SCRUM-102)", () => {
  beforeEach(() => {
    // `isDealManualOnly` cacheia por org durante 30s; sem limpar, o primeiro caso
    // decidiria a política de todos os seguintes.
    __resetDealPolicyCache();
  });

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

  it("negócio em OUTRO funil customizado não conta como existente — insere no funil pedido", async () => {
    // Fronteira oposta: deduplicar por `lead_id` sozinho apagaria a regra de que
    // um lead pode estar em vários funis ao mesmo tempo. O filtro é o PAR.
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
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ pipeline_id: PIPE, stage_id: "st-open-1", lead_id: "lead-1" });
    expect(db.updated).toHaveLength(0);
    expect(db.entries).toHaveLength(2);
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
    // Um único INSERT: o card na origem. O destino é MOVIDO, não recriado.
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ pipeline_id: PIPE, stage_id: "st-final" });
    expect(db.updated.map((u) => u.id)).toEqual(["entry-destino"]);
    expect(db.entries.find((e) => e.id === "entry-destino")!.stage_id).toBe("st-destino-2");
    expect(db.entries.filter((e) => e.pipeline_id === destino)).toHaveLength(1);
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
