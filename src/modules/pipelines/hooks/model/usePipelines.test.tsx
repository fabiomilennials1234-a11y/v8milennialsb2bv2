import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMovePipelineEntry } from "./usePipelines";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-jrtex" }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));

function renderMove() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(useMovePipelineEntry, { wrapper }).result.current;
}

const transfer = {
  id: "entry-opala",
  stageId: "stage-novo",
  transfer: { fromPipelineId: "pipe-opala", toPipelineId: "pipe-reunioes", leadId: "lead-1" },
};

const stageQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
const entryQuery = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  stageQuery.maybeSingle.mockResolvedValue({ data: { id: "stage-novo", stage_key: "novo", stage_role: "open" } });
  entryQuery.single.mockResolvedValue({ data: { id: "entry-opala", lead_id: "lead-1" } });
  from.mockImplementation((table) => table === "pipeline_entries" ? entryQuery : stageQuery);
});

describe("useMovePipelineEntry ao trocar de funil", () => {
  it("grava funil e etapa juntos na entrada original, com os filtros do negócio", async () => {
    await renderMove().mutateAsync(transfer);

    expect(stageQuery.eq.mock.calls).toContainEqual(["organization_id", "org-jrtex"]);
    expect(stageQuery.eq.mock.calls).toContainEqual(["pipeline_id", "pipe-reunioes"]);
    expect(stageQuery.eq.mock.calls).toContainEqual(["id", "stage-novo"]);
    expect(stageQuery.eq.mock.calls).toContainEqual(["destino.is_active", true]);
    expect(entryQuery.update).toHaveBeenCalledExactlyOnceWith({
      pipeline_id: "pipe-reunioes",
      stage_id: "stage-novo",
      stage_key: "novo",
      stage_changed_at: expect.any(String),
    });
    expect(entryQuery.eq.mock.calls).toEqual([
      ["id", "entry-opala"],
      ["organization_id", "org-jrtex"],
      ["lead_id", "lead-1"],
      ["pipeline_id", "pipe-opala"],
    ]);
    expect(entryQuery.is).toHaveBeenCalledWith("closed_at", null);
  });

  it("recusa destino fora do escopo antes de alterar a entrada", async () => {
    stageQuery.maybeSingle.mockResolvedValueOnce({ data: null });
    await expect(renderMove().mutateAsync(transfer)).rejects.toThrow("Escolha uma etapa ativa");
    expect(from).not.toHaveBeenCalledWith("pipeline_entries");
  });

  it("informa quando outro negócio aberto ocupa o destino", async () => {
    entryQuery.single.mockResolvedValueOnce({
      error: { code: "23505", message: "uq_pipeline_entries_um_card_sem_negocio" },
    });
    await expect(renderMove().mutateAsync(transfer)).rejects.toThrow("já tem um negócio aberto");
    expect(entryQuery.update).toHaveBeenCalledTimes(1);
  });
});
