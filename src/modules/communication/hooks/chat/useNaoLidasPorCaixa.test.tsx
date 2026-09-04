/**
 * O contrato desta fatia é o que a tela promete: desmarcar uma caixa esconde a
 * LISTA dela, nunca o aviso de que chegou mensagem. Os casos aqui são os quatro
 * jeitos de essa promessa quebrar em silêncio — a caixa some do mapa, a caixa
 * sem fonte finge estar em dia, a soma conta a conversa em vez da instância, e o
 * erro da RPC derruba o seletor inteiro.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

// Dublê por SPREAD do módulo real: o client exporta mais do que `supabase`, e um
// dublê por LISTA passaria a mentir no dia em que um export novo aparecesse —
// o teste ficaria verde contra um módulo que não existe mais assim.
vi.mock("@/integrations/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/supabase/client")>();
  return {
    ...actual,
    supabase: { ...actual.supabase, rpc: (...args: unknown[]) => rpcMock(...args) },
  };
});

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/identity")>();
  return { ...actual, useCurrentTeamMember: () => teamMemberMock() };
});

import { useNaoLidasPorCaixa } from "./useNaoLidasPorCaixa";
import type { InboxBox } from "./types";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";

// Os três formatos que convivem numa org real: o Chip (uazapi), o canal oficial
// (notificame, que grava em `channel_messages`) e o Instagram. É a Chiquê.
const CHIP: InboxBox = {
  kind: "whatsapp",
  id: "11111111-1111-4111-8111-111111111111",
  name: "Carol",
  status: "connected",
  provider: "uazapi",
};
const CHIP_2: InboxBox = {
  kind: "whatsapp",
  id: "22222222-2222-4222-8222-222222222222",
  name: "Comercial",
  status: "connected",
  provider: "uazapi",
};
const OFICIAL: InboxBox = {
  kind: "whatsapp",
  id: "33333333-3333-4333-8333-333333333333",
  name: "Chiquê",
  status: "connected",
  provider: "notificame",
};
const INSTAGRAM: InboxBox = {
  kind: "instagram",
  id: "44444444-4444-4444-8444-444444444444",
  name: "@chique",
  status: "connected",
  handle: "chique",
};

const linha = (instanceId: string, phone: string, unread: number) => ({
  instance_id: instanceId,
  normalized_phone: phone,
  unread,
});

const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

const renderizar = (caixas: InboxBox[]) =>
  renderHook(() => useNaoLidasPorCaixa(caixas), { wrapper: wrap(newQc()) });

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
});

describe("useNaoLidasPorCaixa", () => {
  it("soma as conversas de uma instância numa contagem só — a RPC devolve por conversa", async () => {
    rpcMock.mockResolvedValue({
      data: [
        linha(CHIP.id, "554899990001", 3),
        linha(CHIP.id, "554899990002", 1),
        linha(CHIP.id, "554899990003", 2),
        linha(CHIP_2.id, "554899990004", 5),
      ],
      error: null,
    });

    const { result } = renderizar([CHIP, CHIP_2]);

    await waitFor(() =>
      expect(result.current.porCaixa.get(CHIP.id)?.estado).toBe("contada"),
    );
    expect(result.current.porCaixa.get(CHIP.id)?.naoLidas).toBe(6);
    expect(result.current.porCaixa.get(CHIP_2.id)?.naoLidas).toBe(5);
  });

  it("chama a RPC uma vez, com os ids ORDENADOS — a mesma pergunta não pode virar dois caches", async () => {
    const { result } = renderizar([CHIP_2, CHIP]);

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith("get_unread_counts", {
      p_instance_ids: [CHIP.id, CHIP_2.id].sort(),
    });
    expect(result.current.parcial).toBe(false);
  });

  it("instância sem nenhuma conversa não lida devolve 0 e CONTINUA no mapa", async () => {
    // CHIP_2 não aparece na resposta: a RPC só emite linha de conversa não lida.
    rpcMock.mockResolvedValue({ data: [linha(CHIP.id, "554899990001", 2)], error: null });

    const { result } = renderizar([CHIP, CHIP_2]);

    await waitFor(() =>
      expect(result.current.porCaixa.get(CHIP_2.id)?.estado).toBe("contada"),
    );
    // Sumir do mapa seria indistinguível de "perdeu o acesso a esta caixa".
    expect(result.current.porCaixa.get(CHIP_2.id)?.naoLidas).toBe(0);
    expect(result.current.porCaixa.size).toBe(2);
  });

  it("caixa que lê channel_messages sai como 'sem-fonte', nunca como zero", async () => {
    const { result } = renderizar([CHIP, OFICIAL, INSTAGRAM]);

    await waitFor(() => expect(result.current.porCaixa.get(CHIP.id)?.estado).toBe("contada"));

    for (const semFonte of [OFICIAL, INSTAGRAM]) {
      const entrada = result.current.porCaixa.get(semFonte.id);
      expect(entrada?.estado).toBe("sem-fonte");
      // `null`, e não `0`: zero é a afirmação "nada novo aqui", e esta função
      // não lê a tabela que responderia por essa caixa.
      expect(entrada?.naoLidas).toBeNull();
    }
    expect(result.current.semFonte).toEqual([OFICIAL.id, INSTAGRAM.id]);
    expect(result.current.parcial).toBe(true);

    // E o id sem fonte não pode ir na RPC: ela devolveria vazio e o resultado
    // vazio viraria um zero mentiroso na semente.
    expect(rpcMock).toHaveBeenCalledWith("get_unread_counts", {
      p_instance_ids: [CHIP.id],
    });
  });

  it("nenhuma caixa com fonte não chama a rede — org só de canal oficial", async () => {
    const { result } = renderizar([OFICIAL, INSTAGRAM]);

    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
    // Nem esqueleto eterno: a query está desligada, não carregando.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.parcial).toBe(true);
  });

  it("sem organização não chama a rede — o recorte multi-tenant não fecharia", async () => {
    teamMemberMock.mockReturnValue({ data: null });

    renderizar([CHIP]);

    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("zero caixa não chama a rede e devolve mapa vazio", async () => {
    const { result } = renderizar([]);

    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.porCaixa.size).toBe(0);
    expect(result.current.parcial).toBe(false);
  });

  it("erro da RPC não derruba a tela: as caixas seguem no mapa, sem número", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const { result } = renderizar([CHIP, OFICIAL]);

    await waitFor(() => expect(result.current.isError).toBe(true));
    // O seletor continua desenhável — e nenhuma caixa passa a alegar "em dia".
    expect(result.current.porCaixa.get(CHIP.id)).toEqual({
      caixaId: CHIP.id,
      estado: "indisponivel",
      naoLidas: null,
    });
    expect(result.current.porCaixa.get(OFICIAL.id)?.estado).toBe("sem-fonte");
  });

  it("linha de caixa fora do conjunto pedido é descartada — a RPC recorta por org, não pelo conjunto", async () => {
    rpcMock.mockResolvedValue({
      data: [
        linha(CHIP.id, "554899990001", 1),
        linha("99999999-9999-4999-8999-999999999999", "554899990009", 40),
      ],
      error: null,
    });

    const { result } = renderizar([CHIP]);

    await waitFor(() => expect(result.current.porCaixa.get(CHIP.id)?.estado).toBe("contada"));
    expect(result.current.porCaixa.get(CHIP.id)?.naoLidas).toBe(1);
    expect(result.current.porCaixa.size).toBe(1);
  });
});
