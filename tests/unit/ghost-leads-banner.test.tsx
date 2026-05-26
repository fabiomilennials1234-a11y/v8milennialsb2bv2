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
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => mockUseOrganization(),
}));

import { GhostLeadsBanner } from "@/components/pipelines/GhostLeadsBanner";

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
    expect(screen.getByText(/1 card está com inconsistência de permissão/)).toBeTruthy();
  });

  it("renders plural text for ghostCount>1", () => {
    render(<GhostLeadsBanner pipeType="propostas" ghostCount={7} />);
    expect(screen.getByText(/7 cards estão com inconsistência de permissão/)).toBeTruthy();
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
