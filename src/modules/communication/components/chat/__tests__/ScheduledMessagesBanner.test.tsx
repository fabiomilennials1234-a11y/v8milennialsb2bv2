/**
 * Bandeja B1 de mensagens programadas — o que a pessoa vê e pode fazer.
 *
 * Fixtures fictícias. Dublês por spread (`importOriginal`) — só o que o teste
 * controla é sobrescrito.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ScheduledMessage } from "@/modules/communication/hooks/useScheduledMessages";
import { __resetComposerTrayBus, publishComposerEscape, publishComposerHasText, usePendingBadge } from "@/modules/communication/lib/composerTrayBus";

const h = vi.hoisted(() => ({
  lead: [] as ScheduledMessage[],
  conv: [] as ScheduledMessage[],
  isMaster: false,
  enviarAgora: vi.fn(),
  cancelar: vi.fn(),
  tentar: vi.fn(),
  descartar: vi.fn(),
  toast: Object.assign(vi.fn(() => "toast-id"), { success: vi.fn(), dismiss: vi.fn(), error: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: h.toast }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

vi.mock("@/modules/communication/hooks/useScheduledMessages", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScheduledMessagesForLead: () => ({ data: h.lead }),
  useScheduledMessagesForConversation: () => ({ data: h.conv }),
  useSendScheduledMessageNow: () => ({ mutate: h.enviarAgora, isPending: false }),
  useCancelScheduledMessage: () => ({ mutate: h.cancelar, isPending: false }),
  useRetryFailedScheduledMessage: () => ({ mutate: h.tentar, isPending: false }),
  useDiscardFailedScheduledMessage: () => ({ mutate: h.descartar, isPending: false }),
}));

vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => ({ data: { id: "tm-eu" } }),
  useIdentity: () => ({ isMaster: h.isMaster }),
  useTeamMembers: () => ({ data: [{ id: "tm-eu", name: "Gabriel" }, { id: "tm-ana", name: "Ana Ribeiro" }] }),
}));

vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));

import { ScheduledMessagesBanner } from "../ScheduledMessagesBanner";

const KEY = "inst:5511999990000";

function emMin(m: number) {
  return new Date(Date.now() + m * 60_000).toISOString();
}

function msg(over: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: "m1",
    organization_id: "org",
    lead_id: null,
    phone_number: "5511999990000",
    created_by: "tm-eu",
    assigned_to: "tm-eu",
    whatsapp_instance_id: "inst",
    message_content: "Oi Marcelo! Já gerei a segunda via do boleto.",
    media_url: null,
    media_type: null,
    media_filename: null,
    scheduled_at: emMin(36),
    status: "scheduled",
    sent_at: null,
    error_message: null,
    retry_count: 0,
    created_at: emMin(-20),
    ...over,
  };
}

function Badge({ chave }: { chave: string }) {
  return <output data-testid="badge">{usePendingBadge(chave)}</output>;
}

function montar(key = KEY) {
  return render(
    <>
      <ScheduledMessagesBanner leadId={null} leadName="Marcelo" phoneNumber="5511999990000" instanceId="inst" conversationKey={key} />
      <Badge chave={key} />
    </>,
  );
}

const topo = () => screen.getByRole("button", { name: /(Mostrar|Ocultar) fila$/ });

beforeEach(() => {
  h.lead = [];
  h.conv = [];
  h.isMaster = false;
  vi.clearAllMocks();
  __resetComposerTrayBus();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScheduledMessagesBanner (B1)", () => {
  it("sem nada programado não renderiza", () => {
    const { container } = render(
      <ScheduledMessagesBanner leadId={null} leadName="x" phoneNumber="1" instanceId="inst" conversationKey="vazia" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fechada: título, +N, selo do Enviar; abre e fecha com Esc devolvendo o foco", () => {
    h.conv = [
      msg({ id: "a" }),
      msg({ id: "b", scheduled_at: emMin(126), created_by: "tm-ana", media_type: "document", message_content: "Segue a segunda via." }),
      msg({ id: "c", scheduled_at: emMin(60 * 20) }),
    ];
    montar("k-abre");
    const botao = screen.getByRole("button", { name: /3 programadas/ });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveTextContent(/Próxima sai em 3[56] min · hoje/);
    expect(botao).toHaveTextContent("+2");
    expect(screen.queryByRole("region", { name: "Fila de mensagens programadas" })).toBeNull();

    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    const fila = screen.getByRole("region", { name: "Fila de mensagens programadas" });
    expect(within(fila).getAllByTestId("linha-programada")).toHaveLength(3);
    expect(within(fila).getByRole("group", { name: "Hoje" })).toBeInTheDocument();
    expect(within(fila).getByText("Documento")).toBeInTheDocument();

    fireEvent.keyDown(fila, { key: "Escape" });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(botao);
  });

  it("publica o contador do Enviar só com a bandeja fechada", () => {
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) })];
    montar();
    expect(screen.getByTestId("badge")).toHaveTextContent("2");
    fireEvent.click(topo());
    expect(screen.getByTestId("badge")).toHaveTextContent("0");
  });

  it("urgente (<15 min) e enviando mudam o anel e o título", () => {
    h.conv = [msg({ id: "a", scheduled_at: emMin(4) })];
    const { unmount } = montar("k-urg");
    expect(screen.getByRole("button", { name: /Sai em 4 min/ })).toBeInTheDocument();
    expect(document.querySelector("[data-anel='urgente']")).not.toBeNull();
    unmount();

    h.conv = [msg({ id: "a", status: "sending", scheduled_at: emMin(0) })];
    montar("k-env");
    expect(screen.getByRole("button", { name: /Enviando agora/ })).toBeInTheDocument();
    expect(document.querySelector("[data-anel='enviando']")).not.toBeNull();
  });

  it("falha domina o topo, fora do contador, com motivo legível e ações", () => {
    h.conv = [
      msg({ id: "f", status: "failed", scheduled_at: emMin(-12), error_message: "Instance disconnected" }),
      msg({ id: "a" }),
      msg({ id: "b", scheduled_at: emMin(90) }),
    ];
    montar("k-falha");
    const botao = topo();
    expect(botao).toHaveTextContent(/Não enviada · última tentativa \d\d:\d\d/);
    expect(botao).toHaveTextContent("WhatsApp desconectado no horário do envio");
    expect(botao).toHaveTextContent("+2");
    expect(screen.getByTestId("badge")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(h.tentar).toHaveBeenCalledWith("f");
  });

  it("Enviar agora pede 2º clique dentro de 3 s; depois a janela fecha", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    h.conv = [msg({ id: "a" })];
    montar("k-conf");
    fireEvent.click(topo());

    fireEvent.click(screen.getByRole("button", { name: /Enviar agora/ }));
    expect(h.enviarAgora).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirmar envio/ })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    expect(screen.queryByRole("button", { name: /Confirmar envio/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Enviar agora/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar envio/ }));
    expect(h.enviarAgora).toHaveBeenCalledTimes(1);
    expect(h.enviarAgora).toHaveBeenCalledWith("a");
  });

  it("mensagem de outro membro: mostra o autor, sem botões de escrita", () => {
    h.conv = [msg({ id: "minha" }), msg({ id: "dela", created_by: "tm-ana", scheduled_at: emMin(90) })];
    montar("k-perm");
    fireEvent.click(topo());
    const [minha, dela] = screen.getAllByTestId("linha-programada");
    expect(within(minha).getByText("por Você")).toBeInTheDocument();
    expect(within(minha).getByRole("button", { name: /Enviar agora/ })).toBeInTheDocument();
    expect(within(dela).getByText("por Ana Ribeiro")).toBeInTheDocument();
    expect(within(dela).queryByRole("button")).toBeNull();
  });

  it("falha de outro membro: sem Tentar de novo / Descartar", () => {
    h.conv = [msg({ id: "f", status: "failed", created_by: "tm-ana", scheduled_at: emMin(-5) })];
    montar("k-perm-falha");
    const acoes = screen.getByTestId("falha-acoes");
    expect(within(acoes).queryByRole("button")).toBeNull();
    expect(acoes).toHaveTextContent("por Ana Ribeiro");
  });

  it("master escreve em mensagem de qualquer um", () => {
    h.isMaster = true;
    h.conv = [msg({ id: "dela", created_by: "tm-ana" })];
    montar("k-master");
    fireEvent.click(topo());
    expect(screen.getByRole("button", { name: /Enviar agora/ })).toBeInTheDocument();
  });

  it("digitando com a bandeja fechada: aresta acende e avisa a fila; Ver fila abre", () => {
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) }), msg({ id: "c", scheduled_at: emMin(200) })];
    montar("k-dig");
    expect(screen.queryByText(/Este contato já tem/)).toBeNull();
    act(() => publishComposerHasText("k-dig", true));
    expect(screen.getByText("Este contato já tem 3 programadas.")).toBeInTheDocument();
    expect(document.querySelector("[data-estado='digitando']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver fila" }));
    expect(screen.getByRole("region", { name: "Fila de mensagens programadas" })).toBeInTheDocument();
    expect(screen.queryByText(/Este contato já tem/)).toBeNull();
  });

  it("estado aberto é lembrado por conversa", () => {
    h.conv = [msg({ id: "a" })];
    const { unmount } = montar("k-mem");
    fireEvent.click(topo());
    unmount();
    montar("k-mem");
    expect(topo()).toHaveAttribute("aria-expanded", "true");
  });

  it("Cancelar esconde a linha, oferece Desfazer e só grava ao fim de 5 s", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) })];
    montar("k-cancel");
    fireEvent.click(topo());
    const [primeira] = screen.getAllByTestId("linha-programada");
    fireEvent.click(within(primeira).getByRole("button", { name: /Cancelar/ }));
    expect(screen.getAllByTestId("linha-programada")).toHaveLength(1);
    expect(h.toast).toHaveBeenCalledWith("Programação cancelada", expect.objectContaining({ duration: 5000 }));
    expect(h.cancelar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(h.cancelar).toHaveBeenCalledTimes(1);
    expect(h.cancelar.mock.calls[0][0]).toBe("a");
  });

  it("Desfazer devolve a linha e não grava nada", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) })];
    montar("k-desfaz");
    fireEvent.click(topo());
    fireEvent.click(within(screen.getAllByTestId("linha-programada")[0]).getByRole("button", { name: /Cancelar/ }));
    const opcoes = (h.toast.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }])[1];
    act(() => opcoes.action.onClick());
    expect(screen.getAllByTestId("linha-programada")).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.cancelar).not.toHaveBeenCalled();
  });

  it("trocar de conversa dentro da janela COMMITA o cancelamento", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) })];
    const { unmount } = montar("k-unmount");
    fireEvent.click(topo());
    fireEvent.click(within(screen.getAllByTestId("linha-programada")[0]).getByRole("button", { name: /Cancelar/ }));
    expect(h.cancelar).not.toHaveBeenCalled();
    unmount();
    expect(h.cancelar).toHaveBeenCalledTimes(1);
    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-id");
  });

  it("cancelar o que sai em menos de 1 min grava na hora, sem Desfazer", () => {
    h.conv = [msg({ id: "a", scheduled_at: emMin(0.2) }), msg({ id: "b", scheduled_at: emMin(90) })];
    montar("k-imin");
    fireEvent.click(topo());
    fireEvent.click(within(screen.getAllByTestId("linha-programada")[0]).getByRole("button", { name: /Cancelar/ }));
    expect(h.cancelar).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith("Programação cancelada");
  });

  it("Descartar a falha também espera a janela do Desfazer", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    h.conv = [msg({ id: "f", status: "failed", scheduled_at: emMin(-12) }), msg({ id: "a" })];
    montar("k-desc");
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    expect(h.toast).toHaveBeenCalledWith("Falha descartada", expect.anything());
    expect(screen.queryByText(/Não enviada/)).toBeNull();
    expect(h.descartar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(h.descartar.mock.calls[0][0]).toBe("f");
  });

  it("mais de uma falha mostra +N falha", () => {
    h.conv = [
      msg({ id: "f1", status: "failed", scheduled_at: emMin(-12) }),
      msg({ id: "f2", status: "failed", scheduled_at: emMin(-60) }),
    ];
    montar("k-2falhas");
    expect(screen.getByText("+1 falha")).toBeInTheDocument();
  });

  it("sending há mais de 5 min: Envio travado, fora do selo", () => {
    h.conv = [msg({ id: "t", status: "sending", scheduled_at: emMin(-6) }), msg({ id: "a" })];
    montar("k-trav");
    expect(topo()).toHaveTextContent("Envio travado · verifique em instantes");
    expect(screen.getByTestId("badge")).toHaveTextContent("1");
  });

  it("Ver fila leva o foco ao topo da bandeja, e Esc continua funcionando", () => {
    h.conv = [msg({ id: "a" }), msg({ id: "b", scheduled_at: emMin(90) })];
    montar("k-foco");
    act(() => publishComposerHasText("k-foco", true));
    fireEvent.click(screen.getByRole("button", { name: "Ver fila" }));
    const botao = topo();
    expect(document.activeElement).toBe(botao);
    fireEvent.keyDown(botao, { key: "Escape" });
    expect(botao).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc no campo do composer fecha a bandeja aberta", () => {
    h.conv = [msg({ id: "a" })];
    montar("k-esc");
    fireEvent.click(topo());
    expect(topo()).toHaveAttribute("aria-expanded", "true");
    act(() => publishComposerEscape("k-esc"));
    expect(topo()).toHaveAttribute("aria-expanded", "false");
  });
});
