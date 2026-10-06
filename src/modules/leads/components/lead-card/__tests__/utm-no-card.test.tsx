import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { camposDeOrigemDaCampanha } from "../campos-de-origem-da-campanha";
import { LeadCardFields } from "../LeadCardFields";

describe("origem da campanha no painel da pessoa", () => {
  it("exibe os cinco UTMs sem permitir edição", () => {
    const salvar = vi.fn();
    const groups = camposDeOrigemDaCampanha({ utm_source: "google", utm_medium: "cpc", utm_campaign: "outubro", utm_content: "video", utm_term: "distribuidor" });
    render(<LeadCardFields grupos={groups} onSave={salvar} />);
    for (const value of ["google", "cpc", "outubro", "video", "distribuidor"]) {
      fireEvent.click(screen.getByText(value));
    }
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(salvar).not.toHaveBeenCalled();
    expect(groups[0].campos).toHaveLength(5);
  });
  it("omite bloco quando nenhuma UTM foi capturada", () => {
    expect(camposDeOrigemDaCampanha({ utm_source: " ", utm_medium: null })).toEqual([]);
  });
});
