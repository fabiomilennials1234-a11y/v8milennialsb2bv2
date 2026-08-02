/**
 * O fio entre "desliguei o telefone" e "a ligação apareceu na conversa".
 *
 * `call_logs` só ganha a linha quando o gatilho do banco projeta a chamada
 * encerrada — depois do navegador já ter visto a fase virar `ended`. Sem este
 * fio, a ligação recém-terminada só apareceria na próxima troca de conversa, e
 * o vendedor que acabou de falar veria a thread sem o seu próprio telefonema.
 *
 * A alternativa seria pendurar um poll no chat. Estes testes existem para que a
 * escolha barata (invalidar uma vez, só para quem ligou) continue funcionando
 * sem alguém precisar reintroduzir o poll.
 */
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { VoiceCallState } from "@/modules/communication/hooks/useVoiceCall";

let fase: VoiceCallState["phase"] = "idle";

vi.mock("@/modules/communication/hooks/useVoipSession", () => ({
  useCallableVoiceNumbers: () => ({
    numbers: [
      {
        tcSessionId: "tc-1",
        label: "Comercial",
        phone: "4833334444",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ],
    isLoading: false,
  }),
  useCanCallLead: () => true,
}));

vi.mock("@/modules/communication/hooks/useVoiceCall", () => ({
  useVoiceCall: () => ({
    state: { phase: fase, muted: false, error: null } as VoiceCallState,
    start: vi.fn(),
    hangup: vi.fn(),
    toggleMute: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// O painel desenha a chamada — irrelevante para o fio testado aqui.
vi.mock("./VoiceCallPanel", () => ({ VoiceCallPanel: () => null }));

// `usePersistedState` (preferência de número) monta a chave a partir da org.
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
}));

import { VoiceCallProvider } from "./VoiceCallProvider";

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fase = "idle";
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  invalidateSpy = vi.fn();
  queryClient.invalidateQueries = invalidateSpy as unknown as QueryClient["invalidateQueries"];
});

afterEach(() => {
  vi.useRealTimers();
});

function montar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <VoiceCallProvider>
        <div />
      </VoiceCallProvider>
    </QueryClientProvider>,
  );
}

/** As chaves que foram invalidadas, achatadas. */
function chavesInvalidadas(): string[] {
  return invalidateSpy.mock.calls.map((c) => String(c[0]?.queryKey?.[0]));
}

describe("VoiceCallProvider — a ligação encerrada chega na conversa", () => {
  it("invalida as ligações da conversa quando a chamada termina", () => {
    const { rerender } = montar();

    fase = "ended";
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <VoiceCallProvider>
            <div />
          </VoiceCallProvider>
        </QueryClientProvider>,
      );
    });

    // Ainda não: o banco leva um instante para projetar a linha.
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(chavesInvalidadas()).toContain("call_logs_conversation");
  });

  it("chamada que falhou também vira registro — o vendedor precisa ver a tentativa", () => {
    const { rerender } = montar();

    fase = "failed";
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <VoiceCallProvider>
            <div />
          </VoiceCallProvider>
        </QueryClientProvider>,
      );
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(chavesInvalidadas()).toContain("call_logs_conversation");
  });

  it("chamada em andamento NÃO gera requisição — o custo é por ligação, não por segundo", () => {
    const { rerender } = montar();

    for (const f of ["ringing", "connected"] as VoiceCallState["phase"][]) {
      fase = f;
      act(() => {
        rerender(
          <QueryClientProvider client={queryClient}>
            <VoiceCallProvider>
              <div />
            </VoiceCallProvider>
          </QueryClientProvider>,
        );
      });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    }

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("ficar parado em `ended` não repete a requisição", () => {
    const { rerender } = montar();

    fase = "ended";
    const repintar = () =>
      act(() => {
        rerender(
          <QueryClientProvider client={queryClient}>
            <VoiceCallProvider>
              <div />
            </VoiceCallProvider>
          </QueryClientProvider>,
        );
      });

    repintar();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Repinturas depois do fim não são uma ligação nova.
    repintar();
    repintar();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
