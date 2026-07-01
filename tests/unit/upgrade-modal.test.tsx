import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UpgradeModal } from "@/shared/components/UpgradeModal";

vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({
    planName: "torque-1.0",
    featureUnlockPlan: { copilot: { name: "torque-v8", display_name: "Torque Copilot" } },
  }),
}));

function renderModal() {
  return render(
    <MemoryRouter>
      <UpgradeModal open onOpenChange={() => {}} featureKey="copilot" />
    </MemoryRouter>
  );
}

describe("UpgradeModal v2", () => {
  // First test absorbs the cold-start cost of importing Radix Dialog in JSDOM
  it("names the target plan that unlocks the feature", { timeout: 15000 }, () => {
    renderModal();
    expect(screen.getAllByText(/Torque Copilot/).length).toBeGreaterThan(0);
  });

  it("shows the feature label from the registry", () => {
    renderModal();
    expect(screen.getAllByText(/Copilot/).length).toBeGreaterThan(0);
  });
});
