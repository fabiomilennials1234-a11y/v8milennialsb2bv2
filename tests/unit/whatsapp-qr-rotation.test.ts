/**
 * O apagão que este teste tranca: o QR de pareamento na tela era um retrato
 * congelado enquanto a Uazapi rotacionava o dele a cada ~20s.
 *
 * `useCheckConnectionStatus` roda a cada 3s enquanto o modal de conexão está
 * aberto e a resposta do provider JÁ TRAZ o `qrcode` atual — o hook jogava fora.
 * Resultado: da primeira rotação em diante o cliente apontava a câmera pra uma
 * imagem morta, sem nenhum sinal disso, até a sessão morrer com o motivo que a
 * própria Uazapi carimba: "QR Code timeout" / "Pair Code timeout".
 *
 * Medido em prod 2026-08-24 (Pesco, instância "Rafael Pessoal"): 15 eventos
 * `connection` em cadência de 20s entre 17:34:13 e 17:39:43, e a linha com o QR
 * nascido às 17:34:04. Nunca conectou. 8 das 9 instâncias uazapi que nunca
 * conectaram morreram com essa assinatura.
 *
 * Contraste que fecha o caso: TODO primeiro-connect bem-sucedido da frota
 * acontece entre 21s e 79s da criação. Ninguém conecta devagar — assinatura de
 * QR de tiro único.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/** Última payload entregue ao `.update()` de `whatsapp_instances`. */
let lastUpdate: Record<string, unknown> | null = null;

const updateSpy = vi.fn((payload: Record<string, unknown>) => {
  lastUpdate = payload;
  return chain;
});

const chain: Record<string, unknown> = {};
["select", "eq"].forEach((m) => {
  chain[m] = vi.fn().mockReturnValue(chain);
});
chain.update = updateSpy;
chain.single = vi.fn().mockResolvedValue({ data: { id: "i1" }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => chain) },
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-1" } }),
}));

const getInstanceStatus = vi.fn();
vi.mock("@/modules/communication/lib/whatsappApi", () => ({
  getInstanceStatus: (...a: unknown[]) => getInstanceStatus(...a),
  createWhatsAppInstance: vi.fn(),
  connectInstanceQR: vi.fn(),
  deleteWhatsAppInstance: vi.fn(),
  logoutWhatsAppInstance: vi.fn(),
}));

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

async function poll() {
  const { useCheckConnectionStatus } = await import(
    "@/modules/communication/hooks/useWhatsAppInstances"
  );
  const { result } = renderHook(() => useCheckConnectionStatus(), {
    wrapper: wrapper(),
  });
  let returned: { qrcode?: string; paircode?: string } | undefined;
  await act(async () => {
    returned = await result.current.mutateAsync({ instance_id: "i1" });
  });
  return returned;
}

describe("useCheckConnectionStatus — rotação do QR", () => {
  beforeEach(() => {
    lastUpdate = null;
    updateSpy.mockClear();
    getInstanceStatus.mockReset();
  });

  it("devolve o QR que o provider acabou de rotacionar (a regressão)", async () => {
    getInstanceStatus.mockResolvedValue({
      connected: false,
      state: "connecting",
      qrcode: "QR_ROTACIONADO",
    });

    const returned = await poll();

    // Antes do fix o valor era simplesmente descartado, e a tela seguia
    // mostrando o QR do momento da criação da instância até a sessão morrer.
    expect(returned?.qrcode).toBe("QR_ROTACIONADO");
  });

  it("NÃO grava o QR vivo no banco — RLS deixa qualquer membro da org ler a linha", async () => {
    getInstanceStatus.mockResolvedValue({
      connected: false,
      state: "connecting",
      qrcode: "QR_ROTACIONADO",
    });

    await poll();

    // `whatsapp_instances` gate INSERT/UPDATE/DELETE em
    // `can_manage_whatsapp_instances()`, mas o SELECT é
    // `organization_id IN get_my_organization_ids()` — ou seja, TODO membro lê.
    // Persistir um QR continuamente renovado armaria essa coluna: um colega
    // não-admin leria o código e pareria o WhatsApp da org no aparelho dele.
    // Hoje a coluna é inofensiva só porque o código nela está sempre morto.
    // O pareamento é um modal que já faz polling; não precisa de storage.
    expect("qr_code" in (lastUpdate ?? {})).toBe(false);
    expect("qr_code_expires_at" in (lastUpdate ?? {})).toBe(false);
  });

  it("leitura sem qrcode (meio da rotação) não inventa um código", async () => {
    getInstanceStatus.mockResolvedValue({
      connected: false,
      state: "connecting",
      // provider não devolveu código neste instante
    });

    const returned = await poll();

    expect(returned?.qrcode).toBeUndefined();
    expect(lastUpdate).not.toBeNull();
  });

  it("NÃO zera last_connection_at ao ver a instância desconectada", async () => {
    getInstanceStatus.mockResolvedValue({ connected: false, state: "disconnected" });

    await poll();

    // O código antigo escrevia `last_connection_at: null` em TODO poll de
    // instância desconectada. Isso apagou o "última vez que este número esteve
    // vivo" de qualquer instância cujo modal de reconexão foi aberto — três
    // linhas em prod carregam NULL ali hoje apesar de milhares de mensagens
    // entregues (Basic4u "bruna 2": 1676; Improving "Marcos SDR": 5130).
    // Desconectar agora não é prova de que nunca houve conexão.
    expect("last_connection_at" in (lastUpdate ?? {})).toBe(false);
  });

  it("ao conectar: carimba last_connection_at e limpa o QR consumido", async () => {
    getInstanceStatus.mockResolvedValue({
      connected: true,
      state: "connected",
      owner: "5511999999999",
    });

    await poll();

    expect(lastUpdate?.status).toBe("connected");
    expect(lastUpdate?.last_connection_at).toBeTruthy();
    expect(lastUpdate?.phone_number).toBe("5511999999999");
    // Um código sobrando renderizaria como QR vivo na próxima abertura.
    expect(lastUpdate?.qr_code).toBeNull();
    expect(lastUpdate?.qr_code_expires_at).toBeNull();
  });

  it("devolve o paircode do provider para a tela acompanhar a rotação", async () => {
    getInstanceStatus.mockResolvedValue({
      connected: false,
      state: "connecting",
      paircode: "1234-5678",
    });

    const returned = await poll();

    expect(returned?.paircode).toBe("1234-5678");
  });
});
