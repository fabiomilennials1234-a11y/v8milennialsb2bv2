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

  it("renders the module while loading (no flash of lock)", () => {
    mockFeatures = { hasFeature: () => false, isReady: false, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.getByText("MODULE")).toBeInTheDocument();
  });
});
