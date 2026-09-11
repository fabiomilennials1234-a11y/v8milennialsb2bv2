import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

type Row = {
  id: string;
  organization_id: string;
  pipeline_id: string;
  pipeline_type: string | null;
  name: string;
  stage_key: string;
  position: number;
  is_active: boolean;
};
const db = vi.hoisted(() => ({ rows: [] as Row[], readError: false }));

// Stateful PostgREST seam: both write surfaces share pipeline_stages, including
// inactive rows. Enforce the real UNIQUE(pipeline_id, stage_key/position).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: { p_input: Partial<Row> }) => {
      if (name !== "fn_etapa_custom_criar") throw new Error(`Unexpected RPC: ${name}`);
      const row: Row = {
        id: `s${db.rows.length}`, organization_id: "org1", pipeline_id: "p1",
        pipeline_type: null, name: "", stage_key: "", position: 0, is_active: true,
        ...args.p_input,
      };
      const conflict = db.rows.some(r => r.pipeline_id === row.pipeline_id &&
        (r.stage_key === row.stage_key || r.position === row.position));
      if (conflict) return { data: null, error: { code: "23505", message: 'duplicate key violates "pipeline_stages_pipeline_id_stage_key_key"' } };
      db.rows.push(row);
      return { data: row.id, error: null };
    },
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let payload: Partial<Row> | undefined;
      let limit = Infinity;
      const result = () => {
        if (db.readError) return { data: null, error: { message: "read failed" } };
        const rows = db.rows.filter(row => filters.every(([key, value]) => row[key as keyof Row] === value));
        return { data: [...rows].sort((a, b) => b.position - a.position).slice(0, limit), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        order: () => chain,
        limit: (n: number) => { limit = n; return chain; },
        insert: (value: Partial<Row>) => { payload = value; return chain; },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        single: async () => {
          if (!payload) {
            const response = result();
            return { data: response.data?.[0] ?? null, error: response.error };
          }
          const row: Row = {
            id: `s${db.rows.length}`, organization_id: "org1", pipeline_id: "p1",
            pipeline_type: null, name: "", stage_key: "", position: 0, is_active: true, ...payload,
          };
          const conflict = db.rows.find(r => r.pipeline_id === row.pipeline_id &&
            (r.stage_key === row.stage_key || r.position === row.position));
          if (conflict) return { data: null, error: { code: "23505", message: 'duplicate key violates "pipeline_stages_pipeline_id_stage_key_key"' } };
          db.rows.push(row);
          return { data: row, error: null };
        },
      };
      return chain;
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org1" } }),
  useCanDo: () => true,
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/pipelines/lib/stageTransition", () => ({ upsertLeadIntoCustomPipe: vi.fn() }));

import { useCreatePipelineStage } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { useCreateCustomPipelineStage } from "@/modules/pipelines/hooks/custom/useCustomPipelines";

beforeEach(() => { db.rows = []; db.readError = false; });

describe.each(["system", "custom"])("recriar etapa %s", kind => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => ({ system: useCreatePipelineStage(), custom: useCreateCustomPipelineStage() }), { wrapper });
    return async (name = "Em negociação") => {
      let created: unknown;
      await act(async () => {
        created = kind === "system"
          ? await result.current.system.mutateAsync({ name, stage_key: "em_negociacao", pipeline_type: "whatsapp", position: 0 })
          : await result.current.custom.mutateAsync({ name, pipeline_id: "p1", position: 0 });
      });
      return created;
    };
  }

  it("cria, exclui e recria o mesmo nome repetidamente, preservando o histórico", async () => {
    const create = setup();
    await create();
    const keys = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const old = db.rows.at(-1)!;
      keys.add(old.stage_key);
      old.is_active = false; // persisted result of the soft-delete hooks
      const snapshot = { ...old };
      await expect(create()).resolves.toMatchObject({ name: "Em negociação", is_active: true });
      expect(old).toEqual(snapshot);
      expect(keys.has(db.rows.at(-1)!.stage_key)).toBe(false);
    }
  });

  it("continua recusando o mesmo nome enquanto a etapa está ativa", async () => {
    const create = setup();
    await create();
    await expect(create()).rejects.toThrow(/Já existe uma etapa/);
    expect(db.rows).toHaveLength(1);
  });

  it("recusa duplicata ativa mesmo após recriar a etapa excluída", async () => {
    const create = setup();
    await create();
    db.rows[0].is_active = false;
    await create();
    await expect(create()).rejects.toThrow(/Já existe uma etapa/);
    expect(db.rows).toHaveLength(2);
  });

  it("não deixa etapas de outra organização ou funil reservarem o nome", async () => {
    db.rows.push({ id: "other", organization_id: "org2", pipeline_id: "p2", pipeline_type: "whatsapp", name: "Em negociação", stage_key: "em_negociacao", position: 0, is_active: true });
    await expect(setup()()).resolves.toMatchObject({ stage_key: "em_negociacao" });
  });

  it("permite o mesmo nome em outro funil da mesma organização", async () => {
    db.rows.push({ id: "other", organization_id: "org1", pipeline_id: "p2", pipeline_type: kind === "system" ? "propostas" : null, name: "Em negociação", stage_key: "em_negociacao", position: 0, is_active: true });
    await expect(setup()()).resolves.toMatchObject({ stage_key: "em_negociacao" });
  });

  it("pula sufixos já ocupados por outras etapas", async () => {
    const create = setup();
    await create();
    db.rows[0].is_active = false;
    db.rows.push({ ...db.rows[0], id: "suffix", name: "Em negociação 2", stage_key: "em_negociacao_2", position: 1, is_active: true });
    await expect(create()).resolves.toMatchObject({ name: "Em negociação", stage_key: "em_negociacao_3" });
  });

  it("não tenta inserir quando não consegue verificar as etapas existentes", async () => {
    db.readError = true;
    await expect(setup()()).rejects.toMatchObject({ message: "read failed" });
    expect(db.rows).toHaveLength(0);
  });
});
