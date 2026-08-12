import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Supabase chain mock — captura insert/update/eq por tabela.
//
// O mock anterior só implementava `select/eq/maybeSingle/insert/update` e casava
// exatamente com o código antigo. Depois do M1 o leitor deixou de usar
// `.maybeSingle()` (com N linhas o postgrest-js zera `data` e devolve PGRST116,
// o que fazia "existem 2" virar "não existe") e passou a encadear `.order()` x3
// + `.limit()` — então o mock precisa da cadeia inteira, e o terminal devolve
// LISTA, não linha. A cadeia é thenable para que `await` funcione em qualquer
// ponto dela, como no cliente real.
// ---------------------------------------------------------------------------
const calls: { table: string; op: string; payload: unknown }[] = [];
const eqCalls: [string, unknown][] = [];
type Row = { id: string; stage: { stage_role: string } | null };
let existingRows: Row[] = [];
let readError: { message: string } | null = null;

function makeChain(table: string) {
  const chain: Record<string, any> = {};
  ["select", "order", "limit"].forEach((m) => (chain[m] = vi.fn().mockReturnValue(chain)));
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  chain.insert = vi.fn((payload: unknown) => {
    calls.push({ table, op: "insert", payload });
    return chain;
  });
  chain.update = vi.fn((payload: unknown) => {
    calls.push({ table, op: "update", payload });
    return chain;
  });
  // Thenable: `await` em qualquer ponto resolve como o cliente real.
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: existingRows, error: readError }).then(resolve, reject);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeChain(table) },
}));

import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";

const aberto = (id: string): Row => ({ id, stage: { stage_role: "open" } });
const ganho = (id: string): Row => ({ id, stage: { stage_role: "won" } });

describe("upsertLeadIntoCustomPipe", () => {
  beforeEach(() => {
    calls.length = 0;
    eqCalls.length = 0;
    existingRows = [];
    readError = null;
  });

  it("insere nova entry quando o lead ainda não está no funil destino", async () => {
    existingRows = [];

    await upsertLeadIntoCustomPipe({
      leadId: "lead-1",
      organizationId: "org-1",
      targetPipelineId: "pipe-X",
      targetStageId: "stage-Y",
    });

    const insert = calls.find((c) => c.op === "insert");
    expect(insert).toBeTruthy();
    expect(insert!.table).toBe("custom_pipe_entries");
    expect(insert!.payload).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      pipeline_id: "pipe-X",
      stage_id: "stage-Y",
    });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("move a entry existente (sem duplicar) quando o lead já está no funil destino", async () => {
    existingRows = [aberto("entry-99")];

    await upsertLeadIntoCustomPipe({
      leadId: "lead-1",
      organizationId: "org-1",
      targetPipelineId: "pipe-X",
      targetStageId: "stage-Z",
    });

    const update = calls.find((c) => c.op === "update");
    expect(update).toBeTruthy();
    expect(update!.table).toBe("custom_pipe_entries");
    expect(update!.payload).toMatchObject({ stage_id: "stage-Z" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("com N entries, move a ABERTA e nunca a ganha — e não insere outra", async () => {
    // O cenário que o M1 tornou possível: recompra. A ganha vem PRIMEIRO na
    // ordem do SQL de propósito — se a escolha fosse "a primeira linha", o
    // negócio ganho seria movido para fora da etapa de ganho, e é isso que
    // dispara `sale_reversed`, que é irreversível (decisão G do CTO).
    existingRows = [ganho("entry-ganha"), aberto("entry-aberta")];

    await upsertLeadIntoCustomPipe({
      leadId: "lead-1",
      organizationId: "org-1",
      targetPipelineId: "pipe-X",
      targetStageId: "stage-Z",
    });

    expect(calls.some((c) => c.op === "insert")).toBe(false);
    const update = calls.find((c) => c.op === "update");
    expect(update).toBeTruthy();
    expect(eqCalls).toContainEqual(["id", "entry-aberta"]);
    expect(eqCalls).not.toContainEqual(["id", "entry-ganha"]);
  });

  it("falha de leitura NÃO vira insert — o erro propaga", async () => {
    // Antes do conserto o erro era descartado e caía no ramo do INSERT: cada
    // falha transitória de rede criava um negócio duplicado, permanente e
    // visível no kanban do cliente.
    readError = { message: "boom" };

    await expect(
      upsertLeadIntoCustomPipe({
        leadId: "lead-1",
        organizationId: "org-1",
        targetPipelineId: "pipe-X",
        targetStageId: "stage-Z",
      }),
    ).rejects.toBeTruthy();

    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});
