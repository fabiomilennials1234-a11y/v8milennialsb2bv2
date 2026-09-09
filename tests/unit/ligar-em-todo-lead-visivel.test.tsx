/**
 * Ligar em todo lead/negócio visível — as TRÊS superfícies novas do botão.
 *
 * Pedido do CTO em 2026-09-02: "alguns casos não conseguimos ou não aparece o
 * botão para ligar, mesmo com o TorqueCalls ativo". Duas causas, medidas na
 * Milennials: (1) o gate de dono do lead — que este PR apaga, e cuja prova
 * vive em `VoiceCallButton.test.tsx` e no Deno de `call-plane.test.ts`; (2) o
 * botão SÓ existia no cabeçalho do chat de mesa. No Card do Lead havia um
 * `AcaoRapida` "Ligar" sem `onClick` — botão morto desde o primeiro commit —,
 * no Card do Negócio não havia nada, e no celular também não.
 *
 * O que se prende aqui é ONDE o botão monta em cada superfície, e que os dois
 * cards recebem o botão por SLOT — eles são alcançáveis a partir de
 * `src/preview/main.tsx`, que não pode importar o provider de voz
 * (`preview-cards-sem-banco.test.ts`). O botão em si tem suíte própria.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { LeadCard } from "@/modules/leads/components/lead-card/LeadCard";
import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";
import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import { NEGOCIO_MAGRO, NEGOCIO_GANHO } from "@/modules/leads/components/deal-card/fixtures";

/** O que o cabeçalho do celular passou ao botão, render a render. */
let propsRecebidas: Array<Record<string, unknown>> = [];
vi.mock("@/modules/communication/components/voice/VoiceCallButton", () => ({
  VoiceCallButton: (props: Record<string, unknown>) => {
    propsRecebidas.push(props);
    return <button type="button" aria-label="Ligar" />;
  },
}));

import { MobileChatThreadHeader } from "@/modules/communication/components/chat/view/MobileChatThreadHeader";

const slot = <button type="button" aria-label="Ligar" data-testid="slot-ligar" />;

beforeEach(() => {
  propsRecebidas = [];
});

describe("Card do Lead — o Ligar morto saiu; o vivo entra por slot no cabeçalho", () => {
  it("sem o slot, NÃO existe botão Ligar nenhum — botão que não faz nada é pior que ausência", () => {
    render(<LeadCard lead={LEAD_EXEMPLO} />);
    expect(screen.queryByRole("button", { name: /^ligar$/i })).not.toBeInTheDocument();
  });

  it("com o slot, o botão monta DENTRO do cabeçalho, ao lado das outras ações rápidas", () => {
    const { container } = render(<LeadCard lead={LEAD_EXEMPLO} acaoLigar={slot} />);
    const header = container.querySelector("header")!;
    const ligar = within(header).getByTestId("slot-ligar");
    // Mesma fileira de "Abrir conversa": é a linha das ações, não o corpo.
    const abrirConversa = within(header).getByRole("button", { name: /abrir conversa/i });
    expect(ligar.parentElement).toBe(abrirConversa.parentElement);
  });
});

describe("Card do Negócio — Ligar no cluster do cabeçalho, antes de Ganhou/Perdeu", () => {
  it("negócio aberto: o slot monta no mesmo cluster de Ganhou e Perdeu, e vem antes", () => {
    const { container } = render(<DealCard negocio={NEGOCIO_MAGRO} acaoLigar={slot} />);
    const header = container.querySelector("header")!;
    const ligar = within(header).getByTestId("slot-ligar");
    const ganhou = within(header).getByRole("button", { name: /ganhou/i });
    expect(ligar.parentElement).toBe(ganhou.parentElement);
    expect(ligar.compareDocumentPosition(ganhou) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Negócio fechado não oferece desfecho e, sem `onExcluir`, o cluster nem
  // existia. Ligar para quem já comprou é o follow-up mais comum: o cluster
  // tem que nascer só para ele.
  it("negócio ganho e sem excluir: o cluster existe só para o Ligar", () => {
    const { container } = render(<DealCard negocio={NEGOCIO_GANHO} acaoLigar={slot} />);
    const header = container.querySelector("header")!;
    expect(within(header).getByTestId("slot-ligar")).toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /ganhou/i })).not.toBeInTheDocument();
  });

  it("sem o slot, nada muda no cabeçalho do negócio fechado", () => {
    const { container } = render(<DealCard negocio={NEGOCIO_GANHO} />);
    expect(container.querySelector("header")!.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Celular — o cabeçalho da conversa ganha o botão, fora do bloco do contato", () => {
  const base = {
    contactName: "Fábrica Silva",
    phoneNumber: "+55 11 98472-1130",
    onBack: vi.fn(),
    onTapContact: vi.fn(),
  };

  it("passa o lead da conversa ao botão, na variante ícone", () => {
    render(<MobileChatThreadHeader {...base} hasLead leadId="lead-1" />);
    expect(screen.getByRole("button", { name: /^ligar$/i })).toBeInTheDocument();
    expect(propsRecebidas.at(-1)).toMatchObject({
      variant: "icon",
      leadId: "lead-1",
      leadName: "Fábrica Silva",
    });
  });

  // Quem decide sumir é o botão (sem lead → null). O cabeçalho só repassa.
  it("sem lead, repassa `undefined` e deixa o botão decidir", () => {
    render(<MobileChatThreadHeader {...base} hasLead={false} />);
    expect(propsRecebidas.at(-1)).toMatchObject({ variant: "icon", leadId: undefined });
  });

  it("o botão NÃO fica dentro do bloco clicável do contato", () => {
    render(<MobileChatThreadHeader {...base} hasLead leadId="lead-1" />);
    const contato = screen.getByText("Fábrica Silva").closest('[role="button"]')!;
    expect(within(contato as HTMLElement).queryByRole("button", { name: /^ligar$/i })).toBeNull();
  });
});
