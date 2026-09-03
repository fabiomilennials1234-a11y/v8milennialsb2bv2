/**
 * Interruptor do Copilot e Excluir, no CABEÇALHO do Card do Lead.
 *
 * Prova `inv:H5-15` (SCRUM-120). Os dois controles existiam no card antigo,
 * sumiram no redesenho e voltaram — e o que importa não é que existam em algum
 * lugar da tela, é ONDE existem e O QUE mandam para o banco:
 *
 *   1. **Onde.** Os dois moram no `<header>`, fora das abas. Desligar a IA num
 *      lead é a ação de urgência de quando o agente responde o que não devia;
 *      atrás de um clique de aba ela chega tarde. Este arquivo procura os
 *      botões DENTRO do cabeçalho, não na página — colocar de volta numa aba
 *      passaria despercebido por um `getByRole` solto;
 *
 *   2. **O quê.** O caminho `LeadCard → LeadCardContainer → useToggleLeadAI`
 *      inverte o sentido DUAS vezes: o card manda `!copilotAtivo` e o container
 *      traduz para `disabled: !ativo`. Duas negações em série é a receita
 *      clássica de ligar a IA quando o vendedor pediu para desligar — e o
 *      sintoma é silencioso, porque a tela mostra o estado certo enquanto o
 *      banco guarda o oposto. Os casos abaixo fixam o valor que chega na
 *      mutation, não o rótulo na tela.
 *
 *   3. **Excluir** leva junto conversas, reuniões e follow-ups. Confirmação
 *      nativa antes; recusar na confirmação não pode escrever nada.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { LeadCard } from "@/modules/leads/components/lead-card/LeadCard";
import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";
import type { LeadCardData } from "@/modules/leads/components/lead-card/types";

// ── Mocks do container ──────────────────────────────────────────────────────
const cardDataRef: { value: LeadCardData | null; visibility: string } = {
  value: null,
  visibility: "exists",
};
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({
    data: cardDataRef.value,
    isLoading: false,
    visibility: cardDataRef.visibility,
  }),
}));

const toggleAIMutate = vi.fn();
const deleteLeadAsync = vi.fn().mockResolvedValue({});
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: toggleAIMutate }),
  useDeleteLead: () => ({ mutateAsync: deleteLeadAsync }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
// Ver a nota gêmea em `lead-card.test.tsx`: as mutações de comentário passam
// por `useQueryClient` e este arquivo monta o container sem provider.
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadComments", () => ({
  useCreateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useUpdateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDeleteLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
/* A faixa de etiquetas que o container monta lê banco (react-query) e org
   (`useOrganization` → `AuthContext`). Esta suíte renderiza sem provider nenhum:
   os hooks dela entram na lista pela mesma razão que `useLeads` já estava. */
vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: [], isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: [], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { LeadCardContainer } from "@/modules/leads/components/lead-card/LeadCardContainer";
import { LeadCallActionProvider } from "@/shared/components/LeadCallActionSlot";

function lead(over: Partial<LeadCardData> = {}): LeadCardData {
  return { ...LEAD_EXEMPLO, ...over };
}

/** O cabeçalho do card, como região — é onde os dois controles têm de estar. */
function cabecalho(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  if (!header) throw new Error("O card perdeu o cabeçalho.");
  return header as HTMLElement;
}

describe("LeadCard — os dois controles estão no cabeçalho, não numa aba", () => {
  it("o interruptor do Copilot fica no cabeçalho", () => {
    const { container } = render(<LeadCard lead={lead()} onToggleCopilot={vi.fn()} />);

    expect(within(cabecalho(container)).getByRole("button", { name: /copilot/i })).toBeInTheDocument();
  });

  it("Excluir fica no cabeçalho", () => {
    const { container } = render(<LeadCard lead={lead()} onDelete={vi.fn()} />);

    expect(
      within(cabecalho(container)).getByRole("button", { name: /excluir lead/i }),
    ).toBeInTheDocument();
  });

  it("continuam no cabeçalho depois de trocar de aba — não pertencem ao painel", () => {
    const { container } = render(
      <LeadCard lead={lead()} onToggleCopilot={vi.fn()} onDelete={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^dados/i }));

    const head = cabecalho(container);
    expect(within(head).getByRole("button", { name: /copilot/i })).toBeInTheDocument();
    expect(within(head).getByRole("button", { name: /excluir lead/i })).toBeInTheDocument();
  });
});

