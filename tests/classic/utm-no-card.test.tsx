/**
 * Cópia de `src/modules/leads/components/lead-card/__tests__/utm-no-card.test.tsx`.
 *
 * O card novo entrou no snapshot clássico (f9a2950) antes do #2234, então as
 * orgs com a interface clássica viam o lead sem nenhum UTM — medido em prod
 * 13/10 na JR Tex: `utm_*` gravado no lead, bloco ausente no painel.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { camposDeOrigemDaCampanha } from "@/modules/leads/components/lead-card/campos-de-origem-da-campanha";
import { LeadCardFields } from "@/modules/leads/components/lead-card/LeadCardFields";

describe("origem da campanha no painel da pessoa (clássica)", () => {
  it("exibe os cinco UTMs sem permitir edição", () => {
    const salvar = vi.fn();
    const groups = camposDeOrigemDaCampanha({ utm_source: "google", utm_medium: "cpc", utm_campaign: "outubro", utm_content: "video", utm_term: "distribuidor" });
    render(<LeadCardFields grupos={groups} onSave={salvar} />);
    expect(screen.getByText("Origem da campanha")).toBeTruthy();
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
