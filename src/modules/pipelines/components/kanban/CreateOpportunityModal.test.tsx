/**
 * Modal FECHADO não busca nada (prod, 21/11/2026: o Funil do trio WhatsApp
 * pagava `pipeline_entries?limit=500` com embeds a cada abertura por causa de
 * um modal montado e fechado). Os hooks de dado moram no conteúdo, que o Radix
 * só monta com o modal aberto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  useLeads: vi.fn(() => ({ data: [], isLoading: false })),
  usePipeWhatsapp: vi.fn(() => ({ data: [] })),
  usePipelineStages: vi.fn(() => ({ data: [] })),
  useTeamMembers: vi.fn(() => ({ data: [] })),
  useCreatePipeWhatsapp: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/modules/leads", () => ({ useLeads: h.useLeads }));
vi.mock("@/modules/identity", () => ({
  useTeamMembers: h.useTeamMembers,
  useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("@/modules/pipelines/hooks/legacy/usePipeWhatsapp", () => ({
  usePipeWhatsapp: h.usePipeWhatsapp,
  useCreatePipeWhatsapp: h.useCreatePipeWhatsapp,
}));
vi.mock("@/modules/pipelines/hooks/model/usePipelineStages", () => ({ usePipelineStages: h.usePipelineStages }));

import { CreateOpportunityModal } from "./CreateOpportunityModal";

beforeEach(() => {
  for (const f of Object.values(h)) f.mockClear();
});

describe("CreateOpportunityModal", () => {
  it("fechado: nenhum hook de dado roda", () => {
    render(<CreateOpportunityModal open={false} onOpenChange={() => {}} />);
    expect(h.useLeads).not.toHaveBeenCalled();
    expect(h.usePipeWhatsapp).not.toHaveBeenCalled();
    expect(h.usePipelineStages).not.toHaveBeenCalled();
    expect(h.useTeamMembers).not.toHaveBeenCalled();
    expect(screen.queryByText("Selecionar lead")).toBeNull();
  });

  it("aberto: monta o conteúdo e busca o que precisa", () => {
    render(<CreateOpportunityModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Selecionar lead")).toBeTruthy();
    expect(h.useLeads).toHaveBeenCalled();
    expect(h.usePipeWhatsapp).toHaveBeenCalled();
    expect(h.usePipelineStages).toHaveBeenCalledWith("whatsapp");
  });
});
