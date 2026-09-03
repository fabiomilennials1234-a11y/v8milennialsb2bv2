import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewDealDialog, type NewDealOption } from "../NewDealDialog";

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [
    { id: "tm-1", name: "Ana" },
    { id: "tm-2", name: "Bruno" },
  ],
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
  isVirtualTeamMember: (id: string) => String(id).startsWith("master-virtual-"),
}));

const QUALIFICACAO: NewDealOption = {
  key: "sys:whatsapp",
  label: "Qualificação",
  color: "#6366f1",
  stages: [
    { id: "novo", label: "Novo" },
    { id: "abordado", label: "Abordado" },
  ],
};

const PROPOSTAS: NewDealOption = {
  key: "sys:propostas",
  label: "Propostas",
  color: "#f59e0b",
  stages: [{ id: "enviada", label: "Enviada" }],
  supportsValue: true,
};

const CONFIRMACAO: NewDealOption = {
  key: "sys:confirmacao",
  label: "Confirmação",
  color: "#22c55e",
  stages: [{ id: "marcada", label: "Marcada" }],
  supportsMeeting: true,
};

const CARTEIRA: NewDealOption = {
  key: "sys:upsell",
  label: "Carteira",
  stages: [{ id: "base", label: "Base" }],
  disabled: true,
  disabledReason: "Disponível só quando há venda fechada",
};

function open(options: NewDealOption[], onCreate = vi.fn().mockResolvedValue(undefined)) {
  render(<NewDealDialog options={options} onCreate={onCreate} />);
  fireEvent.click(screen.getByTestId("new-deal-button"));
  return onCreate;
}

describe("NewDealDialog — porta única de criação", () => {
  it("desabilita o gatilho quando o lead já está em todos os funis", () => {
    render(<NewDealDialog options={[]} onCreate={vi.fn()} />);
    expect(screen.getByTestId("new-deal-button")).toBeDisabled();
  });

  it("pré-seleciona o primeiro funil disponível e a primeira etapa dele", () => {
    open([QUALIFICACAO, PROPOSTAS]);
    expect(screen.getByTestId("new-deal-option-sys:whatsapp")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("new-deal-stage")).toHaveTextContent("Novo");
  });

  it("mostra funil bloqueado como travado, fora das opções escolhíveis", () => {
    open([QUALIFICACAO, CARTEIRA]);
    expect(screen.queryByTestId("new-deal-option-sys:upsell")).not.toBeInTheDocument();
    expect(screen.getByTitle("Disponível só quando há venda fechada")).toBeInTheDocument();
  });
});

describe("NewDealDialog — campos por funil", () => {
  it("só oferece valor no funil que tem coluna de valor", () => {
    open([QUALIFICACAO, PROPOSTAS]);
    expect(screen.queryByTestId("new-deal-value")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("new-deal-option-sys:propostas"));
    expect(screen.getByTestId("new-deal-value")).toBeInTheDocument();
  });

  it("só oferece data de reunião em Confirmação", () => {
    open([QUALIFICACAO, CONFIRMACAO]);
    expect(screen.queryByTestId("new-deal-meeting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("new-deal-option-sys:confirmacao"));
    expect(screen.getByTestId("new-deal-meeting")).toBeInTheDocument();
  });

  it("observação existe em qualquer funil", () => {
    open([QUALIFICACAO]);
    expect(screen.getByTestId("new-deal-notes")).toBeInTheDocument();
  });
});

describe("NewDealDialog — submit", () => {
  it("entrega funil, etapa, dono e observação ao criar", async () => {
    const onCreate = open([QUALIFICACAO]);
    fireEvent.change(screen.getByTestId("new-deal-notes"), {
      target: { value: "  ligou pedindo catálogo  " },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const [option, values] = onCreate.mock.calls[0];
    expect(option.key).toBe("sys:whatsapp");
    expect(values).toMatchObject({
      stageId: "novo",
      ownerId: "tm-1",
      notes: "ligou pedindo catálogo",
      saleValue: null,
      meetingDate: null,
    });
  });

  it("converte valor digitado em pt-BR para número", async () => {
    const onCreate = open([PROPOSTAS]);
    fireEvent.change(screen.getByTestId("new-deal-value"), {
      target: { value: "1.250,50" },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][1].saleValue).toBe(1250.5);
  });

  it("valor ilegível vira null em vez de NaN chegando no banco", async () => {
    const onCreate = open([PROPOSTAS]);
    fireEvent.change(screen.getByTestId("new-deal-value"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][1].saleValue).toBeNull();
  });

  it("trocar de funil reposiciona a etapa — stage não vaza entre funis", async () => {
    const onCreate = open([QUALIFICACAO, PROPOSTAS]);
    fireEvent.click(screen.getByTestId("new-deal-option-sys:propostas"));
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][1].stageId).toBe("enviada");
  });

  it("erro na criação mantém o modal aberto com o rascunho", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("RLS negou"));
    open([QUALIFICACAO], onCreate);
    fireEvent.change(screen.getByTestId("new-deal-notes"), {
      target: { value: "não posso perder isso" },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(screen.getByTestId("new-deal-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("new-deal-notes")).toHaveValue("não posso perder isso");
  });
});
