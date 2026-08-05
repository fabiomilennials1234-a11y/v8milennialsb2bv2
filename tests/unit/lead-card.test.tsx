/**
 * Card do Lead — bloco de Dados e o roteamento de escrita do container.
 *
 * Fecha a outra metade de `inv:H8-31`. O que se cobre é o que perde dado ou
 * mente para quem preenche:
 *
 *   1. campo sem coluna em `leads` (CNPJ, site, nascimento, endereço) APARECE,
 *      por decisão do CTO — sumir é o que faz ninguém nunca preencher — mas
 *      não finge que grava. São duas defesas: a interface não deixa entrar em
 *      edição, e `salvarCampo` recusa a chave mesmo se alguém chamar direto;
 *   2. campo da organização vai por `useSaveCustomFieldValue` e a chave dele É
 *      o id da definição; campo do sistema vai por `useUpdateLead` e a chave é
 *      o nome da coluna. Trocar os dois grava no lugar errado, calado;
 *   3. lead invisível tem três causas — não existe, está na lixeira, sem
 *      permissão — e o card não colapsa as três numa mensagem só, porque
 *      pedem reações diferentes de quem está lendo.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LeadCardFields } from "@/modules/leads/components/lead-card/LeadCardFields";
import type { LeadCardFieldGroup } from "@/modules/leads/components/lead-card/types";

// ── Mocks do container ──────────────────────────────────────────────────────
const cardDataRef: { value: unknown; visibility: string; isLoading: boolean } = {
  value: null,
  visibility: "exists",
  isLoading: false,
};
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({
    data: cardDataRef.value,
    isLoading: cardDataRef.isLoading,
    visibility: cardDataRef.visibility,
  }),
}));

const updateLeadAsync = vi.fn().mockResolvedValue({});
const saveCustomFieldAsync = vi.fn().mockResolvedValue({});
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: updateLeadAsync, mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: saveCustomFieldAsync }),
}));

// O card de cima é grande e não é o alvo deste arquivo: aqui interessa o que o
// container faz com `onSaveField`, não como o card desenha.
const salvarCampoRef: { fn: ((chave: string, valor: string) => Promise<void>) | null } = {
  fn: null,
};
vi.mock("@/modules/leads/components/lead-card/LeadCard", () => ({
  LeadCard: ({ onSaveField }: { onSaveField?: (c: string, v: string) => Promise<void> }) => {
    salvarCampoRef.fn = onSaveField ?? null;
    return <div data-testid="lead-card" />;
  },
}));

import { LeadCardContainer } from "@/modules/leads/components/lead-card/LeadCardContainer";

const GRUPOS: LeadCardFieldGroup[] = [
  {
    titulo: "Empresa",
    campos: [
      { chave: "company", rotulo: "Empresa", valor: "Distética Ltda" },
      {
        chave: "cnpj",
        rotulo: "CNPJ",
        valor: null,
        vazio: "Informe o CNPJ",
        somenteLeitura: true,
      },
      { chave: "cf-7", rotulo: "Segmento", valor: null, vazio: "Informe o segmento", personalizado: true },
    ],
  },
];

describe("LeadCardFields — campo sem coluna aparece, mas não finge que grava", () => {
  it("marca o campo somente-leitura com cadeado rotulado", () => {
    render(<LeadCardFields grupos={GRUPOS} onSave={vi.fn()} />);

    expect(screen.getByLabelText(/campo ainda sem coluna no banco/i)).toBeInTheDocument();
  });

  it("não deixa o campo somente-leitura entrar em edição", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardFields grupos={GRUPOS} onSave={onSave} />);

    const cnpj = screen.getByRole("button", { name: /informe o cnpj/i });
    expect(cnpj).toBeDisabled();
    fireEvent.click(cnpj);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("mostra o campo vazio com o convite, em vez de esconder a linha", () => {
    render(<LeadCardFields grupos={GRUPOS} onSave={vi.fn()} />);

    expect(screen.getByText("Informe o CNPJ")).toBeInTheDocument();
    expect(screen.getByText("Informe o segmento")).toBeInTheDocument();
    expect(screen.getByText("CNPJ")).toBeInTheDocument();
  });

  it("conta preenchidos sobre o total do grupo", () => {
    render(<LeadCardFields grupos={GRUPOS} onSave={vi.fn()} />);

    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("campo editável grava chave e valor no Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardFields grupos={GRUPOS} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Distética Ltda" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Distética Comércio Ltda" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("company", "Distética Comércio Ltda"));
  });

  it("sem onSave o bloco inteiro fica de leitura — é a rota de visualização", () => {
    render(<LeadCardFields grupos={GRUPOS} />);

    expect(screen.getByRole("button", { name: "Distética Ltda" })).toBeDisabled();
  });
});

describe("LeadCardContainer — para onde cada campo escreve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    salvarCampoRef.fn = null;
    cardDataRef.value = { id: "l1", nome: "Distética", campos: GRUPOS };
    cardDataRef.visibility = "exists";
    cardDataRef.isLoading = false;
  });

  it("recusa gravar campo sem coluna, mesmo chamado direto", async () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    await salvarCampoRef.fn!("cnpj", "12.345.678/0001-90");

    expect(updateLeadAsync).not.toHaveBeenCalled();
    expect(saveCustomFieldAsync).not.toHaveBeenCalled();
  });

  it("campo da organização vai por saveCustomField, com a chave como id da definição", async () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    await salvarCampoRef.fn!("cf-7", "  Suplementos  ");

    expect(saveCustomFieldAsync).toHaveBeenCalledWith({
      leadId: "l1",
      fieldId: "cf-7",
      value: "Suplementos",
    });
    expect(updateLeadAsync).not.toHaveBeenCalled();
  });

  it("campo do sistema vai por updateLead, com a chave como nome da coluna", async () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    await salvarCampoRef.fn!("company", "Distética Comércio Ltda");

    expect(updateLeadAsync).toHaveBeenCalledWith({ id: "l1", company: "Distética Comércio Ltda" });
    expect(saveCustomFieldAsync).not.toHaveBeenCalled();
  });

  it("apagar o texto de um campo do sistema grava NULL, não string vazia", async () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    await salvarCampoRef.fn!("company", "   ");

    expect(updateLeadAsync).toHaveBeenCalledWith({ id: "l1", company: null });
  });

  it("chave desconhecida não vira escrita", async () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    await salvarCampoRef.fn!("coluna_que_nao_existe", "x");

    expect(updateLeadAsync).not.toHaveBeenCalled();
    expect(saveCustomFieldAsync).not.toHaveBeenCalled();
  });
});

describe("LeadCardContainer — lead invisível tem três causas diferentes", () => {
  beforeEach(() => {
    cardDataRef.value = null;
    cardDataRef.isLoading = false;
  });

  it("lixeira", () => {
    cardDataRef.visibility = "deleted";
    render(<LeadCardContainer leadId="l1" isOpen />);
    expect(screen.getByText(/está na lixeira/i)).toBeInTheDocument();
  });

  it("sem permissão", () => {
    cardDataRef.visibility = "permission_denied";
    render(<LeadCardContainer leadId="l1" isOpen />);
    expect(screen.getByText(/não tem acesso/i)).toBeInTheDocument();
  });

  it("inexistente", () => {
    cardDataRef.visibility = "not_found";
    render(<LeadCardContainer leadId="l1" isOpen />);
    expect(screen.getByText(/não encontrado/i)).toBeInTheDocument();
  });

  it("fechado não renderiza nada", () => {
    cardDataRef.visibility = "exists";
    cardDataRef.value = { id: "l1", nome: "Distética", campos: GRUPOS };
    const { container } = render(<LeadCardContainer leadId="l1" isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
