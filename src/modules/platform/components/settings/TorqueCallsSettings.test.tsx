import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instances = [
  { id: "i-1", instance_name: "Comercial", phone_number: "5548884334050", voice_calls_enabled: true },
  { id: "i-2", instance_name: "Suporte", phone_number: "5548991005289", voice_calls_enabled: false },
];
let cap = 10;

type FakeSession = { tcSessionId: string; name: string; jid: string; status: string; whatsappInstanceId: string };
const sessaoAberta: FakeSession =
  { tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsappInstanceId: "i-1" };
let sessions: FakeSession[] = [sessaoAberta];

const logoutVoiceSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/communication", () => ({
  useVoipSessions: () => ({
    data: sessions,
    isLoading: false,
  }),
  useWhatsAppInstances: () => ({ data: instances, isLoading: false }),
  useVoiceSessionsCap: () => ({ data: cap }),
  logoutVoiceSession: (...a: unknown[]) => logoutVoiceSession(...a),
  VoiceControlError: class extends Error {},
  VoicePairingDialog: () => null,
}));

vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));

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
  sessions = [sessaoAberta];
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
    expect(logoutVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1", organizationId: "org-1" });
  });

  // ─── O que "voz ativa" pode significar ────────────────────────────────────
  //
  // `status` nasce `pending` em `createSession` e vira `pairing` no
  // `pairSession`. NADA neste repositório promove para `open` — quem faria isso
  // é o webhook do S11, que não existe aqui. Enquanto isso, dizer "Voz ativa"
  // para uma sessão `pending` é a tela afirmando um sucesso que o sistema não
  // sustenta: `fn_voip_call_reserve` e `call-plane.ts` recusam com
  // `session_not_open`, e `useCallableVoiceNumbers` nem mostra o botão de ligar.
  //
  // Pior: a linha `pending` já existe assim que o modal ABRE. O cliente que
  // desiste no meio do QR também via "Voz ativa".

  it("sessão pending NÃO é voz ativa — a tela não promete o que o sistema recusa", () => {
    sessions = [{ ...sessaoAberta, status: "pending" }];
    render(<TorqueCallsSettings />);
    expect(screen.queryByText("Voz ativa")).not.toBeInTheDocument();
    expect(screen.getByText(/aguardando confirmação/i)).toBeInTheDocument();
  });

  it("sessão pairing também é aguardando, não ativa", () => {
    sessions = [{ ...sessaoAberta, status: "pairing" }];
    render(<TorqueCallsSettings />);
    expect(screen.queryByText("Voz ativa")).not.toBeInTheDocument();
    expect(screen.getByText(/aguardando confirmação/i)).toBeInTheDocument();
  });

  it("só status open vira Voz ativa", () => {
    sessions = [sessaoAberta];
    render(<TorqueCallsSettings />);
    expect(screen.getByText("Voz ativa")).toBeInTheDocument();
    expect(screen.queryByText(/aguardando confirmação/i)).not.toBeInTheDocument();
  });

  // Sem saída o cliente fica preso: a linha `pending` ocupa vaga no teto e não
  // há outro caminho para removê-la pela tela.
  it("sessão pending mantém o botão de desconectar — o cliente não fica preso", async () => {
    const user = userEvent.setup();
    sessions = [{ ...sessaoAberta, status: "pending" }];
    render(<TorqueCallsSettings />);
    await user.click(screen.getByRole("button", { name: /desconectar/i }));
    expect(logoutVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1", organizationId: "org-1" });
  });

  // O predicado do TETO é de propósito diferente do da EXIBIÇÃO: sessão
  // `pending` não é utilizável, mas já segura websocket e memória na VPS.
  it("sessão pending ocupa vaga no teto mesmo sem estar utilizável", () => {
    cap = 1;
    sessions = [{ ...sessaoAberta, status: "pending" }];
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/1 de 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar voz/i })).toBeDisabled();
  });

  it("sessão closed não conta no teto nem aparece como estado do número", () => {
    sessions = [{ ...sessaoAberta, status: "closed" }];
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/0 de 10/i)).toBeInTheDocument();
    expect(screen.queryByText("Voz ativa")).not.toBeInTheDocument();
    expect(screen.queryByText(/aguardando confirmação/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /ativar voz/i })).toHaveLength(2);
  });
});
