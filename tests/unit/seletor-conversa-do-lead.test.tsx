/**
 * SeletorConversaDoLead — testes dos DOIS pontos que o protótipo (#1607)
 * deixou abertos e que a spec transformou em requisito:
 *
 *   1. os dois grupos precisam ser distinguíveis;
 *   2. o estado desconectado / sem acesso precisa COMUNICAR, e a linha
 *      continua clicável, porque desabilitada = não pode escrever, não
 *      "não pode ver" (decisão 6).
 *
 * Mais o que não pode voltar: badge de não-lidas, que saiu do desenho porque
 * vem de `localStorage` e mente entre dispositivos (#1610).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { SeletorConversaDoLead } from "@/modules/communication/components/chat/SeletorConversaDoLead";
import type { ConversaDoLeadRow } from "@/modules/communication/lib/agruparConversasDoLead";

function caixa(over: Partial<ConversaDoLeadRow> & { instanceId: string }): ConversaDoLeadRow {
  return {
    instanceName: `Caixa ${over.instanceId}`,
    instanceStatus: "connected",
    lastMessageAt: null,
    lastMessageContent: null,
    lastMessageDirection: null,
    ...over,
  };
}

const COM_CONVERSA = caixa({
  instanceId: "com",
  instanceName: "Comercial",
  lastMessageAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  lastMessageContent: "me manda o orçamento",
  lastMessageDirection: "incoming",
});

const SEM_CONVERSA = caixa({ instanceId: "sem", instanceName: "Prospecção" });

describe("SeletorConversaDoLead", () => {
  it("separa os dois grupos com rótulos próprios", () => {
    render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA, SEM_CONVERSA]}
        instanceIdsComEscrita={["com", "sem"]}
        onEscolher={vi.fn()}
      />,
    );

    expect(screen.getByText(/conversa em andamento/i)).toBeTruthy();
    expect(screen.getByText(/iniciar conversa por/i)).toBeTruthy();
  });

  it("avisa que iniciar conversa define o dono — é a decisão mais cara da tela", () => {
    render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA, SEM_CONVERSA]}
        instanceIdsComEscrita={["com", "sem"]}
        onEscolher={vi.fn()}
      />,
    );

    expect(screen.getByText(/vira o dono da conversa/i)).toBeTruthy();
  });

  it("cada caixa cai no grupo certo", () => {
    render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA, SEM_CONVERSA]}
        instanceIdsComEscrita={["com", "sem"]}
        onEscolher={vi.fn()}
      />,
    );

    const andamento = screen.getByLabelText(/conversa em andamento/i);
    const iniciar = screen.getByLabelText(/iniciar conversa por/i);

    expect(within(andamento).getByText("Comercial")).toBeTruthy();
    expect(within(iniciar).getByText("Prospecção")).toBeTruthy();
  });

  it("caixa desconectada mostra o motivo em TEXTO, não só um indicador", () => {
    render(
      <SeletorConversaDoLead
        caixas={[caixa({ ...COM_CONVERSA, instanceStatus: "disconnected" })]}
        instanceIdsComEscrita={["com"]}
        onEscolher={vi.fn()}
      />,
    );

    expect(screen.getByText(/desconectado/i)).toBeTruthy();
  });

  it("caixa sem permissão de escrita diz isso com todas as letras", () => {
    render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA]}
        instanceIdsComEscrita={[]}
        onEscolher={vi.fn()}
      />,
    );

    expect(screen.getByText(/sem acesso a este número/i)).toBeTruthy();
  });

  it("caixa sem escrita CONTINUA clicável — abre em leitura, não é beco sem saída", () => {
    const onEscolher = vi.fn();
    render(
      <SeletorConversaDoLead
        caixas={[caixa({ ...COM_CONVERSA, instanceStatus: "disconnected" })]}
        instanceIdsComEscrita={[]}
        onEscolher={onEscolher}
      />,
    );

    fireEvent.click(screen.getByText("Comercial"));
    expect(onEscolher).toHaveBeenCalledWith("com");
  });

  it("escolher uma caixa devolve o id dela", () => {
    const onEscolher = vi.fn();
    render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA, SEM_CONVERSA]}
        instanceIdsComEscrita={["com", "sem"]}
        onEscolher={onEscolher}
      />,
    );

    fireEvent.click(screen.getByText("Prospecção"));
    expect(onEscolher).toHaveBeenCalledWith("sem");
  });

  it("não mostra contador de não-lidas — saiu do desenho de propósito", () => {
    const { container } = render(
      <SeletorConversaDoLead
        caixas={[COM_CONVERSA, SEM_CONVERSA]}
        instanceIdsComEscrita={["com", "sem"]}
        onEscolher={vi.fn()}
      />,
    );

    expect(container.textContent).not.toMatch(/não lida/i);
  });
});
