/**
 * Sprint 4+5 — MenuPreview + InteractiveResponseBubble + PixButtonBubble
 * render tests.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MenuPreview } from "@/modules/workflows/components/action-configs/MenuPreview";
import { InteractiveResponseBubble } from "@/modules/communication/components/chat/bubbles/InteractiveResponseBubble";
import { PixButtonBubble } from "@/modules/communication/components/chat/bubbles/PixButtonBubble";

describe("MenuPreview", () => {
  it("renders button type with choices", () => {
    render(
      <MenuPreview
        type="button"
        text="Escolha uma opção"
        choices={["Quero agendar", "Tenho dúvida"]}
      />
    );
    expect(screen.getByText("Quero agendar")).toBeInTheDocument();
    expect(screen.getByText("Tenho dúvida")).toBeInTheDocument();
    expect(screen.getByText("Escolha uma opção")).toBeInTheDocument();
  });

  it("renders list type with chevron rows", () => {
    const { container } = render(
      <MenuPreview type="list" text="Lista" choices={["A", "B", "C"]} />
    );
    const rows = container.querySelectorAll(".justify-between");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("renders poll with selectable indicator (Circle icon present)", () => {
    const { container } = render(
      <MenuPreview type="poll" text="Vote" choices={["Sim", "Não"]} />
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("renders footer when provided", () => {
    render(
      <MenuPreview
        type="button"
        text="X"
        choices={["A"]}
        footer="Responda com opção"
      />
    );
    expect(screen.getByText("Responda com opção")).toBeInTheDocument();
  });

  it("shows hint when choices empty", () => {
    render(<MenuPreview type="button" text="X" choices={[]} />);
    expect(screen.getByText(/Adicione ao menos 1 opção/)).toBeInTheDocument();
  });
});

describe("InteractiveResponseBubble", () => {
  it("renders buttonResponse with selected label", () => {
    render(
      <InteractiveResponseBubble
        content="Quero agendar"
        messageType="buttonResponseMessage"
        isOutgoing={false}
      />
    );
    expect(screen.getByText("Quero agendar")).toBeInTheDocument();
    expect(screen.getByText(/Selecionou \(botão\)/)).toBeInTheDocument();
  });

  it("renders listResponse label", () => {
    render(
      <InteractiveResponseBubble
        content="Segunda-feira 10h"
        messageType="listResponse"
        isOutgoing={false}
      />
    );
    expect(screen.getByText(/Selecionou \(lista\)/)).toBeInTheDocument();
  });

  it("renders pollUpdate vote label", () => {
    render(
      <InteractiveResponseBubble
        content="Opção A"
        messageType="pollUpdateMessage"
        isOutgoing={false}
      />
    );
    expect(screen.getByText(/Votou/)).toBeInTheDocument();
  });

  it("returns null for non-interactive types", () => {
    const { container } = render(
      <InteractiveResponseBubble
        content="hi"
        messageType="text"
        isOutgoing={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("PixButtonBubble", () => {
  it("renders unpaid pix with amount + waiting badge", () => {
    render(
      <PixButtonBubble
        content="Cobrança da proposta"
        rawPayload={{
          amount: 499.9,
          pixkey: "11122233344",
          merchantName: "Loja ACME",
        }}
        isOutgoing
      />
    );
    expect(screen.getByText("Cobrança PIX")).toBeInTheDocument();
    expect(screen.getByText(/R\$ 499,90/)).toBeInTheDocument();
    expect(screen.getByText(/Loja ACME/)).toBeInTheDocument();
    expect(screen.getByText(/Aguardando pagamento/)).toBeInTheDocument();
  });

  it("renders paid variant when status=paid", () => {
    render(
      <PixButtonBubble
        content={null}
        rawPayload={{ amount: 100, merchantName: "X" }}
        isOutgoing
        status="paid"
      />
    );
    expect(screen.getByText("Pagamento confirmado")).toBeInTheDocument();
  });

  it("hides merchant when absent", () => {
    render(
      <PixButtonBubble
        content={null}
        rawPayload={{ amount: 50 }}
        isOutgoing
      />
    );
    expect(screen.queryByText(/Recebedor:/)).not.toBeInTheDocument();
  });
});
