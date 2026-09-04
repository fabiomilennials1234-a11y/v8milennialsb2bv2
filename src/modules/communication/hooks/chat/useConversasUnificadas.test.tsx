/**
 * A LISTA por conjunto de caixas.
 *
 * O que este arquivo guarda é a decisão D3: o limite é GLOBAL, aplicado pelo
 * servidor sobre o conjunto. Uma chamada por caixa, com o limite em cada uma e a
 * ordenação no cliente, faz a paginação mentir — a caixa movimentada gasta a
 * página e a conversa real da caixa quieta some sem sinal na tela.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", async (importOriginal) => ({
  // Spread do módulo real: uma lista de exports faria um export novo sumir do
  // dublê, e o teste passaria por ausência.
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => teamMemberMock(),
}));

// O enriquecimento tem cobertura própria e fala com quatro tabelas; aqui ele é
// dublado para que a asserção seja sobre a LISTA, não sobre nome e etiqueta.
const enriquecerMock = vi.fn(async (contatos: unknown[]) => contatos);
vi.mock("./shared/enriquecerContatos", () => ({
  enriquecerContatos: (...a: unknown[]) => enriquecerMock(...(a as [unknown[]])),
}));

import { useConversasUnificadas } from "./useConversasUnificadas";
import type { InboxBox } from "./types";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const CHIP_A: InboxBox = { kind: "whatsapp", id: "cx-a", name: "Carol", status: "connected", provider: "uazapi" };
const CHIP_B: InboxBox = { kind: "whatsapp", id: "cx-b", name: "Técnica", status: "connected", provider: "uazapi" };
const OFICIAL: InboxBox = { kind: "whatsapp", id: "cx-of", name: "Chiquê", status: "connected", provider: "notificame" };
const INSTA: InboxBox = { kind: "instagram", id: "cx-ig", name: "@chique", status: "connected", handle: "chique" };

function linhaDeChip(instance_id: string, phone: string, quando: string) {
  return {
    instance_id,
    phone_number: phone,
    normalized_phone: phone,
    push_name: `chip ${phone}`,
    last_message: "oi",
    last_message_time: quando,
    last_message_direction: "incoming",
    last_message_sent_source: null,
    lead_id: null,
    is_group: false,
    conversation_id: null,
    archived_at: null,
    unread_count: 0,
  };
}

function linhaOficial(instance_id: string, externo: string, quando: string) {
  return {
    instance_id,
    contact_external_id: externo,
    sender_name: "Cliente Oficial",
    sender_profile_pic: null,
    contact_handle: null,
    last_message: "oi pelo oficial",
    last_message_time: quando,
    last_message_direction: "incoming",
    unread_count: 0,
    lead_id: null,
    lead_name: null,
  };
}

const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  rpcMock.mockReset();
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
  enriquecerMock.mockClear();
});

describe("useConversasUnificadas", () => {
  it("duas caixas de Chip viram UMA chamada com o array das duas", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A, CHIP_B]), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    const chamadasDeChip = rpcMock.mock.calls.filter(
      ([nome]) => nome === "get_whatsapp_conversation_list_multi",
    );
    expect(chamadasDeChip).toHaveLength(1);
    expect(chamadasDeChip[0][1]).toMatchObject({
      p_org: ORG,
      p_instances: ["cx-a", "cx-b"],
    });
    expect(result.current.isError).toBe(false);
  });

  it("Chip + canal oficial: duas RPCs, e a lista sai MISTURADA por recência", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "get_whatsapp_conversation_list_multi") {
        return {
          data: [
            linhaDeChip("cx-a", "5548911110000", "2026-09-03T12:00:00Z"),
            linhaDeChip("cx-a", "5548922220000", "2026-09-03T08:00:00Z"),
          ],
          error: null,
        };
      }
      return {
        data: [linhaOficial("cx-of", "5548933330000", "2026-09-03T10:00:00Z")],
        error: null,
      };
    });

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A, OFICIAL]), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(result.current.linhas).toHaveLength(3));

    // A do meio é a do canal oficial: se as fontes fossem concatenadas, ela
    // apareceria no fim, depois de um bloco morto.
    expect(result.current.linhas.map((l) => l.caixa.id)).toEqual(["cx-a", "cx-of", "cx-a"]);
  });

  it("a caixa da linha sai da RESPOSTA, não do array pedido", async () => {
    // A interseção de acesso acontece DENTRO da RPC: o conjunto que ela leu pode
    // ser menor que o pedido, e derivar a caixa do argumento seria adivinhar.
    rpcMock.mockImplementation(async (nome: string) =>
      nome === "get_whatsapp_conversation_list_multi"
        ? { data: [linhaDeChip("cx-b", "5548911110000", "2026-09-03T12:00:00Z")], error: null }
        : { data: [], error: null },
    );

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A, CHIP_B]), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(result.current.linhas).toHaveLength(1));

    expect(result.current.linhas[0].caixa.id).toBe("cx-b");
    expect(result.current.linhas[0].chave).toBe("whatsapp:cx-b:5548911110000");
  });

  it("caixa de Instagram não entra nesta lista — ela abre sozinha até a W5", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useConversasUnificadas([INSTA]), { wrapper: wrap(newQc()) });

    // Nem rede, nem RPC social: quem cuida do Instagram é o caminho de antes.
    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("conjunto vazio não chama a rede", async () => {
    renderHook(() => useConversasUnificadas([]), { wrapper: wrap(newQc()) });

    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("erro da RPC sobe — lista vazia passaria por resposta", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A]), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("a mesma seleção em ordem diferente é a MESMA query", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const qc = newQc();

    renderHook(() => useConversasUnificadas([CHIP_A, CHIP_B]), { wrapper: wrap(qc) });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const antes = rpcMock.mock.calls.length;

    renderHook(() => useConversasUnificadas([CHIP_B, CHIP_A]), { wrapper: wrap(qc) });
    await new Promise((r) => setTimeout(r, 10));

    // Sem a ordenação dos ids seriam duas entradas de cache com a mesma
    // resposta — e cada patch de tempo real acertaria só uma delas.
    expect(rpcMock.mock.calls.length).toBe(antes);
  });

  it("base sem a migration: cai para a RPC de UMA caixa, uma por caixa", async () => {
    // Ordem de deploy — front novo, migration `20270921000000` ainda não
    // aplicada. Sem a queda, o /chat inteiro fica vazio para todas as orgs.
    rpcMock.mockImplementation(async (nome: string, args: Record<string, unknown>) => {
      if (nome.endsWith("_multi")) {
        return { data: null, error: { code: "PGRST202", message: "not found" } };
      }
      if (nome === "get_whatsapp_conversation_list") {
        return {
          data: [
            linhaDeChip(
              String(args.p_instance),
              `5548911110000`,
              args.p_instance === "cx-a" ? "2026-09-03T12:00:00Z" : "2026-09-03T11:00:00Z",
            ),
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A, CHIP_B]), {
      wrapper: wrap(newQc()),
    });
    await waitFor(() => expect(result.current.linhas).toHaveLength(2));

    const antigas = rpcMock.mock.calls.filter(
      ([nome]) => nome === "get_whatsapp_conversation_list",
    );
    expect(antigas.map(([, args]) => args.p_instance)).toEqual(["cx-a", "cx-b"]);
    // A caixa da linha vem do argumento SÓ neste caminho, porque ali a chamada é
    // uma por caixa — e é o que mantém as chaves distintas.
    expect(result.current.linhas.map((l) => l.chave)).toEqual([
      "whatsapp:cx-a:5548911110000",
      "whatsapp:cx-b:5548911110000",
    ]);
  });

  it("erro que NÃO é função ausente continua subindo", async () => {
    // A queda é estreita de propósito: permissão, argumento e timeout precisam
    // chegar à tela, senão ela vira um jeito de esconder defeito.
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });

    const { result } = renderHook(() => useConversasUnificadas([CHIP_A]), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
