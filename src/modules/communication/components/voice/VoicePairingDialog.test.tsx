import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pairing = {
  status: "ocioso" as string,
  qr: null as string | null,
  error: null as string | null,
  start: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("@/modules/communication/hooks/useVoicePairing", () => ({
  useVoicePairing: () => pairing,
}));

import { VoicePairingDialog } from "./VoicePairingDialog";

function renderDialog(open = true) {
  return render(
    <VoicePairingDialog instanceId="i-1" instanceName="Comercial" open={open} onOpenChange={() => {}} />,
  );
}

beforeEach(() => {
  // Reseta o duplo, não só as chamadas: cada teste parte do mesmo estado
  // inicial do hook, senão o valor deixado por um teste vaza pro próximo.
  pairing.status = "ocioso";
  pairing.qr = null;
  pairing.error = null;
  pairing.start.mockClear();
  pairing.retry.mockClear();
  pairing.cancel.mockClear();
});

describe("VoicePairingDialog", () => {
  it("mostra o QR quando ele chega", () => {
    pairing.status = "qr-na-tela";
    pairing.qr = "codigo-do-qr";
    renderDialog();
    expect(screen.getByTestId("voice-pairing-qr")).toBeInTheDocument();
  });

  it("não desenha QR nenhum antes de ele chegar", () => {
    pairing.status = "aguardando-qr";
    pairing.qr = null;
    renderDialog();
    expect(screen.queryByTestId("voice-pairing-qr")).not.toBeInTheDocument();
    expect(screen.getByText(/gerando o código/i)).toBeInTheDocument();
  });

  it("mostra a mensagem de erro traduzida, não o código", () => {
    pairing.status = "falhou";
    pairing.qr = null;
    pairing.error = "Este WhatsApp já tem 4 aparelhos conectados.";
    renderDialog();
    expect(screen.getByText(/4 aparelhos conectados/i)).toBeInTheDocument();
  });

  it("confirma o pareamento", () => {
    pairing.status = "pareado";
    pairing.qr = null;
    pairing.error = null;
    renderDialog();
    expect(screen.getByText(/voz ativada/i)).toBeInTheDocument();
  });

  it("chama retry, nunca start, no botão de tentar de novo", () => {
    // `start` cria sessão nova; três cliques em "tentar de novo" chamando
    // `start` estourariam o teto de sessões da organização com órfãs. O
    // hook decide sozinho entre reabrir e recomeçar — a tela só chama retry.
    pairing.status = "falhou";
    pairing.error = "A conexão com o servidor de voz caiu. Tente de novo.";
    renderDialog();
    // Abrir sempre dispara `start` uma vez (fluxo normal de entrada); o que
    // este teste prova é que o CLIQUE no botão não soma mais nenhuma chamada.
    expect(pairing.start).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: /tentar de novo/i }).click();
    expect(pairing.retry).toHaveBeenCalledTimes(1);
    expect(pairing.start).toHaveBeenCalledTimes(1);
  });

  it("dispara start uma única vez ao abrir, mesmo com o status mudando entre re-renders", () => {
    // Simula a sequência real do hook (ocioso → criando → aguardando-qr) via
    // re-render manual, já que o duplo não dispara re-render sozinho ao
    // mutar. Se o efeito golpear `status` na lista de dependências e ela for
    // o gatilho, essa sequência reexecutaria `start` a cada mudança.
    const { rerender } = renderDialog();
    expect(pairing.start).toHaveBeenCalledTimes(1);

    pairing.status = "criando";
    rerender(<VoicePairingDialog instanceId="i-1" instanceName="Comercial" open onOpenChange={() => {}} />);
    pairing.status = "aguardando-qr";
    rerender(<VoicePairingDialog instanceId="i-1" instanceName="Comercial" open onOpenChange={() => {}} />);
    pairing.status = "qr-na-tela";
    pairing.qr = "codigo-do-qr";
    rerender(<VoicePairingDialog instanceId="i-1" instanceName="Comercial" open onOpenChange={() => {}} />);

    expect(pairing.start).toHaveBeenCalledTimes(1);
  });

  it("chama cancel ao fechar e dispara start de novo ao reabrir", () => {
    const { rerender } = renderDialog(true);
    expect(pairing.start).toHaveBeenCalledTimes(1);

    rerender(
      <VoicePairingDialog instanceId="i-1" instanceName="Comercial" open={false} onOpenChange={() => {}} />,
    );
    expect(pairing.cancel).toHaveBeenCalledTimes(1);

    pairing.status = "ocioso";
    rerender(
      <VoicePairingDialog instanceId="i-1" instanceName="Comercial" open onOpenChange={() => {}} />,
    );
    expect(pairing.start).toHaveBeenCalledTimes(2);
  });
});
