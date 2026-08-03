/**
 * A peça da ligação na linha do tempo.
 *
 * Regra que estes testes travam: uma ligação de 3 segundos que ninguém atendeu
 * e uma conversa de 12 minutos NÃO carregam a mesma informação. A silhueta é a
 * mesma (a thread precisa continuar calma e escaneável), mas o que a peça diz
 * muda — atendida mostra DURAÇÃO, não atendida mostra DESFECHO e nenhuma
 * duração, porque "0s" de uma chamada que não completou é ruído com cara de
 * dado.
 *
 * E ligação não atendida NÃO some: é informação comercial (o lead não te
 * atende há três tentativas é um fato sobre o negócio).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CallMarker } from "./CallMarker";
import type { ConversationCall } from "@/modules/communication/lib/conversationCallsQuery";

function call(over: Partial<ConversationCall> = {}): ConversationCall {
  return {
    id: "call-1",
    lead_id: "lead-1",
    direction: "outbound",
    outcome: "connected",
    duration_seconds: 220,
    phone_number: "48996458738",
    started_at: "2026-08-02T19:23:23.000Z",
    ...over,
  };
}

describe("CallMarker — atendida", () => {
  it("mostra a duração como o dado principal", () => {
    render(<CallMarker call={call({ duration_seconds: 220 })} />);
    expect(screen.getByText("3min 40s")).toBeInTheDocument();
  });

  it("diz de que lado partiu a ligação", () => {
    const { rerender } = render(<CallMarker call={call({ direction: "outbound" })} />);
    expect(screen.getByText("Ligação realizada")).toBeInTheDocument();

    rerender(<CallMarker call={call({ direction: "inbound" })} />);
    expect(screen.getByText("Ligação recebida")).toBeInTheDocument();
  });

  it("uma conversa de 12 minutos aparece por extenso", () => {
    render(<CallMarker call={call({ duration_seconds: 725 })} />);
    expect(screen.getByText("12min 5s")).toBeInTheDocument();
  });
});

describe("CallMarker — não atendida", () => {
  it("aparece na thread (não é escondida)", () => {
    render(<CallMarker call={call({ outcome: "no_answer", duration_seconds: null })} />);
    expect(screen.getByTestId("call-marker")).toBeInTheDocument();
  });

  it("mostra o DESFECHO no lugar da duração", () => {
    render(<CallMarker call={call({ outcome: "no_answer", duration_seconds: null })} />);
    // Rótulo reusado de OUTCOME_LABELS (@/modules/engagement) — não reescrito.
    expect(screen.getByText("Não atendeu")).toBeInTheDocument();
  });

  it("uma ligação de 3 segundos que ninguém atendeu NÃO mostra duração", () => {
    render(<CallMarker call={call({ outcome: "no_answer", duration_seconds: 3 })} />);
    expect(screen.queryByText("3s")).not.toBeInTheDocument();
    expect(screen.getByText("Não atendeu")).toBeInTheDocument();
  });

  it("distingue-se visualmente da atendida", () => {
    const { rerender } = render(<CallMarker call={call({ outcome: "connected" })} />);
    const atendida = screen.getByTestId("call-marker").getAttribute("data-connected");

    rerender(<CallMarker call={call({ outcome: "no_answer", duration_seconds: null })} />);
    const perdida = screen.getByTestId("call-marker").getAttribute("data-connected");

    expect(atendida).toBe("true");
    expect(perdida).toBe("false");
  });

  it("ocupado e recusada também têm rótulo", () => {
    const { rerender } = render(<CallMarker call={call({ outcome: "busy", duration_seconds: null })} />);
    expect(screen.getByText("Ocupado")).toBeInTheDocument();

    // `rejected` só ganha rótulo em OUTCOME_LABELS quando o #1352 entrar.
    // Até lá precisa degradar com dignidade — nunca "undefined" na tela.
    rerender(<CallMarker call={call({ outcome: "rejected", duration_seconds: null })} />);
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("call-marker")).toBeInTheDocument();
  });

  it("desfecho que o banco inventar não quebra a thread", () => {
    render(<CallMarker call={call({ outcome: "algo_novo_do_banco", duration_seconds: null })} />);
    expect(screen.getByTestId("call-marker")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });
});

describe("CallMarker — não é um balão", () => {
  it("é um marco centralizado, não uma mensagem", () => {
    const { container } = render(<CallMarker call={call()} />);
    // O container externo centraliza — balão alinha a um dos lados.
    expect(container.firstElementChild?.className).toContain("justify-center");
  });

  it("resume a ligação para leitor de tela numa frase só", () => {
    render(<CallMarker call={call({ direction: "outbound", duration_seconds: 220 })} />);
    const label = screen.getByTestId("call-marker").getAttribute("aria-label");
    expect(label).toContain("Ligação realizada");
    expect(label).toContain("3min 40s");
  });
});
