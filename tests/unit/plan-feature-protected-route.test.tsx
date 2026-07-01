/**
 * PlanFeatureProtectedRoute — unit tests
 *
 * Scenarios:
 * 1. Feature liberada no plano → renderiza children
 * 2. Feature bloqueada → estado bloqueado (título + CTA), children ausentes
 * 3. Estado bloqueado mostra label do plano atual (torque-1.0 → Torque Base)
 * 4. "Falar com Comercial" abre o CTA de upgrade em nova aba
 * 5. "Voltar ao início" navega pro /dashboard
 * 6. Loading (hasFeature true por convenção) → renderiza children, sem lock flash
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlanFeatureProtectedRoute } from "@/modules/platform/components/PlanFeatureProtectedRoute";
import { UPGRADE_CONTACT_URL } from "@/shared/components/UpgradeModal";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseOrgFeatures = vi.fn();
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => mockUseOrgFeatures(),
}));

function renderGuard(ui?: { feature?: "copilot"; label?: string }) {
  return render(
    <MemoryRouter>
      <PlanFeatureProtectedRoute
        feature={ui?.feature ?? "copilot"}
        featureLabel={ui?.label ?? "Copilot"}
      >
        <div data-testid="gated-page">conteúdo</div>
      </PlanFeatureProtectedRoute>
    </MemoryRouter>,
  );
}

describe("PlanFeatureProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children when the plan has the feature", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => true,
      planName: "torque-v8",
    });
    renderGuard();
    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
    expect(screen.queryByText(/Desbloqueie/)).not.toBeInTheDocument();
  });

  it("renders locked state without children when the feature is missing", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => false,
      planName: "torque-2.0",
    });
    renderGuard();
    expect(screen.queryByTestId("gated-page")).not.toBeInTheDocument();
    expect(screen.getByText("Desbloqueie Copilot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Falar com Comercial/ })).toBeInTheDocument();
  });

  it("shows the current plan display label (torque-1.0 → Torque Base)", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => false,
      planName: "torque-1.0",
    });
    renderGuard({ label: "Chat" });
    expect(screen.getByText(/plano Torque Base/)).toBeInTheDocument();
  });

  it("falls back to the raw plan name when there is no label", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => false,
      planName: "plano-desconhecido",
    });
    renderGuard();
    expect(screen.getByText(/plano plano-desconhecido/)).toBeInTheDocument();
  });

  it("opens the upgrade CTA in a new tab", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => false,
      planName: "torque-1.0",
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderGuard();
    fireEvent.click(screen.getByRole("button", { name: /Falar com Comercial/ }));
    expect(openSpy).toHaveBeenCalledWith(UPGRADE_CONTACT_URL, "_blank");
    openSpy.mockRestore();
  });

  it("'Voltar ao início' navigates to /dashboard", () => {
    mockUseOrgFeatures.mockReturnValue({
      hasFeature: () => false,
      planName: "torque-1.0",
    });
    renderGuard();
    fireEvent.click(screen.getByRole("button", { name: /Voltar ao início/ }));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });
});
