import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entry: { id: "entry", lead_id: "lead", pipeline_id: "pipeline", stage_key: "novo", stage_id: "stage-new" },
  hasEntry: true,
  fail: false,
  allowed: true,
  system: false,
  terminal: false,
  writes: 0,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    let patch: Record<string, unknown> = {};
    const chain = {
      update: (value: Record<string, unknown>) => { patch = value; return chain; },
      insert: (value: Record<string, unknown>) => { patch = value; return chain; },
      eq: () => chain,
      select: () => chain,
      single: async () => {
        if (state.fail) return { data: null, error: new Error("write rejected") };
        state.writes++;
        // Contract of pipeline_entries_stage_mirror: UUID goes in stage_id;
        // a UUID written to stage_key cannot resolve a stage with a slug key.
        const keys: Record<string, string> = { "stage-new": "novo", "stage-proposal": "proposta" };
        const stageId = patch.stage_id as string | undefined;
        const stageKey = stageId ? keys[stageId] : patch.stage_key as string;
        state.entry = { ...state.entry, stage_key: stageKey,
          stage_id: stageId ?? Object.keys(keys).find(id => keys[id] === stageKey) ?? "" };
        return { data: state.entry, error: null };
      },
    };
    return chain;
  },
} }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org" }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: () => {} }));
vi.mock("@/modules/leads", () => ({
  useLeadActionGates: () => ({ canMoveMeeting: { allowed: state.allowed }, canAddToPipe: { allowed: state.allowed } }),
  useLeadAllPipelines: () => ({ data: [state.system ? {
    type: "standard", pipeType: "whatsapp", pipelineDbId: "pipeline", label: "Envase", color: "#ffaa00",
    pipeId: "entry", currentStage: "novo",
    stages: [{ id: "novo", label: "Novo" }, { id: "proposta", label: "Proposta" }],
  } : {
    type: "custom", pipelineId: "pipeline", pipelineName: "Envase", pipelineColor: "#ffaa00",
    entryId: state.hasEntry ? "entry" : null, currentStageId: "stage-new",
    stages: [{ id: "stage-new", name: "Novo", position: 0 }, { id: "stage-proposal", name: "Proposta", position: 1, role: state.terminal ? "won" : null }],
  }] }),
}));
vi.mock("@/modules/pipelines", () => ({
  useMovePipelineEntry: () => useMovePipelineEntry(),
  useCreatePipelineEntry: () => useCreatePipelineEntry(),
  usePipelineDisplayConfig: () => ({ data: [] }),
}));
import { useMovePipelineEntry, useCreatePipelineEntry } from "@/modules/pipelines/hooks/model/usePipelines";
import { ContextPanelFunnels } from "@/modules/communication/components/chat/context-panel/ContextPanelFunnels";

function Board() {
  const { data } = useQuery({ queryKey: ["pipeline-page", "pipeline", "proposta", "org"],
    queryFn: async () => state.entry.stage_key === "proposta" ? [state.entry.id] : [], staleTime: Infinity });
  return <output data-testid="board">{data?.join(",")}</output>;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["pipeline-stage-counts", "pipeline", "org"], { novo: 1 });
  render(<QueryClientProvider client={client}><ContextPanelFunnels leadId="lead" /><Board /></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  state.entry = { id: "entry", lead_id: "lead", pipeline_id: "pipeline", stage_key: "novo", stage_id: "stage-new" };
  state.hasEntry = true; state.fail = false; state.allowed = true;
  state.system = false; state.terminal = false; state.writes = 0;
});

describe("chat → funnel, without Realtime", () => {
  it("writes the custom stage UUID canonically and refreshes the mounted board and counts", async () => {
    const client = setup();
    await waitFor(() => expect(client.getQueryState(["pipeline-page", "pipeline", "proposta", "org"])?.status).toBe("success"));
    fireEvent.click(screen.getByRole("button", { name: "Etapa em Envase: Novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Proposta" }));
    await waitFor(() => expect(state.entry.stage_id).toBe("stage-proposal"));
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("entry"));
    expect(client.getQueryState(["pipeline-stage-counts", "pipeline", "org"])?.isInvalidated).toBe(true);
  });

  it("adds a custom funnel with a valid initial stage", async () => {
    state.hasEntry = false;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar a um funil" }));
    fireEvent.click(screen.getByRole("button", { name: "Envase" }));
    await waitFor(() => expect(state.writes).toBe(1));
    await waitFor(() => expect(state.entry.stage_key).toBe("novo"));
    await act(async () => {});
    expect(state.entry.stage_id).toBe("stage-new");
  });

  it("rolls back the chat label when the write fails", async () => {
    state.fail = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Etapa em Envase: Novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Proposta" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Etapa em Envase: Novo" })).toBeEnabled());
    expect(state.entry.stage_key).toBe("novo");
  });

  it("keeps moving disabled without permission", () => {
    state.allowed = false;
    setup();
    expect(screen.getByRole("button", { name: "Etapa em Envase: Novo" })).toBeDisabled();
  });

  it("refreshes the board for stages exposed as legacy keys too", async () => {
    state.system = true;
    const client = setup();
    await waitFor(() => expect(client.getQueryState(["pipeline-page", "pipeline", "proposta", "org"])?.status).toBe("success"));
    fireEvent.click(screen.getByRole("button", { name: "Etapa em Envase: Novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Proposta" }));
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("entry"));
    expect(state.entry.stage_id).toBe("stage-proposal");
  });

  it("requires confirmation before writing a terminal stage UUID", async () => {
    state.terminal = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Etapa em Envase: Novo" }));
    fireEvent.click(await screen.findByRole("button", { name: /Proposta/ }));
    expect(state.writes).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(state.entry.stage_id).toBe("stage-proposal"));
  });
});
