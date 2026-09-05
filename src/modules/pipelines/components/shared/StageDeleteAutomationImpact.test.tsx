import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageDeleteAutomationImpact } from "./StageDeleteAutomationImpact";

describe("StageDeleteAutomationImpact", () => {
  it("explica antes da confirmação quantas automações serão desativadas", () => {
    render(<StageDeleteAutomationImpact automations={2} />);
    expect(screen.getByText(/2 automações serão desativadas/i)).toBeInTheDocument();
    expect(screen.getByText(/revise cada configuração antes de reativar/i)).toBeInTheDocument();
  });

  it("não cria aviso quando nenhuma automação referencia a etapa", () => {
    const { container } = render(<StageDeleteAutomationImpact automations={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
