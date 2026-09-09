/**
 * O print que este arquivo existe para nunca mais acontecer:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ Deseja conectar um dispositivo à sua conta       │
 *   │ do WhatsApp?                                     │
 *   │  🧭 Safari                                       │
 *   │ Escaneie o QR code novamente para conectar       │
 *   │ o dispositivo.                       [Continuar] │
 *   └──────────────────────────────────────────────────┘
 *
 * Esse diálogo é a RESPOSTA DO CELULAR a um QR já rotacionado: o WhatsApp
 * decodificou a imagem, reconheceu a sessão, viu que a referência já tinha
 * girado e pediu um novo scan. O cliente escaneia de novo — a mesma imagem
 * morta, porque nada na nossa tela a trocava — e cai no mesmo diálogo, até a
 * sessão morrer com "QR Code timeout" / "Pair Code timeout".
 *
 * A propriedade que impede isso NÃO é observável no hook: `useCheckConnectionStatus`
 * pode devolver o código certo e a tela ainda exibir o velho, que foi exatamente
 * o bug. Ela vive na fiação de estado deste componente. Por isso o teste dirige o
 * `QRCodeModal` de verdade, através de uma janela de pareamento com relógio
 * falso, e olha o `src` do <img>.
 *
 * Invariante trancada aqui: **o que está na tela é sempre o último código que o
 * provider entregou.** Nunca um anterior, nunca o gravado na criação da
 * instância, nunca um resíduo de uma abertura passada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// ── Hooks de instância: controlados a dedo ──────────────────────────────────
const refreshQRMutate = vi.fn();
const checkStatusMutate = vi.fn();

vi.mock("@/modules/communication/hooks/useWhatsAppInstances", () => ({
  useRefreshQRCode: () => ({ mutateAsync: refreshQRMutate, isPending: false }),
  useCheckConnectionStatus: () => ({ mutateAsync: checkStatusMutate }),
  useWhatsAppInstances: () => ({ data: [], isLoading: false }),
  useCreateWhatsAppInstance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWhatsAppInstance: () => ({ mutateAsync: vi.fn() }),
  useLogoutInstance: () => ({ mutateAsync: vi.fn() }),
}));

// ── Dependências pesadas do módulo, fora do caminho deste teste ─────────────
vi.mock("@/modules/communication", () => ({
  WhatsAppProviderChooser: () => null,
  getProviderProfile: () => ({ official: false }),
  useConnectWhatsAppCloud: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConnectNotificame: () => ({ mutateAsync: vi.fn(), isPending: false }),
  NotificameOperacaoCard: () => null,
  NotificameTemplatesCard: () => null,
}));
vi.mock("@/modules/communication/hooks/useWhatsAppInstanceAllowedMembers", () => ({
  useAllowedMembersForInstance: () => ({ data: [] }),
  useSetAllowedMembersForInstance: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/modules/communication/hooks/useMessageLimits", () => ({
  useMessageLimits: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/modules/communication/components/chat/history-sync/HistorySyncPanel", () => ({
  HistorySyncPanel: () => null,
}));
vi.mock("@/modules/identity", () => ({
  useCanManageWhatsApp: () => true,
  useTeamMembers: () => ({ data: [] }),
  useOrgQuotas: () => ({ getQuota: () => null }),
}));
vi.mock("../../src/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => false,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { QRCodeModal } = await import(
  "@/modules/platform/components/settings/WhatsAppSettings"
);

const INSTANCE_ID = "inst-1";

/** Linha como ela chega do banco. `qr_code` é o código gravado na criação. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    organization_id: "org-1",
    instance_name: "Rafael Pessoal",
    status: "disconnected",
    session_dead_since: null,
    provider: "uazapi",
    phone_number: null,
    qr_code: null,
    ...overrides,
  } as never;
}

/** O que o provider devolve num `connectQR`. */
function connectReturns(qr: string | null, paircode?: string) {
  refreshQRMutate.mockResolvedValue({
    instance: row({ qr_code: qr }),
    paircode,
  });
}

/** O que um tick do poll de 3s devolve. */
function tickReturns(status: {
  connected?: boolean;
  qrcode?: string;
  paircode?: string;
}) {
  checkStatusMutate.mockResolvedValue({
    ...row({ status: status.connected ? "connected" : "disconnected" }),
    qrcode: status.qrcode,
    paircode: status.paircode,
  });
}

function open(instance = row()) {
  return render(
    <QRCodeModal
      instanceId={INSTANCE_ID}
      instances={[instance]}
      isOpen
      onClose={() => {}}
    />,
  );
}

/** Avança o relógio N ticks do poll (3s cada), drenando as promises. */
async function advanceTicks(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
}

/** O código efetivamente pintado no <img>. */
function onScreenQr(): string {
  const img = screen.getByAltText("QR Code WhatsApp") as HTMLImageElement;
  return img.getAttribute("src") ?? "";
}