describe("LeadCard — o interruptor manda o ESTADO NOVO, não o atual", () => {
  it("Copilot ativo: clicar pede para DESLIGAR (false)", () => {
    const onToggleCopilot = vi.fn();
    render(<LeadCard lead={lead({ copilotAtivo: true })} onToggleCopilot={onToggleCopilot} />);

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));

    expect(onToggleCopilot).toHaveBeenCalledWith(false);
  });

  it("Copilot desligado: clicar pede para LIGAR (true)", () => {
    const onToggleCopilot = vi.fn();
    render(<LeadCard lead={lead({ copilotAtivo: false })} onToggleCopilot={onToggleCopilot} />);

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));

    expect(onToggleCopilot).toHaveBeenCalledWith(true);
  });

  it("o rótulo diz o estado ATUAL — quem lê 'ativo' tem de estar vendo IA ligada", () => {
    const { rerender } = render(<LeadCard lead={lead({ copilotAtivo: true })} />);
    expect(screen.getByRole("button", { name: /copilot ativo/i })).toBeInTheDocument();

    rerender(<LeadCard lead={lead({ copilotAtivo: false })} />);
    expect(screen.getByRole("button", { name: /copilot desligado/i })).toBeInTheDocument();
  });

  it("sem handler o interruptor fica inerte, em vez de fingir que desligou", () => {
    render(<LeadCard lead={lead({ copilotAtivo: true })} />);

    const botao = screen.getByRole("button", { name: /copilot/i });
    expect(botao).toBeDisabled();
    fireEvent.click(botao);
    // A rota de visualização monta o card sem handler — não pode explodir.
    expect(screen.getByRole("button", { name: /copilot ativo/i })).toBeInTheDocument();
  });

  it("sem handler, Excluir fica desabilitado — visualização não apaga lead", () => {
    render(<LeadCard lead={lead()} />);

    expect(screen.getByRole("button", { name: /excluir lead/i })).toBeDisabled();
  });

  it("com handler, Excluir chama uma vez por clique", () => {
    const onDelete = vi.fn();
    render(<LeadCard lead={lead()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: /excluir lead/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("LeadCardContainer — o que o interruptor escreve no banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cardDataRef.value = lead({ id: "l1", copilotAtivo: true });
    cardDataRef.visibility = "exists";
  });

  it("Copilot ativo + clique ⇒ `disabled: true` (a dupla negação não pode se cancelar)", () => {
    render(<LeadCardContainer leadId="l1" isOpen />);

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));

    expect(toggleAIMutate).toHaveBeenCalledWith({ leadId: "l1", disabled: true });
  });

  it("Copilot desligado + clique ⇒ `disabled: false`", () => {
    cardDataRef.value = lead({ id: "l1", copilotAtivo: false });
    render(<LeadCardContainer leadId="l1" isOpen />);

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));

    expect(toggleAIMutate).toHaveBeenCalledWith({ leadId: "l1", disabled: false });
  });
});

describe("LeadCardContainer — Excluir pergunta antes", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    cardDataRef.value = lead({ id: "l1" });
    cardDataRef.visibility = "exists";
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => confirmSpy.mockRestore());

  it("recusar a confirmação não apaga nada", () => {
    confirmSpy.mockReturnValue(false);
    render(<LeadCardContainer leadId="l1" isOpen />);

    fireEvent.click(screen.getByRole("button", { name: /excluir lead/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteLeadAsync).not.toHaveBeenCalled();
  });

  it("confirmar apaga o lead aberto, e só ele", async () => {
    confirmSpy.mockReturnValue(true);
    render(<LeadCardContainer leadId="l1" isOpen />);

    fireEvent.click(screen.getByRole("button", { name: /excluir lead/i }));

    await waitFor(() => expect(deleteLeadAsync).toHaveBeenCalledWith("l1"));
    expect(deleteLeadAsync).toHaveBeenCalledTimes(1);
  });
});

describe("LeadCard — o botão de Ligar vem da raiz, pelo slot", () => {
  // `leads` não importa `communication` (ciclo entre os barrels). O botão real
  // é injetado por `App.tsx` via `LeadCallActionProvider`; aqui o que se prova
  // é a costura: o container pede o botão PARA ESTE lead e o pendura no
  // cabeçalho. Sem provider, nada aparece — e nada de morto fica no lugar.
  it("com o provider, o botão do lead aberto aparece no cabeçalho", () => {
    cardDataRef.value = lead({ id: "l1", nome: "Fábrica Silva" });
    const pedidos: Array<{ id: string; nome: string | null }> = [];
    const { container } = render(
      <LeadCallActionProvider
        value={(alvo) => {
          pedidos.push(alvo);
          return <button type="button" aria-label="Ligar" />;
        }}
      >
        <LeadCardContainer leadId="l1" isOpen />
      </LeadCallActionProvider>,
    );
    expect(within(cabecalho(container)).getByRole("button", { name: /^ligar$/i })).toBeInTheDocument();
    expect(pedidos).toContainEqual({ id: "l1", nome: "Fábrica Silva" });
  });

  it("sem provider, não há botão Ligar — nem o morto de antes", () => {
    cardDataRef.value = lead({ id: "l1" });
    render(<LeadCardContainer leadId="l1" isOpen />);
    expect(screen.queryByRole("button", { name: /^ligar$/i })).not.toBeInTheDocument();
  });
});
