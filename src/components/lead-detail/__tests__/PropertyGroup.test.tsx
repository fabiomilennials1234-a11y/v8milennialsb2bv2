import { render, screen, fireEvent } from "@testing-library/react";
import { PropertyGroup } from "../PropertyGroup";

describe("PropertyGroup", () => {
  it("renders label and children when expanded", () => {
    render(
      <PropertyGroup label="Details">
        <span>Child content</span>
      </PropertyGroup>
    );
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("collapses and hides children on header click", () => {
    render(
      <PropertyGroup label="Details">
        <span>Child content</span>
      </PropertyGroup>
    );
    fireEvent.click(screen.getByText("Details"));
    expect(screen.queryByText("Child content")).not.toBeVisible();
  });

  it("starts collapsed when defaultCollapsed is true", () => {
    render(
      <PropertyGroup label="Details" defaultCollapsed>
        <span>Child content</span>
      </PropertyGroup>
    );
    expect(screen.queryByText("Child content")).not.toBeVisible();
  });
});
