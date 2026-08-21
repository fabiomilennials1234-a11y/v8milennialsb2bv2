/**
 * AbrirConversaButton — o único caminho para "falar com este lead".
 *
 * Cobre a decisão 1 da spec no ponto onde ela existe de verdade: uma caixa
 * abre direto, duas ou mais perguntam. E cobre o draft do copilot indo para a
 * URL como rascunho, nunca como mensagem enviada (decisão 10).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockCaixas = vi.fn();
vi.mock("@/modules/communication/hooks/chat/useConversasDoLead", () => ({
  useConversasDoLead: (phone: string | null) => mockCaixas(phone),
}));

vi.mock("@/modules/communication/hooks/chat/useWhatsAppInstances", () => ({
  useWhatsAppInstancesForUser: () => ({
    data: [
      { id: "cx-1", instance_name: "Comercial", status: "connected" },
      { id: "cx-2", instance_name: "Pós-venda", status: "connected" },
    ],
  }),
}));

vi.mock("@/modules/communication/hooks/usePreferredInstance", () => ({
  usePreferredInstance: () => ({ preferredInstanceId: null, setPreferredInstance: vi.fn() }),
}));

import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";

function caixa(instanceId: string, comConversa = false) {
  return {
    instanceId,
    instanceName: `Caixa ${instanceId}`,
    instanceStatus: "connected",
    lastMessageAt: comConversa ? new Date().toISOString() : null,
    lastMessageContent: comConversa ? "oi" : null,
    lastMessageDirection: comConversa ? "incoming" : null,
  };
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockCaixas.mockReturnValue({ data: [], isLoading: false });
});

describe("AbrirConversaButton", () => {
  it("lead sem telefone → botão não renderiza, em vez de renderizar inerte", () => {
    const { container } = render(
      <AbrirConversaButton leadId="lead-1" phone={null}>
        WhatsApp
      </AbrirConversaButton>,
    );
    expect(container.textContent).toBe("");
  });

  it("uma caixa só → abre direto, sem mostrar seletor", async () => {
    mockCaixas.mockReturnValue({ data: [caixa("cx-1", true)], isLoading: false });

    render(
      <AbrirConversaButton leadId="lead-1" phone="48999887766">
        WhatsApp
      </AbrirConversaButton>,
    );

    fireEvent.click(screen.getByText("WhatsApp"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        "/chat?phone=5548999887766&instance=cx-1&lead=lead-1",
      );
    });
    expect(screen.queryByText(/conversa em andamento/i)).toBeNull();
  });

  it("duas caixas → pergunta, e não navega sozinho", async () => {
    mockCaixas.mockReturnValue({
      data: [caixa("cx-1", true), caixa("cx-2")],
      isLoading: false,
    });

    render(
      <AbrirConversaButton leadId="lead-1" phone="48999887766">
        WhatsApp
      </AbrirConversaButton>,
    );

    fireEvent.click(screen.getByText("WhatsApp"));

    await waitFor(() => {
      expect(screen.getByText(/conversa em andamento/i)).toBeTruthy();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("escolher no seletor navega para a caixa escolhida", async () => {
    mockCaixas.mockReturnValue({
      data: [caixa("cx-1", true), caixa("cx-2")],
      isLoading: false,
    });

    render(
      <AbrirConversaButton leadId="lead-1" phone="48999887766">
        WhatsApp
      </AbrirConversaButton>,
    );

    fireEvent.click(screen.getByText("WhatsApp"));
    await waitFor(() => screen.getByText("Caixa cx-2"));
    fireEvent.click(screen.getByText("Caixa cx-2"));

    expect(mockNavigate).toHaveBeenCalledWith("/chat?phone=5548999887766&instance=cx-2&lead=lead-1");
  });

  it("draft do copilot viaja como rascunho na URL, não como envio", async () => {
    mockCaixas.mockReturnValue({ data: [caixa("cx-1", true)], isLoading: false });

    render(
      <AbrirConversaButton leadId="lead-1" phone="48999887766" draft="sugestão da IA">
        WhatsApp
      </AbrirConversaButton>,
    );

    fireEvent.click(screen.getByText("WhatsApp"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining("draft=sugest%C3%A3o+da+IA"),
      );
    });
  });

  it("nenhuma caixa na org → diz isso, em vez de abrir lista vazia", async () => {
    mockCaixas.mockReturnValue({ data: [], isLoading: false });

    render(
      <AbrirConversaButton leadId="lead-1" phone="48999887766">
        WhatsApp
      </AbrirConversaButton>,
    );

    fireEvent.click(screen.getByText("WhatsApp"));

    await waitFor(() => {
      expect(screen.getByText(/nenhum número de whatsapp/i)).toBeTruthy();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
