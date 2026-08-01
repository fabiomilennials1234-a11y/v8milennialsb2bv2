/**
 * InstanceRoutingSelector — o seletor que substitui "Automático (primeira
 * disponível)" no WhatsApp Message Node (PRD #1331, fatia #1332).
 *
 * O que estes testes prendem é o contrato visível: quais políticas o operador
 * pode escolher, quando o campo de recuo aparece, e o que é gravado no nó.
 * A Organization de um número conectado não vê recuo — não há o que declarar.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InstanceRoutingSelector } from "@/modules/workflows/components/sidebar-panels/InstanceRoutingSelector";

// ─── Mocks ─────────────────────────────────────────────────────────────────

let mockInstances: Array<{
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
}> = [];
let mockLoading = false;

vi.mock("@/modules/communication/hooks/useWhatsAppInstances", () => ({
  useWhatsAppInstances: () => ({ data: mockInstances, isLoading: mockLoading }),
}));

// Radix Select usa APIs de ponteiro que o jsdom não implementa.
beforeAll(() => {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? vi.fn();
  Element.prototype.hasPointerCapture =
    Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture =
    Element.prototype.releasePointerCapture ?? vi.fn();
});

const DOIS_NUMEROS = [
  { id: "inst-1", instance_name: "Comercial 1", phone_number: "5511999990001", status: "connected" },
  { id: "inst-2", instance_name: "Comercial 2", phone_number: "5511999990002", status: "open" },
];

const UM_NUMERO = [DOIS_NUMEROS[0]];

beforeEach(() => {
  mockInstances = DOIS_NUMEROS;
  mockLoading = false;
});

function renderSelector(
  data: Record<string, unknown> = {},
  onUpdate = vi.fn(),
) {
  render(<InstanceRoutingSelector data={data} onUpdate={onUpdate} />);
  return onUpdate;
}

// ─── Políticas oferecidas ──────────────────────────────────────────────────

describe("políticas oferecidas", () => {
  it("oferece as três políticas nomeadas e nenhum 'Automático'", () => {
    renderSelector();
    fireEvent.click(screen.getByRole("combobox", { name: /enviar por/i }));

    expect(screen.getByRole("option", { name: /seguir a conversa do lead/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /instância do responsável/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /número fixo/i })).toBeInTheDocument();
    expect(screen.queryByText(/automático/i)).not.toBeInTheDocument();
  });

  it("nó sem política declarada mostra 'Seguir a conversa do lead'", () => {
    renderSelector();
    expect(
      screen.getByRole("combobox", { name: /enviar por/i }),
    ).toHaveTextContent(/seguir a conversa do lead/i);
  });

  it("nó legado com instância fixa mostra 'Número fixo'", () => {
    renderSelector({ whatsappInstanceId: "inst-2", whatsappInstanceName: "Comercial 2" });
    expect(
      screen.getByRole("combobox", { name: /enviar por/i }),
    ).toHaveTextContent(/número fixo/i);
  });
});

// ─── Campo de recuo ────────────────────────────────────────────────────────

describe("campo de recuo", () => {
  it("aparece na política 'seguir a conversa'", () => {
    renderSelector({ instanceRoutingPolicy: "conversation" });
    expect(screen.getByRole("combobox", { name: /se não houver conversa/i })).toBeInTheDocument();
  });

  it("aparece na política 'instância do responsável'", () => {
    renderSelector({ instanceRoutingPolicy: "responsible" });
    expect(screen.getByRole("combobox", { name: /se não houver conversa/i })).toBeInTheDocument();
  });

  it("some na política 'número fixo' — não há o que recuar", () => {
    renderSelector({ instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-1" });
    expect(screen.queryByRole("combobox", { name: /se não houver conversa/i })).not.toBeInTheDocument();
  });

  it("some quando a organização tem um número conectado só", () => {
    mockInstances = UM_NUMERO;
    renderSelector({ instanceRoutingPolicy: "conversation" });
    expect(screen.queryByRole("combobox", { name: /se não houver conversa/i })).not.toBeInTheDocument();
  });

  it("instância desconectada não conta para o campo de recuo aparecer", () => {
    mockInstances = [
      DOIS_NUMEROS[0],
      { id: "inst-3", instance_name: "Antigo", phone_number: null, status: "close" },
    ];
    renderSelector({ instanceRoutingPolicy: "conversation" });
    expect(screen.queryByRole("combobox", { name: /se não houver conversa/i })).not.toBeInTheDocument();
  });
});

// ─── Seletor da instância fixa ─────────────────────────────────────────────

describe("seletor da instância fixa", () => {
  it("aparece só na política 'número fixo'", () => {
    renderSelector({ instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-1" });
    expect(screen.getByRole("combobox", { name: /número de saída/i })).toBeInTheDocument();
  });

  it("não aparece na política 'seguir a conversa'", () => {
    renderSelector({ instanceRoutingPolicy: "conversation" });
    expect(screen.queryByRole("combobox", { name: /número de saída/i })).not.toBeInTheDocument();
  });
});

// ─── Gravação no nó ────────────────────────────────────────────────────────

describe("gravação no nó", () => {
  it("escolher 'número fixo' esconde o recuo sem destruí-lo", () => {
    const onUpdate = renderSelector({
      instanceRoutingPolicy: "conversation",
      fallbackInstanceId: "inst-2",
      fallbackInstanceName: "Comercial 2",
    });

    fireEvent.click(screen.getByRole("combobox", { name: /enviar por/i }));
    fireEvent.click(screen.getByRole("option", { name: /número fixo/i }));

    expect(onUpdate).toHaveBeenCalledWith({ instanceRoutingPolicy: "fixed" });
  });

  it("escolher 'seguir a conversa' limpa a instância fixa", () => {
    const onUpdate = renderSelector({
      whatsappInstanceId: "inst-1",
      whatsappInstanceName: "Comercial 1",
    });

    fireEvent.click(screen.getByRole("combobox", { name: /enviar por/i }));
    fireEvent.click(screen.getByRole("option", { name: /seguir a conversa do lead/i }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceRoutingPolicy: "conversation",
        whatsappInstanceId: "",
        whatsappInstanceName: "",
      }),
    );
  });

  it("escolher o recuo grava id e nome sem mexer na política", () => {
    const onUpdate = renderSelector({ instanceRoutingPolicy: "conversation" });

    fireEvent.click(screen.getByRole("combobox", { name: /se não houver conversa/i }));
    fireEvent.click(screen.getByRole("option", { name: /comercial 2/i }));

    expect(onUpdate).toHaveBeenCalledWith({
      fallbackInstanceId: "inst-2",
      fallbackInstanceName: "Comercial 2",
    });
  });
});

// ─── Estados de borda ──────────────────────────────────────────────────────

describe("estados de borda", () => {
  it("carregando não oferece política nenhuma", () => {
    mockLoading = true;
    renderSelector();
    expect(screen.queryByRole("combobox", { name: /enviar por/i })).not.toBeInTheDocument();
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it("sem nenhuma instância conectada avisa em vez de oferecer política", () => {
    mockInstances = [];
    renderSelector();
    expect(screen.queryByRole("combobox", { name: /enviar por/i })).not.toBeInTheDocument();
    expect(screen.getByText(/nenhuma instância whatsapp conectada/i)).toBeInTheDocument();
  });
});
