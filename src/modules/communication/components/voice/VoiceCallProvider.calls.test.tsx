/**
 * O fio entre "a chamada acabou" e "a ligação apareceu na conversa".
 *
 * ── Por que este dublê imita a máquina de estados, e não escolhe fases à mão ──
 * A primeira versão destes testes empurrava `phase` direto para `"ended"` e
 * declarava vitória. Só que `ended` é o caminho MENOS comum: ele só é escrito
 * por `finish()` (`useVoiceCall.ts:293-307`), que é o evento da VPS — quando o
 * OUTRO lado desliga. Quando o VENDEDOR desliga, `hangup()`
 * (`useVoiceCall.ts:613-630`) faz `ending` → `setState(INITIAL)`, e
 * `INITIAL.phase` é `"idle"`: nunca passa por `ended` nem por `failed`.
 *
 * Ou seja, o teste antigo aprovava um provider que ficava MUDO no caminho mais
 * percorrido do produto. Por isso o dublê aqui expõe `hangup`/`finish`/`fail`/
 * `dismiss` que reproduzem as transições reais do hook, e os testes dirigem o
 * fluxo por eles — nunca escrevendo uma fase arbitrária.
 */
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { CallPhase, VoiceCallState } from "@/modules/communication/hooks/useVoiceCall";

let fase: CallPhase = "idle";
/** Avisa o React que a fase mudou — o provider lê `state.phase` no render. */
let repintar: () => void = () => {};

/**
 * Réplica das transições de `useVoiceCall`. Cada passo cita a linha da fonte
 * que ele imita; se a fonte mudar, isto tem que mudar junto.
 */
const maquina = {
  /** `start()` até a mídia de pé (`useVoiceCall.ts:453→584→344`). */
  discarAteAtender() {
    for (const f of [
      "requesting_mic",
      "authorizing",
      "negotiating",
      "ringing",
      "active",
    ] as CallPhase[]) {
      fase = f;
      repintar();
    }
  },
  /** O VENDEDOR desliga (`useVoiceCall.ts:613-630`): `ending` → INITIAL(`idle`). */
  hangup() {
    fase = "ending";
    repintar();
    fase = "idle"; // setState(INITIAL)
    repintar();
  },
  /** A VPS avisa que acabou (`useVoiceCall.ts:293-307`): fase `ended`. */
  finish() {
    fase = "ended";
    repintar();
  },
  /** Falha de autorização/mídia (`useVoiceCall.ts:276`): fase `failed`. */
  fail() {
    fase = "failed";
    repintar();
  },
  /** "Fechar" no cartão (`useVoiceCall.ts:642`): `setState(INITIAL)` → `idle`. */
  dismiss() {
    fase = "idle";
    repintar();
  },
};

const NUMERO = {
  tcSessionId: "tc-1",
  instanceId: "i-1",
  instanceName: "Comercial",
};

vi.mock("@/modules/communication/hooks/useVoipSession", () => ({
  useCallableVoiceNumbers: () => ({ numbers: [NUMERO], isLoading: false }),
  // A lista de RECEBER é outra pergunta com a mesma forma. Ela entra no dublê
  // porque o provider a consome desde a fatia do toque de entrada; sem ela, o
  // provider quebra no render e todo teste deste arquivo morre por uma razão que
  // não tem nada a ver com o que eles afirmam.
  useAnswerableVoiceNumbers: () => ({ numbers: [NUMERO], isLoading: false }),
}));

/**
 * As ligações que ENTRAM não participam do fio que este arquivo testa.
 *
 * O dublê devolve lista vazia porque o assunto aqui é a atualização da conversa
 * quando a chamada que SAI termina — e o hook real abriria uma conexão de rede
 * para responder outra pergunta. O que ele NÃO faz é sumir com a chamada: as
 * ofertas de entrada têm suíte própria em `useIncomingVoiceCalls.test.ts`.
 */
vi.mock("@/modules/communication/hooks/useIncomingVoiceCalls", () => ({
  useIncomingVoiceCalls: () => ({
    calls: [],
    ringSilenced: false,
    dispensar: vi.fn(),
    restaurar: vi.fn(),
  }),
  // Sem oferta atendida não há dígitos para resolver, e o hook real devolve
  // `null` para telefone sem cadastro — que é 47% deles.
  useIncomingCallerName: () => null,
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

vi.mock("./VoiceCallPanel", () => ({ VoiceCallPanel: () => null }));

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
  // Elemento NOVO a cada repintura: `rerender` com a mesma referência faz o
  // React desistir do trabalho, e nada re-renderizaria.
  const arvore = () => (
    <QueryClientProvider client={queryClient}>
      <VoiceCallProvider>
        <div />
      </VoiceCallProvider>
    </QueryClientProvider>
  );
  const utils = render(arvore());
  repintar = () =>
    act(() => {
      utils.rerender(arvore());
    });
  return utils;
}

/** Deixa o relógio passar da janela de projeção. */
function esperarProjecao() {
  act(() => {
    vi.advanceTimersByTime(3000);
  });
}

function chavesInvalidadas(): string[] {
  return invalidateSpy.mock.calls.map((c) => String(c[0]?.queryKey?.[0]));
}

describe("VoiceCallProvider — o vendedor desliga (caminho mais comum)", () => {
  it("a ligação chega na conversa mesmo sem passar por `ended`", () => {
    montar();

    maquina.discarAteAtender();
    maquina.hangup();
    esperarProjecao();

    expect(chavesInvalidadas()).toContain("call_logs_conversation");
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("estar em `ending` ainda NÃO é o fim — a requisição espera a chamada sair do ar", () => {
    montar();
    maquina.discarAteAtender();

    // Só até `ending`: o `endCall` ainda está indo ao servidor.
    fase = "ending";
    repintar();
    esperarProjecao();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Agora sim, o repouso.
    fase = "idle";
    repintar();
    esperarProjecao();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceCallProvider — os outros finais", () => {
  it("a VPS encerrando (`ended`) também atualiza a conversa", () => {
    montar();
    maquina.discarAteAtender();
    maquina.finish();
    esperarProjecao();

    expect(chavesInvalidadas()).toContain("call_logs_conversation");
  });

  it("chamada que falhou vira registro — a tentativa importa", () => {
    montar();
    maquina.discarAteAtender();
    maquina.fail();
    esperarProjecao();

    expect(chavesInvalidadas()).toContain("call_logs_conversation");
  });

  it("fechar o cartão antes dos 2,5 s NÃO engole a atualização", () => {
    montar();
    maquina.discarAteAtender();
    maquina.finish();

    // O vendedor clica "Fechar" imediatamente: `ended` → `idle`.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    maquina.dismiss();
    esperarProjecao();

    // O timer foi agendado no fim da chamada e sobrevive à troca de fase.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(chavesInvalidadas()).toContain("call_logs_conversation");
  });
});

describe("VoiceCallProvider — o custo é por ligação, não por segundo", () => {
  it("chamada em andamento não gera requisição nenhuma", () => {
    montar();

    maquina.discarAteAtender();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("ficar parado depois do fim não repete a requisição", () => {
    montar();
    maquina.discarAteAtender();
    maquina.hangup();
    esperarProjecao();

    repintar();
    repintar();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("sem nenhuma chamada, repintura nenhuma dispara requisição", () => {
    montar();
    repintar();
    repintar();
    esperarProjecao();

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("duas ligações seguidas geram duas atualizações — uma por ligação", () => {
    montar();

    maquina.discarAteAtender();
    maquina.hangup();
    esperarProjecao();

    maquina.discarAteAtender();
    maquina.hangup();
    esperarProjecao();

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
