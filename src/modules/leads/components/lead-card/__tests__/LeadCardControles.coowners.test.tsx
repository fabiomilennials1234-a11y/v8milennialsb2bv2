import { render, screen } from "@testing-library/react";
import { LeadCardControles } from "../LeadCardControles";

/**
 * Chamado 793f4b05 · PR3 — o controle de co-donos da ficha. Os slots reais
 * gravam por react-query e têm teste próprio; aqui só importa SE e COMO a ficha
 * desenha o controle: `coDonos` ausente = org sem N donos (ficha como sempre foi);
 * array, mesmo vazio = org com N donos (precisa do controle justamente para
 * adicionar o primeiro co-dono).
 */

vi.mock("../../lead-detail/modal/header/ResponsibleSlot", () => ({
  ResponsibleSlot: ({ label }: { label: string }) => <span data-testid={`resp-${label}`} />,
}));
vi.mock("../../lead-detail/modal/header/QualificationSlot", () => ({
  QualificationSlot: () => <span data-testid="qualif" />,
}));
vi.mock("../../lead-detail/modal/header/CoOwnersSlot", () => ({
  CoOwnersSlot: ({ leadId }: { leadId: string }) => <span data-testid="co-slot" data-lead={leadId} />,
}));

const base = {
  leadId: "lead-1",
  preVenda: null,
  venda: { id: "tm-1", name: "Fernanda Souza" },
  preQualificacao: null,
  qualificacao: null,
};

describe.each(["faixa", "grade"] as const)("LeadCardControles — co-donos (%s)", (forma) => {
  it("org sem N donos (coDonos ausente): nenhum controle de co-donos", () => {
    render(<LeadCardControles {...base} forma={forma} />);
    expect(screen.queryByTestId("co-slot")).not.toBeInTheDocument();
    expect(screen.queryByText("Co-donos")).not.toBeInTheDocument();
  });

  it("org com N donos e nenhum co-dono ainda: o controle aparece para adicionar o primeiro", () => {
    render(<LeadCardControles {...base} forma={forma} coDonos={[]} />);
    expect(screen.getByText("Co-donos")).toBeInTheDocument();
    expect(screen.getByTestId("co-slot")).toHaveAttribute("data-lead", "lead-1");
  });

  it("com co-donos, o controle aparece", () => {
    render(
      <LeadCardControles
        {...base}
        forma={forma}
        coDonos={[
          { id: "tm-2", name: "Fran Lima" },
          { id: "tm-3", name: "Ana Reis" },
        ]}
      />,
    );
    expect(screen.getByTestId("co-slot")).toBeInTheDocument();
  });

  it("na grade, o texto do cartão lista os nomes; vazio diz 'Nenhum co-dono'", () => {
    if (forma !== "grade") return;
    const { rerender } = render(
      <LeadCardControles {...base} forma="grade" coDonos={[{ id: "tm-2", name: "Fran Lima" }, { id: "tm-3", name: "Ana Reis" }]} />,
    );
    expect(screen.getByText("Fran Lima, Ana Reis")).toBeInTheDocument();
    rerender(<LeadCardControles {...base} forma="grade" coDonos={[]} />);
    expect(screen.getByText("Nenhum co-dono")).toBeInTheDocument();
  });
});
