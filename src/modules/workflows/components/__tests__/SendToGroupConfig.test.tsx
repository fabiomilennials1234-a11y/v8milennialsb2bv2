/**
 * SendToGroupConfig — painel do nó "Enviar p/ grupo".
 *
 * Prende o que o executor depende: só instância viva + Uazapi é oferecida,
 * trocar de instância LIMPA o grupo (o grupo é do número), a lista grava
 * `{groupJid, groupName}`, e quando a lista falha o campo manual só aceita JID
 * no formato que o executor aceita.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const SDR = {
  id: "inst-sdr",
  instance_name: "torque sdr",
  phone_number: "5548999990000",
  provider: "uazapi",
  status: "connected",
  session_dead_since: null,
};
const COMERCIAL = { ...SDR, id: "inst-com", instance_name: "Comercial", phone_number: "5548888880000" };
const EVO = { ...SDR, id: "inst-evo", instance_name: "Evo", provider: "evolution" };
const OFICIAL = { ...SDR, id: "inst-of", instance_name: "Oficial", provider: "notificame" };
const CAIDA = { ...SDR, id: "inst-caida", instance_name: "Caída", status: "disconnected" };

type GroupsState = {
  data?: { groups: { jid: string; name: string }[]; truncated: boolean };
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
};

let instancias: unknown[] = [];
let grupos: GroupsState = { isLoading: false, isError: false };
const groupsHook = vi.fn();

vi.mock("@/modules/communication", () => ({
  useWhatsAppInstances: () => ({ data: instancias, isLoading: false }),
}));
// O inseridor de variáveis lê org/auth; não é o assunto aqui.
vi.mock("@/modules/workflows/components/VariableInserter", () => ({
  VariableInserter: () => null,
}));
vi.mock("@/modules/workflows/hooks/useInstanceGroups", () => ({
  useInstanceGroups: (id: string | null | undefined) => {
    groupsHook(id);
    return grupos;
  },
}));

import { SendToGroupConfig } from "@/modules/workflows/components/sidebar-panels/SendToGroupConfig";

function montar(data: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  render(<SendToGroupConfig data={{ actionType: "send_to_group", ...data } as never} onUpdate={onUpdate} />);
  return { onUpdate };
}

beforeEach(() => {
  instancias = [SDR, COMERCIAL, EVO, OFICIAL, CAIDA];
  grupos = { isLoading: false, isError: false };
  groupsHook.mockClear();
});

describe("seletor de instância", () => {
  it("oferece só instâncias vivas e Uazapi", () => {
    montar();
    fireEvent.click(screen.getByLabelText("Número que envia"));
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(opcoes.some((o) => o.includes("torque sdr"))).toBe(true);
    expect(opcoes.some((o) => o.includes("Comercial"))).toBe(true);
    expect(opcoes.some((o) => o.includes("Evo"))).toBe(false);
    expect(opcoes.some((o) => o.includes("Oficial"))).toBe(false);
    expect(opcoes.some((o) => o.includes("Caída"))).toBe(false);
  });

  it("trocar de instância grava a fixa e LIMPA o grupo", () => {
    const { onUpdate } = montar({
      whatsappInstanceId: SDR.id,
      whatsappInstanceName: SDR.instance_name,
      groupJid: "120363041234567890@g.us",
      groupName: "Time",
    });
    fireEvent.click(screen.getByLabelText("Número que envia"));
    fireEvent.click(screen.getByRole("option", { name: /Comercial/ }));
    expect(onUpdate).toHaveBeenCalledWith({
      whatsappInstanceId: COMERCIAL.id,
      whatsappInstanceName: COMERCIAL.instance_name,
      instanceRoutingPolicy: "fixed",
      groupJid: "",
      groupName: "",
    });
  });

  it("sem instância apta, avisa e não mostra seletor de grupo", () => {
    instancias = [EVO, OFICIAL];
    montar();
    expect(screen.getByText(/nenhum número uazapi conectado/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /grupo/i })).not.toBeInTheDocument();
  });

  it("instância gravada que não está mais apta é sinalizada", () => {
    montar({ whatsappInstanceId: "sumiu", whatsappInstanceName: "Antiga" });
    expect(screen.getByText(/não está conectado ou não envia para grupos/i)).toBeInTheDocument();
  });
});

describe("seletor de grupo", () => {
  it("sem instância escolhida, não consulta a lista", () => {
    montar();
    expect(groupsHook).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText(/escolha o número primeiro/i)).toBeInTheDocument();
  });

  it("lista ok: escolher um grupo grava jid e nome", () => {
    grupos = {
      isLoading: false,
      isError: false,
      data: {
        groups: [
          { jid: "120363000000000001@g.us", name: "Comercial SP" },
          { jid: "120363000000000002@g.us", name: "Suporte" },
        ],
        truncated: false,
      },
    };
    const { onUpdate } = montar({ whatsappInstanceId: SDR.id });
    expect(groupsHook).toHaveBeenLastCalledWith(SDR.id);
    fireEvent.click(screen.getByRole("combobox", { name: /grupo de destino/i }));
    fireEvent.click(screen.getByText("Suporte"));
    expect(onUpdate).toHaveBeenCalledWith({ groupJid: "120363000000000002@g.us", groupName: "Suporte" });
  });

  it("busca filtra por nome", () => {
    grupos = {
      isLoading: false,
      isError: false,
      data: {
        groups: [
          { jid: "120363000000000001@g.us", name: "Comercial SP" },
          { jid: "120363000000000002@g.us", name: "Suporte" },
        ],
        truncated: false,
      },
    };
    montar({ whatsappInstanceId: SDR.id });
    fireEvent.click(screen.getByRole("combobox", { name: /grupo de destino/i }));
    fireEvent.change(screen.getByPlaceholderText(/buscar grupo/i), { target: { value: "sup" } });
    expect(screen.queryByText("Comercial SP")).not.toBeInTheDocument();
    expect(screen.getByText("Suporte")).toBeInTheDocument();
  });

  it("carregando mostra estado de carregamento", () => {
    grupos = { isLoading: true, isError: false };
    montar({ whatsappInstanceId: SDR.id });
    expect(screen.getByText(/carregando grupos/i)).toBeInTheDocument();
  });

  it("lista vazia explica e ainda oferece o campo manual", () => {
    grupos = { isLoading: false, isError: false, data: { groups: [], truncated: false } };
    const { onUpdate } = montar({ whatsappInstanceId: SDR.id });
    expect(screen.getByText(/instância não participa de nenhum grupo/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ID do grupo"), { target: { value: "120363041234567890@g.us" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ groupJid: "120363041234567890@g.us", groupName: "" });
  });

  it("lista vazia não esconde o JID já salvo no nó", () => {
    grupos = { isLoading: false, isError: false, data: { groups: [], truncated: false } };
    montar({ whatsappInstanceId: SDR.id, groupJid: "120363041234567890@g.us" });
    expect(screen.getByLabelText("ID do grupo")).toHaveValue("120363041234567890@g.us");
  });

  it("apagar ou invalidar o JID manual LIMPA o nó (não sobra o grupo antigo)", () => {
    grupos = { isLoading: false, isError: true, error: new Error("falhou") };
    const { onUpdate } = montar({ whatsappInstanceId: SDR.id, groupJid: "120363041234567890@g.us", groupName: "Antigo" });
    const campo = screen.getByLabelText("ID do grupo");
    expect(campo).toHaveValue("120363041234567890@g.us");

    fireEvent.change(campo, { target: { value: "" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ groupJid: "", groupName: "" });

    fireEvent.change(campo, { target: { value: "lixo@g.us" } });
    expect(onUpdate).toHaveBeenLastCalledWith({ groupJid: "", groupName: "" });
  });

  it("truncated avisa que a lista foi cortada", () => {
    grupos = {
      isLoading: false,
      isError: false,
      data: { groups: [{ jid: "120363000000000001@g.us", name: "A" }], truncated: true },
    };
    montar({ whatsappInstanceId: SDR.id });
    expect(screen.getByText(/primeiros 1\.000 grupos/i)).toBeInTheDocument();
  });

  it("erro na lista → campo manual que só grava JID válido", () => {
    grupos = { isLoading: false, isError: true, error: new Error("whatsapp-api-proxy: Sem permissão") };
    const { onUpdate } = montar({ whatsappInstanceId: SDR.id });
    expect(screen.getByText(/não foi possível listar os grupos/i)).toBeInTheDocument();

    const campo = screen.getByLabelText("ID do grupo");
    fireEvent.change(campo, { target: { value: "120363041234567890@g.us.evil" } });
    expect(screen.getByText(/formato inválido/i)).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ groupJid: "120363041234567890@g.us.evil" }));
    expect(onUpdate).toHaveBeenLastCalledWith({ groupJid: "", groupName: "" });

    fireEvent.change(campo, { target: { value: " 120363041234567890@g.us " } });
    expect(onUpdate).toHaveBeenLastCalledWith({ groupJid: "120363041234567890@g.us", groupName: "" });
  });
});

describe("mensagem e resumo", () => {
  it("o switch de resumo avisa que o grupo inteiro verá o resumo e o telefone", () => {
    const { onUpdate } = montar({ whatsappInstanceId: SDR.id });
    expect(
      screen.getByText(/serão vistos por todos os membros do grupo e ficam registrados no histórico do chat do CRM/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(onUpdate).toHaveBeenCalledWith({ includeConversationSummary: true });
  });
});
