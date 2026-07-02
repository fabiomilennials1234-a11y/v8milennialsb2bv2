import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureRoute } from "@/modules/platform/components/feature-lock/FeatureRoute";

let mockFeatures = { hasFeature: (_k: string) => true, isReady: true, featureUnlockPlan: {} as Record<string, unknown> };
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => mockFeatures,
}));

function renderRoute(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("FeatureRoute", () => {
  it("renders the module when the feature is unlocked", () => {
    mockFeatures = { hasFeature: () => true, isReady: true, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.getByText("MODULE")).toBeInTheDocument();
  });

  it("renders the locked screen instead of the module when locked", () => {
    mockFeatures = { hasFeature: () => false, isReady: true, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.queryByText("MODULE")).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-locked-screen")).toBeInTheDocument();
  });

  it("loading (isReady=false) → loader neutro: NEM módulo NEM lock (guard estrito)", () => {
    // hasFeature é fail-open no loading — o guard NÃO pode confiar nisso:
    // renderizar o módulo aqui abria janela de acesso a rota bloqueada.
    // Loader neutro também elimina o flash de lock que o fail-open evitava.
    mockFeatures = { hasFeature: () => true, isReady: false, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.queryByText("MODULE")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-locked-screen")).not.toBeInTheDocument();
  });

  it("sem feature key resolvida → renderiza children (rota não-gateável)", () => {
    mockFeatures = { hasFeature: () => false, isReady: false, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute><div>MODULE</div></FeatureRoute>);
    expect(screen.getByText("MODULE")).toBeInTheDocument();
  });
});