describe("QRCodeModal — a imagem na tela segue a rotação do provider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshQRMutate.mockReset();
    checkStatusMutate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("troca a imagem quando o provider rotaciona (o print morre aqui)", async () => {
    connectReturns("QR_INICIAL");
    tickReturns({ qrcode: "QR_INICIAL" });

    open();
    await act(async () => {}); // deixa o connect inicial resolver
    expect(onScreenQr()).toContain("QR_INICIAL");

    // ~20s depois o provider gira o código. O celular já teria recusado o
    // anterior com "Escaneie o QR code novamente".
    tickReturns({ qrcode: "QR_ROTACIONADO" });
    await advanceTicks(1);

    expect(onScreenQr()).toContain("QR_ROTACIONADO");
    expect(onScreenQr()).not.toContain("QR_INICIAL");
  });

  it("acompanha várias rotações seguidas, sem ficar preso em nenhuma", async () => {
    connectReturns("QR_0");
    tickReturns({ qrcode: "QR_0" });
    open();
    await act(async () => {});

    for (const code of ["QR_1", "QR_2", "QR_3", "QR_4"]) {
      tickReturns({ qrcode: code });
      await advanceTicks(1);
      expect(onScreenQr()).toContain(code);
    }
  });

  it("NÃO exibe o código gravado na criação da instância — era esse o congelado", async () => {
    // A linha chega com o QR nascido junto com a instância. Antes do fix a
    // guarda `!instance.qr_code` fazia o efeito de pareamento nem disparar, e a
    // tela pintava exatamente este código, morto havia minutos.
    connectReturns("QR_VIVO");
    tickReturns({ qrcode: "QR_VIVO" });

    open(row({ qr_code: "QR_DA_CRIACAO_MORTO" }));
    await act(async () => {});

    expect(refreshQRMutate).toHaveBeenCalledWith({ instance_id: INSTANCE_ID });
    expect(onScreenQr()).toContain("QR_VIVO");
    expect(onScreenQr()).not.toContain("QR_DA_CRIACAO_MORTO");
  });

  it("tick sem qrcode (meio da rotação) não apaga a imagem que o cliente mira", async () => {
    connectReturns("QR_BOM");
    tickReturns({ qrcode: "QR_BOM" });
    open();
    await act(async () => {});

    tickReturns({}); // provider não devolveu código neste instante
    await advanceTicks(1);

    // Piscar para vazio faria o cliente reabrir o modal no meio do scan.
    expect(onScreenQr()).toContain("QR_BOM");
  });

  it("erro transitório no poll não derruba a imagem nem para a rotação", async () => {
    connectReturns("QR_A");
    tickReturns({ qrcode: "QR_A" });
    open();
    await act(async () => {});

    checkStatusMutate.mockRejectedValueOnce(new Error("network"));
    await advanceTicks(1);
    expect(onScreenQr()).toContain("QR_A");

    tickReturns({ qrcode: "QR_B" });
    await advanceTicks(1);
    expect(onScreenQr()).toContain("QR_B");
  });

  it("fechar o modal descarta o código — reabrir nunca pisca um QR morto", async () => {
    connectReturns("QR_PRIMEIRA_ABERTURA");
    tickReturns({ qrcode: "QR_PRIMEIRA_ABERTURA" });

    const { rerender } = open();
    await act(async () => {});
    expect(onScreenQr()).toContain("QR_PRIMEIRA_ABERTURA");

    await act(async () => {
      rerender(
        <QRCodeModal
          instanceId={INSTANCE_ID}
          instances={[row()]}
          isOpen={false}
          onClose={() => {}}
        />,
      );
    });

    // Reabre: o código da sessão anterior já morreu no provider e não pode
    // reaparecer nem por um frame.
    connectReturns("QR_SEGUNDA_ABERTURA");
    tickReturns({ qrcode: "QR_SEGUNDA_ABERTURA" });
    await act(async () => {
      rerender(
        <QRCodeModal
          instanceId={INSTANCE_ID}
          instances={[row()]}
          isOpen
          onClose={() => {}}
        />,
      );
    });

    expect(onScreenQr()).not.toContain("QR_PRIMEIRA_ABERTURA");
  });

  it("para de girar quando conecta — QR consumido não fica exposto na tela", async () => {
    connectReturns("QR_X");
    tickReturns({ qrcode: "QR_X" });
    const { rerender } = open();
    await act(async () => {});

    // O provider confirma a conexão; a linha reflete isso.
    await act(async () => {
      rerender(
        <QRCodeModal
          instanceId={INSTANCE_ID}
          instances={[row({ status: "connected" })]}
          isOpen
          onClose={() => {}}
        />,
      );
    });

    const callsAoConectar = checkStatusMutate.mock.calls.length;
    await advanceTicks(3);
    expect(checkStatusMutate.mock.calls.length).toBe(callsAoConectar);
    expect(screen.queryByAltText("QR Code WhatsApp")).toBeNull();
  });
});
