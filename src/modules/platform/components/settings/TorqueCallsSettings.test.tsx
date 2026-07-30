import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instances = [
  { id: "i-1", instance_name: "Comercial", phone_number: "5548884334050", voice_calls_enabled: true },
  { id: "i-2", instance_name: "Suporte", phone_number: "5548991005289", voice_calls_enabled: false },
];
let cap = 10;

const logoutVoiceSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/communication", () => ({
  useVoipSessions: () => ({
    data: [{ tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsappInstanceId: "i-1" }],
    isLoading: false,
  }),
  useWhatsAppInstances: () => ({ data: instances, isLoading: false }),
  useVoiceSessionsCap: () => ({ data: cap }),
  logoutVoiceSession: (...a: unknown[]) => logoutVoiceSession(...a),
  VoiceControlError: class extends Error {},
  VoicePairingDialog: () => null,
}));

import { TorqueCallsSettings } from "./TorqueCallsSettings";

// O componente usa `useQueryClient` para invalidar as listas ao desconectar —
// sem o Provider em volta, o render estoura fora de qualquer contexto de query.
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  logoutVoiceSession.mockClear();
  cap = 10;
});

describe("TorqueCallsSettings", () => {
  it("lista os números e diz quais têm voz", () => {
    render(<TorqueCallsSettings />);
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.getByText("Suporte")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar voz/i })).toBeInTheDocument();
  });

  it("mostra o teto antes de o cliente esbarrar nele", () => {
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/1 de 10/i)).toBeInTheDocument();
  });

  it("desabilita ativar quando o teto já foi atingido", () => {
    cap = 1;
    render(<TorqueCallsSettings />);
    expect(screen.getByRole("button", { name: /ativar voz/i })).toBeDisabled();
  });

  it("desconectar chama a ação de verdade — o botão não é enfeite", async () => {
    const user = userEvent.setup();
    render(<TorqueCallsSettings />);
    await user.click(screen.getByRole("button", { name: /desconectar/i }));
    expect(logoutVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1" });
  });
});
