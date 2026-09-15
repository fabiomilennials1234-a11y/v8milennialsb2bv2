import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import templates from "@/modules/analytics/lib/metrics-studio-templates.json";

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "insana", timezone: "America/Sao_Paulo", isReady: true }),
  useIdentity: () => ({ isMaster: false }),
  useCurrentTeamMember: () => ({ data: { id: "admin", role: "admin" } }),
  useFeaturePermission: () => ({ allowed: true }),
}));
vi.mock("@/modules/analytics/hooks/useStudioCatalog", () => ({ useStudioCatalog: () => ({ byId: new Map(), custom: {} }) }));
vi.mock("@/modules/analytics/hooks/useMetricsStudioPanels", () => ({ useMetricsStudioPanels: () => ({ paineis: [{ id: "overview", nome: "Visão Geral" }], isLoading: false }) }));
vi.mock("@/modules/analytics/hooks/useMetricsStudio", () => ({ useMetricsStudio: () => ({ windows: templates[0].layout, persistence: {} }) }));
vi.mock("@/modules/analytics/hooks/useMetricsStudioReport", () => ({ useMetricsStudioReport: () => ({ exportando: null, exportar: vi.fn() }) }));
vi.mock("@/modules/analytics/hooks/useStudioClock", () => ({ useStudioClock: () => new Date("2026-09-15T13:00:00Z") }));
vi.mock("@/modules/analytics/components/metrics-studio/MetricComposer", () => ({ MetricComposer: () => null }));
vi.mock("@/modules/analytics/components/metrics-studio/MetricsStudioSidebar", () => ({ MetricsStudioSidebar: () => null }));
vi.mock("@/modules/analytics/components/metrics-studio/MetricsCanvas", () => ({ MetricsCanvas: React.forwardRef<HTMLDivElement>((_, ref) => <div ref={ref} />) }));
vi.mock("@/modules/analytics/components/metrics-studio/StudioTabs", () => ({ StudioTabs: () => null }));
import MetricsStudio from "@/modules/analytics/pages/MetricsStudio";

describe("exportação na aba exibida no vídeo da Insana", () => {
  it("permite exportar a Visão Geral padrão, formada por cards de dashboard", () => {
    render(<MemoryRouter><MetricsStudio /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Exportar métricas" })).toBeEnabled();
  });
});
