import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureLock } from "@/modules/platform/components/feature-lock/FeatureLock";

let mockFeatures = { hasFeature: (_k: string) => true, isReady: true, featureUnlockPlan: {} as Record<string, unknown> };
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => mockFeatures,
}));

function renderLock(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("FeatureLock", () => {
  it("renders children untouched when the feature is unlocked", () => {
    mockFeatures = { hasFeature: () => true, isReady: true, featureUnlockPlan: {} };
    renderLock(<FeatureLock feature="copilot">Copilot</FeatureLock>);
    expect(screen.getByText("Copilot")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-lock-icon")).not.toBeInTheDocument();
  });

  it("renders a padlock and blocks the click when locked", () => {
    mockFeatures = { hasFeature: () => false, isReady: true, featureUnlockPlan: {} };
    const onClick = vi.fn();
    renderLock(
      <FeatureLock feature="copilot">
        <button onClick={onClick}>Copilot</button>
      </FeatureLock>
    );
    expect(screen.getByTestId("feature-lock-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Copilot"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // Radix Dialog cold-start timeout: 15000ms
  }, 15000);

  it("does not lock while features are still loading", () => {
    mockFeatures = { hasFeature: () => false, isReady: false, featureUnlockPlan: {} };
    renderLock(<FeatureLock feature="copilot">Copilot</FeatureLock>);
    expect(screen.queryByTestId("feature-lock-icon")).not.toBeInTheDocument();
  });
});
