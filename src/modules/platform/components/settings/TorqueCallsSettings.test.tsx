import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen, within } from "@testing-library/react";
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

/** A linha (card) de um número, para consultar dentro dela em vez da página toda. */
function linhaDoNumero(nome: string): HTMLElement {
  const titulo = screen.getByText(nome);
  const linha = titulo.closest("div.rounded-lg");
  if (!linha) throw new Error(`linha do número ${nome} não encontrada`);
  return linha as HTMLElement;
}

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

  it("sessão closed não conta no teto", () => {
    sessions = [{ ...sessaoAberta, status: "closed" }];
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/0 de 10/i)).toBeInTheDocument();
    expect(screen.queryByText("Voz ativa")).not.toBeInTheDocument();
    expect(screen.queryByText(/aguardando confirmação/i)).not.toBeInTheDocument();
  });

  // ─── #1342: a sessão que CAI ≠ a sessão que o cliente DESLIGOU ─────────────
  //
  // As duas terminam em `status = "closed"`, e até aqui a tela tratava as duas
  // como ausência — o número voltava a parecer nunca-configurado. Isso escondia
  // as duas coisas que o cliente precisa saber: que a voz caiu, e que ainda há
  // o que limpar na VPS.
  //
  // O que separa uma da outra já está no dado: `logoutSession` desliga
  // `voice_calls_enabled` junto com o fechamento (torquecalls-control), enquanto
  // o webhook que aplica `failed` NÃO toca na chave — ela fica `true` sobre uma
  // sessão morta. Essa divergência é exatamente o item 3 da issue, e em vez de
  // apagá-la (o que destruiria a decisão comercial do admin) ela vira o sinal
  // que distingue os dois fechamentos.

  it("sessão que caiu (closed com a voz ainda ligada) diz que caiu, em vez de fingir que nunca existiu", () => {
    sessions = [{ ...sessaoAberta, status: "closed" }]; // i-1 tem voice_calls_enabled: true
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/voz interrompida/i)).toBeInTheDocument();
    expect(screen.queryByText("Voz ativa")).not.toBeInTheDocument();
  });

  // O sintoma 2 da issue: o botão sumia justamente na sessão que precisava dele.
  // É o único caminho pela tela para mandar a VPS soltar o que sobrou.
  it("sessão que caiu mantém o Desconectar — é o único caminho de limpeza do cliente", async () => {
    const user = userEvent.setup();
    sessions = [{ ...sessaoAberta, status: "closed" }];
    render(<TorqueCallsSettings />);
    await user.click(screen.getByRole("button", { name: /desconectar/i }));
    expect(logoutVoiceSession).toHaveBeenCalledWith({ tcSessionId: "tc-1", organizationId: "org-1" });
  });

  // E o repareamento continua na tela: limpar e reativar são ações diferentes, e
  // quem caiu precisa das duas. A consulta é escopada à LINHA do número — a
  // outra instância também tem um "Ativar voz", e uma busca na página inteira
  // passaria mesmo se este número não tivesse nenhum.
  it("sessão que caiu oferece também o caminho de volta, na própria linha", () => {
    sessions = [{ ...sessaoAberta, status: "closed" }];
    render(<TorqueCallsSettings />);
    const linha = linhaDoNumero("Comercial");
    expect(within(linha).getByRole("button", { name: /ativar voz/i })).toBeInTheDocument();
    expect(within(linha).getByRole("button", { name: /desconectar/i })).toBeInTheDocument();
  });

  // O contrapeso: desconectar de propósito não pode virar alarme permanente.
  // `logoutSession` já desligou a chave, então não há nada a limpar nem a
  // consertar — e a tela volta a oferecer só "Ativar voz".
  it("sessão desligada de propósito não vira alarme", () => {
    sessions = [{ ...sessaoAberta, status: "closed", whatsappInstanceId: "i-2" }]; // i-2: voz desligada
    render(<TorqueCallsSettings />);
    expect(screen.queryByText(/voz interrompida/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /desconectar/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /ativar voz/i })).toHaveLength(2);
  });

  // A queda NÃO devolve a vaga do teto por si só — quem a devolve é o `closed`,
  // e ele já está aplicado. Este caso existe para travar o predicado do teto no
  // lugar: ele continua sendo `status !== "closed"`, e não passa a olhar a chave.
  it("sessão que caiu continua fora do teto", () => {
    cap = 1;
    sessions = [{ ...sessaoAberta, status: "closed" }];
    render(<TorqueCallsSettings />);
    expect(screen.getByText(/0 de 1/i)).toBeInTheDocument();
  });
});
