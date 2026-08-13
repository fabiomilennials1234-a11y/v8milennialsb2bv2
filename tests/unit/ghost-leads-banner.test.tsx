/**
 * GhostLeadsBanner — visibilidade explícita de cards com RLS divergente
 * entre pipe_* e leads. Substitui o filtro silencioso anterior
 * (`if (!lead) return false` sem telemetria) por aviso ao usuário + evento
 * em usage_events para rastreamento em prod.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockTrack = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

const mockUseOrganization = vi.fn();
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => mockUseOrganization(),
}));

import { GhostLeadsBanner } from "@/modules/pipelines/components/shared/GhostLeadsBanner";

beforeEach(() => {
  mockTrack.mockClear();
  mockUseOrganization.mockReturnValue({ organizationId: "org-1" });
});

describe("GhostLeadsBanner", () => {
  it("renders nothing when ghostCount is 0", () => {
    const { container } = render(<GhostLeadsBanner pipeType="whatsapp" ghostCount={0} />);
    expect(container.firstChild).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("renders singular text for ghostCount=1", () => {
    render(<GhostLeadsBanner pipeType="whatsapp" ghostCount={1} />);
    expect(screen.getByText(/1 lead deste funil não aparece para você/)).toBeTruthy();
  });

  it("renders plural text for ghostCount>1", () => {
    render(<GhostLeadsBanner pipeType="propostas" ghostCount={7} />);
    expect(screen.getByText(/7 leads deste funil não aparecem para você/)).toBeTruthy();
  });

  // O corpo NÃO pode voltar a mandar revisar permissão. O texto anterior dizia
  // "inconsistência de permissão / peça ao administrador para revisar", e o caso
  // dominante em produção não é inconsistência: é a org ter configurado carteira
  // por pessoa. Aquele texto empurrava o admin a religar `leads.view_all`, ou
  // seja, a desfazer a própria decisão. Ancorado aqui para não regredir.
  it("explains the carteira setup instead of asking to review permissions", () => {
    render(<GhostLeadsBanner pipeType="custom" ghostCount={430} />);
    expect(screen.getByText(/não é um erro/)).toBeTruthy();
    expect(screen.queryByText(/inconsistência de permissão/)).toBeNull();
    expect(screen.queryByText(/revisar/)).toBeNull();
  });

  it("accepts the custom pipe type — the only live consumer today", () => {
    render(<GhostLeadsBanner pipeType="custom" ghostCount={575} />);
    expect(screen.getByText(/575 leads deste funil não aparecem para você/)).toBeTruthy();
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { pipe_type: "custom", ghost_count: 575 } }),
    );
  });

  it("fires pipe.ghost_leads_detected with pipe_type + count", () => {
    render(<GhostLeadsBanner pipeType="confirmacao" ghostCount={3} />);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith({
      event: "pipe.ghost_leads_detected",
      organizationId: "org-1",
      entityType: "pipe",
      metadata: { pipe_type: "confirmacao", ghost_count: 3 },
    });
  });

  it("does not fire telemetry without organizationId", () => {
    mockUseOrganization.mockReturnValue({ organizationId: null });
    render(<GhostLeadsBanner pipeType="whatsapp" ghostCount={5} />);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("does not re-fire telemetry on re-render with same (orgId, count)", () => {
    const { rerender } = render(<GhostLeadsBanner pipeType="whatsapp" ghostCount={2} />);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    rerender(<GhostLeadsBanner pipeType="whatsapp" ghostCount={2} />);
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it("fires again when count changes", () => {
    const { rerender } = render(<GhostLeadsBanner pipeType="whatsapp" ghostCount={2} />);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    rerender(<GhostLeadsBanner pipeType="whatsapp" ghostCount={5} />);
    expect(mockTrack).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { pipe_type: "whatsapp", ghost_count: 5 } }),
    );
  });
});
