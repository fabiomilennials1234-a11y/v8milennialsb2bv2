import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Exercise the real Supabase SDK over an external HTTP fixture. Both the RPC
// and direct insert enforce UNIQUE(pipeline_id, stage_key/position).
function installPostgrestFixture() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json" },
    });
    const rpc = url.pathname === "/rest/v1/rpc/fn_etapa_custom_criar";
    if (!rpc && url.pathname !== "/rest/v1/pipeline_stages") {
      throw new Error(`Unexpected PostgREST request: ${request.method} ${url.pathname}`);
    }
    if (request.method === "POST") {
      const body = await request.json();
      const row: Row = {
        id: `s${db.rows.length}`, organization_id: "org1", pipeline_id: "p1",
        pipeline_type: null, name: "", stage_key: "", position: 0, is_active: true,
        ...(rpc ? body.p_input : body),
      };
      const conflict = db.rows.find(r => r.pipeline_id === row.pipeline_id &&
        (r.stage_key === row.stage_key || r.position === row.position));
      if (conflict) return response({ code: "23505", message: 'duplicate key violates "pipeline_stages_pipeline_id_stage_key_key"' }, 409);
      db.rows.push(row);
      return response(rpc ? row.id : row, 201);
    }
    if (db.readError) return response({ message: "read failed" }, 500);
    const rows = db.rows.filter(row => [...url.searchParams].every(([key, value]) =>
      !value.startsWith("eq.") || String(row[key as keyof Row]) === value.slice(3)));
    const data = [...rows].sort((a, b) => b.position - a.position)
      .slice(0, Number(url.searchParams.get("limit") ?? Infinity));
    return response(request.headers.get("Accept")?.includes("vnd.pgrst.object") ? data[0] : data);
  }));
}
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org1" } }),
  useCanDo: () => true,
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/pipelines/lib/stageTransition", () => ({ upsertLeadIntoCustomPipe: vi.fn() }));

import { useCreatePipelineStage } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { useCreateCustomPipelineStage } from "@/modules/pipelines/hooks/custom/useCustomPipelines";

beforeEach(() => { db.rows = []; db.readError = false; installPostgrestFixture(); });
afterEach(() => { vi.unstubAllGlobals(); });

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
