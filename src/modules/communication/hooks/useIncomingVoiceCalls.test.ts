/**
 * O toque de quem RECEBE.
 *
 * ─── Por que o dublê da VPS emite SEQUÊNCIAS, e não eventos escolhidos a dedo ─
 * Porque a ordem real é o defeito. Em `session.go:onIncomingOffer` a VPS emite
 * `incoming` e, **no instante seguinte**, um `call-status` com `status:
 * "ringing"` — é o `upsertCall` que a fiação da chamada dispara. Um tratador
 * escrito como "qualquer `call-status` encerra a oferta" faria toda ligação
 * recebida sumir da tela milissegundos depois de aparecer, e um teste que
 * empurrasse só o `incoming` passaria com esse defeito plantado.
 *
 * Por isso `vps.oferta()` emite os dois, na ordem da fonte, e `vps.fim()` emite
 * o `call-ended` seguido do `call-list` sem aquela chamada — que é o que o
 * `endCall` do broker faz. Os testes dirigem o fluxo por eles; nenhum teste
 * escreve um evento solto que a VPS não emitiria sozinho.
 *
 * ─── E por que o dublê do `subscribeSessionEvents` respeita o `signal` ───────
 * Um dublê que ignorasse o `AbortSignal` deixaria passar o defeito mais caro
 * desta fatia: o stream que não fecha. Ele PROJETA o contrato — resolve quando
 * abortado, deixa `encerrar()` para simular queda, e guarda cada assinatura viva
 * para que "não abriu stream nenhum" seja uma afirmação verificável e não a
 * ausência de uma expectativa.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@/modules/communication/lib/torquecallsEvents";

// ─── o transporte ────────────────────────────────────────────────────────────

interface AssinaturaViva {
  vpsUrl: string;
  token: string;
  onEvent: (event: SessionEvent) => void;
  signal: AbortSignal;
  /** Simula a queda do stream (sem abort): resolve a promessa do assinante. */
  cair: () => void;
  abortada: boolean;
}

let assinaturas: AssinaturaViva[] = [];
/** Todo `tc_session_id` para o qual um token de stream foi pedido. */
let tokensPedidos: string[] = [];
let recusarToken = false;

const requestStreamToken = vi.fn(async (args: { tcSessionId: string }) => {
  tokensPedidos.push(args.tcSessionId);
  if (recusarToken) throw new Error("stream token recusado");
  return { token: "tok", expiresAt: 0, renewInMs: 45_000, vpsUrl: "https://vps.test" };
});

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  requestStreamToken: (...args: unknown[]) =>
    (requestStreamToken as unknown as (...a: unknown[]) => unknown)(...args),
}));

const subscribeSessionEvents = vi.fn(
  (args: {
    vpsUrl: string;
    token: string;
    onEvent: (event: SessionEvent) => void;
    signal: AbortSignal;
  }) =>
    new Promise<void>((resolve) => {
      const viva: AssinaturaViva = {
        vpsUrl: args.vpsUrl,
        token: args.token,
        onEvent: args.onEvent,
        signal: args.signal,
        cair: () => resolve(),
        abortada: false,
      };
      args.signal.addEventListener("abort", () => {
        viva.abortada = true;
        resolve();
      });
      assinaturas.push(viva);
    }),
);

vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (...args: unknown[]) =>
    (subscribeSessionEvents as unknown as (...a: unknown[]) => unknown)(...args),
}));

// ─── o tom ───────────────────────────────────────────────────────────────────
//
// A forma do som é provada em `lib/voiceRingback.test.ts`, sobre o buffer. O que
// ESTE arquivo prova é o gatilho: quando ele começa, quantos ao mesmo tempo, e —
// o que mais importa — que ele para em todo caminho de saída.

const pararTom = vi.fn();
let silenciarTom = false;
const startIncomingRing = vi.fn(
  (opts?: { onSilenced?: () => void; onAudible?: () => void }) => {
    if (silenciarTom) opts?.onSilenced?.();
    else opts?.onAudible?.();
    return { stop: pararTom };
  },
);

vi.mock("@/modules/communication/lib/voiceRingback", () => ({
  startIncomingRing: (...args: unknown[]) =>
    (startIncomingRing as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1", role: "membro" }),
}));

// ─── o banco, para o nome de quem liga ───────────────────────────────────────
//
// Projeção ESTRITA, como em `useVoipSession.test.ts`: pedir coluna que a linha
// não tem é erro, e o que não foi pedido não volta. Os filtros são aplicados de
// verdade — esquecer o `.is("deleted_at", null)` quebra o teste em vez de passar
// batido.

type Row = Record<string, unknown>;
const tabelas: Record<string, Row[]> = { leads: [] };
let consultas: string[] = [];

function projetar(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const col of cols) {
    if (!(col in row)) {
      throw new Error(`select pediu a coluna "${col}", que não existe na linha do dublê`);
    }
    out[col] = row[col];
  }
  return out;
}

function makeBuilder(table: string) {
  let cols: string[] | null = null;
  const filtros: Array<(r: Row) => boolean> = [];
  let ordem: { col: string; asc: boolean } | null = null;
  let teto: number | null = null;

  function run() {
    if (!cols) throw new Error("consulta sem select");
    let rows = (tabelas[table] ?? []).filter((r) => filtros.every((f) => f(r)));
    if (ordem) {
      const { col, asc } = ordem;
      rows = [...rows].sort((a, b) =>
        (asc ? 1 : -1) * String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
      );
    }
    if (teto !== null) rows = rows.slice(0, teto);
    return { data: rows.map((r) => projetar(r, cols!)), error: null };
  }

  const builder = {
    select(list: string) {
      cols = list.split(",").map((s) => s.trim());
      consultas.push(`${table}:${cols.join(",")}`);
      return builder;
    },
    eq(col: string, value: unknown) {
      filtros.push((r) => r[col] === value);
      return builder;
    },
    is(col: string, value: unknown) {
      filtros.push((r) => (r[col] ?? null) === value);
      return builder;
    },
    in(col: string, values: unknown[]) {
      filtros.push((r) => values.includes(r[col]));
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      ordem = { col, asc: opts?.ascending !== false };
      return builder;
    },
    limit(n: number) {
      teto = n;
      return builder;
    },
    maybeSingle() {
      const { data, error } = run();
      return Promise.resolve({ data: (data as Row[])[0] ?? null, error });
    },
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
      return Promise.resolve().then(run).then(onOk, onErr);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

import {
  peerDigitsFromJid,
  useIncomingCallerName,
  useIncomingVoiceCalls,
} from "./useIncomingVoiceCalls";
import type { CallableVoiceNumber } from "./useVoipSession";

// ─── a VPS de mentira ────────────────────────────────────────────────────────

/**
 * Chamadas que a VPS considera vivas — a fonte do `call-list`.
 *
 * Chaveada pelo PAR `(sessão, chamada)`, como o `callKey` do broker
 * (`broker.go`). Um dublê chaveado só pelo id seria mais frouxo que o real
 * exatamente no eixo onde a colisão vive, e não conseguiria nem montar o caso
 * de duas sessões com o mesmo id remoto.
 */
let vivas = new Map<string, { sessionId: string; callId: string; peer: string }>();

const chave = (sessionId: string, callId: string) => `${sessionId} ${callId}`;

function entregar(event: SessionEvent) {
  for (const a of assinaturas) {
    if (!a.abortada) a.onEvent(event);
  }
}

function emitirCallList() {
  entregar({
    type: "call-list",
    calls: [...vivas.values()].map((c) => ({
      sessionId: c.sessionId,
      callId: c.callId,
      owner: null,
      direction: "inbound",
      peer: c.peer,
      startedAt: 1_700_000_000_000,
      status: "ringing",
    })),
  } as unknown as SessionEvent);
}

const vps = {
  /**
   * Uma oferta entra.
   *
   * `incoming` PRIMEIRO e `call-status: ringing` logo depois — a ordem é
   * contrato em `session.go:onIncomingOffer`, e é ela que faz o `emitIncoming`
   * ser a notícia que MANDA CRIAR e o `call-status` só ATUALIZAR.
   */
  oferta(sessionId: string, id: string, peer: string) {
    entregar({ type: "incoming", sessionId, id, peer, offeredAt: 1_700_000_000_000 });
    entregar({
      type: "call-status",
      sessionId,
      id,
      status: "ringing",
      peer,
      startedAt: 1_700_000_000_000,
    } as unknown as SessionEvent);
    vivas.set(chave(sessionId, id), { sessionId, callId: id, peer });
    emitirCallList();
  },

  /**
   * A oferta acabou — e o motivo é indiferente por desenho.
   *
   * O cliente desistindo (`timeout`), o celular do vendedor atendendo
   * (`accepted_elsewhere`) e o WhatsApp derrubando (`failed`) chegam pelo mesmo
   * `call-ended`, com uma string que o WhatsApp escolhe e que o
   * `HandleCallTerminate` copia verbatim.
   */
  fim(sessionId: string, id: string, reason: string) {
    vivas.delete(chave(sessionId, id));
    entregar({
      type: "call-ended",
      sessionId,
      id,
      owner: null,
      reason,
      endedAt: 1_700_000_100_000,
    } as unknown as SessionEvent);
    emitirCallList();
  },

  /**
   * O MESMO fim, sem o instantâneo que vem atrás.
   *
   * Existe porque o `call-list` que o `endCall` do broker publica logo depois do
   * `call-ended` ESCONDE um defeito no tratamento do `call-ended`: a
   * reconciliação sozinha já tiraria o cartão, e o teste passaria verde com o
   * caminho principal apagado. Medido — o mutante que remove `call-ended` da
   * lista de fins SOBREVIVIA a todos os outros testes deste arquivo.
   *
   * A rede de segurança não pode ser o que prova o caminho que ela protege.
   */
  fimSemInstantaneo(sessionId: string, id: string, reason: string) {
    vivas.delete(chave(sessionId, id));
    entregar({
      type: "call-ended",
      sessionId,
      id,
      owner: null,
      reason,
      endedAt: 1_700_000_100_000,
    } as unknown as SessionEvent);
  },

  /** Um colega atendeu pelo CRM — a rota de accept emite isto (`httpapi.go`). */
  reivindicada(sessionId: string, id: string, owner: string) {
    vivas.delete(chave(sessionId, id));
    entregar({
      type: "incoming-claimed",
      sessionId,
      id,
      owner,
    } as unknown as SessionEvent);
  },

  /**
   * O stream caiu e voltou. A VPS manda o instantâneo a toda conexão nova
   * (`serveSSE` → `SnapshotFn` + `publishCallList`), e é ele que reconcilia o
   * que se perdeu enquanto ninguém ouvia.
   */
  reconectou() {
    entregar({ type: "session-list", sessions: [] } as unknown as SessionEvent);
    emitirCallList();
  },
};

// ─── montagem ────────────────────────────────────────────────────────────────

const NUMERO_A: CallableVoiceNumber = {
  tcSessionId: "tc-a",
  instanceId: "i-a",
  instanceName: "Comercial",
};
const NUMERO_B: CallableVoiceNumber = {
  tcSessionId: "tc-b",
  instanceId: "i-b",
  instanceName: "Suporte",
};

/** JID como o WhatsApp entrega: com DDI e sem o nono dígito. */
const JID_DO_LEAD = "555185960716@s.whatsapp.net";
const JID_ESTRANHO = "554899887766@s.whatsapp.net";

/** O primeiro recuo do laço de reconexão. Ver `RECONEXAO_MIN_MS`. */
const RECONEXAO_ESPERADA_MS = 1_000;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

async function montar(
  numbers: CallableVoiceNumber[],
  options?: { ringEnabled?: boolean },
) {
  const utils = renderHook(
    ({ n, o }: { n: CallableVoiceNumber[]; o?: { ringEnabled?: boolean } }) =>
      useIncomingVoiceCalls(n, o),
    { wrapper, initialProps: { n: numbers, o: options } },
  );
  // O stream sobe atrás de um `await` (o token). Sem esperar por ele, todo teste
  // de evento estaria falando com um stream que ainda não existe — e passaria
  // por vacuidade.
  if (numbers.length > 0) {
    await waitFor(() => expect(assinaturas.length).toBeGreaterThan(0));
  }
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  assinaturas = [];
  tokensPedidos = [];
  vivas = new Map();
  consultas = [];
  recusarToken = false;
  silenciarTom = false;
  tabelas.leads = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── quem abre stream, e quem não abre ───────────────────────────────────────

describe("o stream abre antes de existir chamada — e só para quem pode receber", () => {
  it("com um número ao alcance, abre UM stream", async () => {
    await montar([NUMERO_A]);
    expect(assinaturas).toHaveLength(1);
    expect(tokensPedidos).toEqual(["tc-a"]);
  });

  // O ponto que decide a fatia. Este provider vive FORA das rotas: existe em
  // toda página, para todo usuário. Medido em produção em 2026-08-03, existe UMA
  // sessão de voz aberta em toda a plataforma — ou seja, ~29 das ~30
  // organizações caem exatamente neste caso, e uma conexão a mais por vendedor
  // aqui seria carga permanente comprada por nada.
  it("sem número ao alcance, NÃO abre stream nenhum — nem pede token", async () => {
    await montar([]);
    // Um `waitFor` que só espera "continua zero" passaria na hora, antes de o
    // efeito ter chance de rodar. Deixar o microtask virar é o que dá ao defeito
    // a oportunidade de aparecer.
    await act(async () => {
      await Promise.resolve();
    });
    expect(subscribeSessionEvents).not.toHaveBeenCalled();
    expect(requestStreamToken).not.toHaveBeenCalled();
    expect(tokensPedidos).toEqual([]);
  });

  // O broker filtra por ORGANIZAÇÃO, não por sessão (`publish`, broker.go): um
  // stream já traz os eventos de todos os números. Abrir um por número seria
  // pagar N conexões pelo mesmo conteúdo.
  it("com DOIS números ao alcance, continua UM stream só", async () => {
    await montar([NUMERO_A, NUMERO_B]);
    expect(assinaturas).toHaveLength(1);
    expect(tokensPedidos).toHaveLength(1);
  });

  it("o número sair do alcance fecha o stream", async () => {
    const { rerender } = await montar([NUMERO_A]);
    act(() => rerender({ n: [], o: undefined }));
    await waitFor(() => expect(assinaturas[0].abortada).toBe(true));
  });

  /**
   * Perder acesso ao número TIRA a oferta da tela.
   *
   * O filtro do `incoming` decide na entrada, e isso basta enquanto o alcance
   * não muda. Mas ele muda em pleno voo — o admin tira o vendedor da lista, a
   * sessão cai, a voz é desligada. Sem este conserto, o cartão continuava
   * tocando por um número ao qual ele acabou de perder acesso, até o
   * `call-ended` chegar. Uma autocura que depende do outro lado desligar não é
   * autocura.
   */
  it("perder acesso a um número tira a oferta dele da tela, na hora", async () => {
    const { result, rerender } = await montar([NUMERO_A, NUMERO_B]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));
    expect(result.current.calls).toHaveLength(2);

    act(() => rerender({ n: [NUMERO_A], o: undefined }));

    // Só a do número que continua ao alcance sobrevive.
    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-1"]);
  });

  it("perder TODOS os números cala o tom e limpa a tela", async () => {
    const { result, rerender } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => rerender({ n: [], o: undefined }));

    expect(result.current.calls).toEqual([]);
    expect(pararTom).toHaveBeenCalled();
  });

  it("desmontar fecha o stream", async () => {
    const { unmount } = await montar([NUMERO_A]);
    act(() => unmount());
    await waitFor(() => expect(assinaturas[0].abortada).toBe(true));
  });

  // Uma lista que muda de identidade a cada refetch do react-query (array novo,
  // mesmo conteúdo) não pode derrubar e reabrir a conexão a cada render.
  it("re-render com a mesma lista não reabre o stream", async () => {
    const { rerender } = await montar([NUMERO_A]);
    act(() => rerender({ n: [{ ...NUMERO_A }], o: undefined }));
    act(() => rerender({ n: [{ ...NUMERO_A }], o: undefined }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(assinaturas).toHaveLength(1);
    expect(tokensPedidos).toHaveLength(1);
  });
});

// ─── o filtro: toca para quem está na lista, e não para os outros ────────────

describe("o gate: só toca a ligação que entra por um número ao alcance dele", () => {
  it("oferta no número dele: o cartão aparece e o tom toca", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.calls).toHaveLength(1);
    expect(result.current.calls[0]).toMatchObject({
      tcCallId: "call-1",
      tcSessionId: "tc-a",
      instanceName: "Comercial",
      peerDigits: "555185960716",
    });
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  /**
   * O stream traz a organização INTEIRA. Sem este filtro, o número do colega
   * tocaria no fone errado — e é aqui que "não toca para quem não está na lista"
   * acontece, porque a lista já chegou resolvida em `numbers`.
   *
   * ── O CONTROLE POSITIVO, e por que ele não é zelo ──
   * Toda asserção negativa passa por dois motivos: porque a regra funcionou, ou
   * porque o caso não alcançava nada de jeito nenhum. A segunda metade deste
   * teste dispara a MESMA oferta, no MESMO número, com a única diferença sendo
   * o alcance — e afirma que ela toca. Sem isso, um erro na montagem do caso (um
   * id trocado, um evento que a VPS não emitiria) deixaria o teste verde com o
   * filtro apagado.
   */
  it("oferta num número FORA do alcance dele: nada aparece e nada toca", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    expect(result.current.calls).toEqual([]);
    expect(startIncomingRing).not.toHaveBeenCalled();
  });

  it("e a MESMA oferta toca quando aquele número está ao alcance dele", async () => {
    const { result } = await montar([NUMERO_B]);

    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-2"]);
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  // O caso que prende o filtro de verdade: com um número só ao alcance,
  // qualquer implementação que aceite tudo passaria no teste positivo. Com dois
  // números na organização e um só ao alcance, o filtro precisa acontecer.
  it("com dois números na organização, só entra a oferta do que é dele", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-b", "call-do-colega", JID_ESTRANHO));
    act(() => vps.oferta("tc-a", "call-minha", JID_DO_LEAD));

    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-minha"]);
  });

  /**
   * Fail-closed, como em `useVoicePairing`: identidade ausente é identidade
   * errada. A forma permissiva ("passa se não disser de quem é") faria um evento
   * anônimo tocar para todo mundo.
   *
   * Cada caso vem com o seu controle positivo — o MESMO evento, com o campo que
   * falta preenchido, tocando. Sem ele, um erro na montagem do payload (um tipo
   * errado, um campo que a VPS não manda assim) faria o teste passar pelo motivo
   * errado, com a guarda apagada.
   */
  it.each([
    ["sem sessão declarada", { type: "incoming", id: "call-3", peer: JID_DO_LEAD }],
    ["sem id de chamada", { type: "incoming", sessionId: "tc-a", peer: JID_DO_LEAD }],
    [
      "com sessão que não é string",
      { type: "incoming", sessionId: 42, id: "call-3", peer: JID_DO_LEAD },
    ],
  ])("oferta %s não toca", async (_rotulo, payload) => {
    const { result } = await montar([NUMERO_A]);

    act(() => entregar(payload as unknown as SessionEvent));

    expect(result.current.calls).toEqual([]);
    expect(startIncomingRing).not.toHaveBeenCalled();
  });

  it("controle: o MESMO evento, com sessão e id, toca", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() =>
      entregar({
        type: "incoming",
        sessionId: "tc-a",
        id: "call-3",
        peer: JID_DO_LEAD,
      } as unknown as SessionEvent),
    );

    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-3"]);
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });
});

// ─── parar de tocar ──────────────────────────────────────────────────────────

describe("o CRM desiste quando o WhatsApp desiste — nunca antes", () => {
  it("o cliente desistiu: o cartão sai e o tom cala", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => vps.fim("tc-a", "call-1", "timeout"));

    expect(result.current.calls).toEqual([]);
    expect(pararTom).toHaveBeenCalled();
  });

  /**
   * O `call-ended` SOZINHO tem de bastar.
   *
   * O broker publica um `call-list` logo atrás dele, e essa segunda notícia
   * também tira o cartão pela reconciliação — o que faz o teste acima passar
   * mesmo com o tratamento do `call-ended` inteiramente removido (medido: aquele
   * mutante sobrevivia). A rede de segurança não pode ser o que prova o caminho
   * que ela protege, então aqui o instantâneo não vem.
   */
  it("o `call-ended` sozinho já para o toque — sem depender do instantâneo", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => vps.fimSemInstantaneo("tc-a", "call-1", "timeout"));

    expect(result.current.calls).toEqual([]);
    expect(pararTom).toHaveBeenCalled();
  });

  // O celular toca junto, e quem pegar primeiro leva. Isso chega pelo MESMO
  // `call-ended`, com uma razão que o WhatsApp escolhe — e é por isso que o
  // tratador não olha a razão: depender dela seria depender de uma string que
  // ninguém aqui controla.
  it("outro aparelho atendeu: o CRM para de tocar", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    // Sem instantâneo atrás, pela mesma razão do teste acima: é o `call-ended`
    // que tem de resolver isto, não a reconciliação que vem depois.
    act(() => vps.fimSemInstantaneo("tc-a", "call-1", "accepted_elsewhere"));

    expect(result.current.calls).toEqual([]);
    expect(pararTom).toHaveBeenCalled();
  });

  it("um colega atendeu pelo CRM: o cartão sai daqui também", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => vps.reivindicada("tc-a", "call-1", "outro-usuario"));

    expect(result.current.calls).toEqual([]);
  });

  // ESTE é o defeito que a ordem real do `onIncomingOffer` esconde: a VPS emite
  // `call-status: ringing` no instante seguinte ao `incoming`. Um tratador que
  // tratasse qualquer `call-status` como fim faria toda ligação recebida sumir
  // milissegundos depois de aparecer — e um teste que empurrasse só o `incoming`
  // passaria com o defeito plantado.
  it("o `call-status: ringing` que vem logo atrás da oferta NÃO a encerra", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.calls).toHaveLength(1);
  });

  it("`call-status` com qualquer outro estado encerra — oferta só é oferta enquanto toca", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() =>
      entregar({
        type: "call-status",
        sessionId: "tc-a",
        id: "call-1",
        status: "connected",
      } as unknown as SessionEvent),
    );

    expect(result.current.calls).toEqual([]);
  });

  // Sem prazo próprio: um temporizador do CRM decidindo por quem está com o
  // telefone na mão mataria o atendimento pelo celular (ADR-0027).
  it("o CRM NÃO desiste sozinho — dois minutos depois ainda está tocando", async () => {
    // O relógio falso entra DEPOIS da montagem: o stream sobe atrás de um
    // `await` de rede, e congelar o tempo antes disso trava a própria montagem.
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(result.current.calls).toHaveLength(1);
    expect(pararTom).not.toHaveBeenCalled();
  });

  it("o fim de uma ligação de OUTRO número não derruba a que é dele", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => vps.fim("tc-a", "call-outra", "timeout"));

    expect(result.current.calls).toHaveLength(1);
  });
});

// ─── o stream cai: o pior defeito possível é o toque eterno ──────────────────

describe("o stream cai e volta — e o toque não fica órfão", () => {
  // Um stream permanente que morre na primeira instabilidade e não volta é pior
  // que não ter stream: o vendedor deixa de receber ligação e nada na tela diz
  // isso. Falha silenciosa é o modo que este projeto mais paga caro.
  it("reabre sozinho depois de cair", async () => {
    await montar([NUMERO_A]);
    expect(assinaturas).toHaveLength(1);

    vi.useFakeTimers();
    await act(async () => {
      assinaturas[0].cair();
      // `advanceTimersByTimeAsync` gira as microtasks entre um temporizador e o
      // seguinte — é o que deixa o `await` do token resolver dentro do laço.
      await vi.advanceTimersByTimeAsync(RECONEXAO_ESPERADA_MS + 50);
    });

    expect(assinaturas.length).toBeGreaterThan(1);
    expect(tokensPedidos).toHaveLength(2);
  });

  /**
   * O evento de fim aconteceu enquanto ninguém ouvia. Sem reconciliação o cartão
   * fica na tela e o tom toca para sempre, para uma ligação que já morreu — e
   * nenhum relógio conserta um evento que não chegou.
   *
   * O instrumento é o `call-list`, que a VPS manda a TODA conexão nova.
   */
  it("a ligação que morreu durante a queda some quando o instantâneo volta", async () => {
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    expect(result.current.calls).toHaveLength(1);

    // A chamada acaba na VPS, mas o `call-ended` não alcança ninguém.
    vivas.delete(chave("tc-a", "call-1"));

    act(() => vps.reconectou());

    expect(result.current.calls).toEqual([]);
    expect(pararTom).toHaveBeenCalled();
  });

  /**
   * O outro lado da mesma moeda, e o motivo de a reconciliação NÃO ser "some da
   * lista, morreu": a VPS emite `incoming` ANTES de fiar a chamada
   * (`onIncomingOffer`), então existe uma janela real em que um `call-list`
   * disparado por OUTRA chamada não contém esta. Apagar aí mataria a oferta
   * recém-anunciada — e o vendedor veria um cartão piscar e sumir.
   */
  it("um instantâneo que ainda não conhece a oferta recém-anunciada NÃO a apaga", async () => {
    const { result } = await montar([NUMERO_A]);

    // Só o anúncio, sem a fiação — exatamente a janela do `onIncomingOffer`.
    act(() =>
      entregar({
        type: "incoming",
        sessionId: "tc-a",
        id: "call-1",
        peer: JID_DO_LEAD,
        offeredAt: 1_700_000_000_000,
      }),
    );
    // E um `call-list` disparado por outra chamada qualquer, sem esta dentro.
    act(() => emitirCallList());

    expect(result.current.calls).toHaveLength(1);
  });

  it("token recusado não derruba a tela nem deixa cartão fantasma", async () => {
    recusarToken = true;
    const { result } = renderHook(() => useIncomingVoiceCalls([NUMERO_A]), { wrapper });
    await waitFor(() => expect(requestStreamToken).toHaveBeenCalled());
    expect(result.current.calls).toEqual([]);
  });
});

// ─── duas ao mesmo tempo ─────────────────────────────────────────────────────

describe("duas ligações ao mesmo tempo não se atropelam", () => {
  it("as duas coexistem, cada uma com a sua identidade", async () => {
    const { result } = await montar([NUMERO_A, NUMERO_B]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-1", "call-2"]);
    expect(result.current.calls.map((c) => c.instanceName)).toEqual(["Comercial", "Suporte"]);
  });

  // Três ofertas não podem virar três osciladores empilhados, e a segunda
  // chegando não pode reiniciar o tom da primeira.
  it("N ofertas, UM tom só", async () => {
    await montar([NUMERO_A, NUMERO_B]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    expect(startIncomingRing).toHaveBeenCalledTimes(1);
    expect(pararTom).not.toHaveBeenCalled();
  });

  it("uma acabar não cala o tom da outra", async () => {
    const { result } = await montar([NUMERO_A, NUMERO_B]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    act(() => vps.fim("tc-a", "call-1", "timeout"));

    expect(result.current.calls.map((c) => c.tcCallId)).toEqual(["call-2"]);
    expect(pararTom).not.toHaveBeenCalled();
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  it("a última acabar cala o tom", async () => {
    await montar([NUMERO_A, NUMERO_B]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "call-2", JID_ESTRANHO));

    act(() => vps.fim("tc-a", "call-1", "timeout"));
    act(() => vps.fim("tc-b", "call-2", "timeout"));

    expect(pararTom).toHaveBeenCalledTimes(1);
  });

  // A VPS retransmite oferta. Duas linhas para a mesma chamada seriam dois
  // cartões — e o segundo nunca sairia, porque só há um `call-ended`.
  it("a mesma oferta anunciada duas vezes vira UM cartão", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.calls).toHaveLength(1);
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  /**
   * DUAS chamadas, MESMO id, sessões diferentes — e é caso de ataque, não de
   * azar.
   *
   * Na entrada o id vem do stanza REMOTO: é string escolhida pelo outro lado.
   * O broker da VPS chaveia por `callKey{sessionID, callID}` justamente porque
   * não há como garantir unicidade, e documenta o vazamento em `broker.go`.
   * Chavear só pelo id aqui reintroduziria no navegador a premissa que o Go já
   * tinha descartado.
   *
   * Medido com a chave simples: a segunda oferta NUNCA tocava (o dedupe a
   * confundia com a primeira), e o fim da primeira removia a que sobrou.
   */
  it("duas sessões com o MESMO id de chamada não se confundem", async () => {
    const { result } = await montar([NUMERO_A, NUMERO_B]);

    act(() => vps.oferta("tc-a", "id-colidido", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "id-colidido", JID_ESTRANHO));

    // As duas tocam: são chamadas diferentes, em números diferentes.
    expect(result.current.calls).toHaveLength(2);
    expect(result.current.calls.map((c) => c.tcSessionId)).toEqual(["tc-a", "tc-b"]);
  });

  it("o fim de uma delas NÃO derruba a da outra sessão", async () => {
    const { result } = await montar([NUMERO_A, NUMERO_B]);
    act(() => vps.oferta("tc-a", "id-colidido", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "id-colidido", JID_ESTRANHO));

    act(() => vps.fimSemInstantaneo("tc-b", "id-colidido", "timeout"));

    // `vps.fim*` fecha a chamada que ele conhece — a última registrada em
    // `vivas` para aquele id, que é a de `tc-b`. A de `tc-a` continua.
    expect(result.current.calls.map((c) => c.tcSessionId)).toEqual(["tc-a"]);
  });

  /**
   * A chave do par não pode depender de um SEPARADOR, porque o `tcCallId` vem do
   * stanza remoto: quem escolhe os caracteres dele é o outro lado.
   *
   * Com um separador ingênuo (`${sessão}:${chamada}`), o par
   * `("tc-a", "x:y")` e o par `("tc-a:x", "y")` produzem a MESMA chave — e a
   * reconciliação passa a confundir duas chamadas distintas. O prefixo de
   * comprimento torna a decodificação única sem depender do alfabeto de ninguém.
   */
  it("ids que contêm o separador não colidem na chave", async () => {
    const AMBIGUO = {
      tcSessionId: "tc-a:x",
      instanceId: "i-amb",
      instanceName: "Ambíguo",
    };
    const { result } = await montar([NUMERO_A, AMBIGUO]);

    // `("tc-a", "x:y")` e `("tc-a:x", "y")` — chaves iguais sob separador simples.
    act(() => vps.oferta("tc-a", "x:y", JID_DO_LEAD));
    act(() => vps.oferta("tc-a:x", "y", JID_ESTRANHO));
    act(() => emitirCallList());

    expect(result.current.calls).toHaveLength(2);

    // E a reconciliação continua distinguindo as duas: só a primeira morre.
    vivas.delete(chave("tc-a", "x:y"));
    act(() => emitirCallList());

    expect(result.current.calls.map((c) => c.tcSessionId)).toEqual(["tc-a:x"]);
  });

  it("o instantâneo também distingue as duas pelo par", async () => {
    const { result } = await montar([NUMERO_A, NUMERO_B]);
    act(() => vps.oferta("tc-a", "id-colidido", JID_DO_LEAD));
    act(() => vps.oferta("tc-b", "id-colidido", JID_ESTRANHO));
    // Confirma as duas no instantâneo.
    act(() => emitirCallList());

    // Só a de `tc-b` morre na VPS. A de `tc-a`, com o MESMO id, continua viva.
    vivas.delete(chave("tc-b", "id-colidido"));
    act(() => emitirCallList());

    expect(result.current.calls.map((c) => c.tcSessionId)).toEqual(["tc-a"]);
  });
});

// ─── o tom, e o navegador ────────────────────────────────────────────────────

describe("o toque", () => {
  it("em chamada, o cartão APARECE e o tom NÃO toca", async () => {
    const { result } = await montar([NUMERO_A], { ringEnabled: false });

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.calls).toHaveLength(1);
    expect(startIncomingRing).not.toHaveBeenCalled();
  });

  it("desligar a chamada em curso destrava o tom da oferta que continua", async () => {
    const { result, rerender } = await montar([NUMERO_A], { ringEnabled: false });
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    expect(startIncomingRing).not.toHaveBeenCalled();

    act(() => rerender({ n: [NUMERO_A], o: { ringEnabled: true } }));

    expect(result.current.calls).toHaveLength(1);
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  // MEDIDO em Chromium 147: numa página sem gesto nenhum o contexto nasce
  // `suspended` e o `resume()` NUNCA assenta. Um toque que não soa é pior que
  // nenhum, porque ninguém descobre — então a tela tem de poder dizer.
  it("o navegador barrando o som vira estado visível, não silêncio", async () => {
    silenciarTom = true;
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.ringSilenced).toBe(true);
  });

  it("com o som liberado, nada de aviso na tela", async () => {
    const { result } = await montar([NUMERO_A]);

    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    expect(result.current.ringSilenced).toBe(false);
  });

  it("o aviso some quando a ligação acaba", async () => {
    silenciarTom = true;
    const { result } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));
    expect(result.current.ringSilenced).toBe(true);

    act(() => vps.fim("tc-a", "call-1", "timeout"));

    expect(result.current.ringSilenced).toBe(false);
  });

  it("desmontar com uma oferta viva cala o tom", async () => {
    const { unmount } = await montar([NUMERO_A]);
    act(() => vps.oferta("tc-a", "call-1", JID_DO_LEAD));

    act(() => unmount());

    expect(pararTom).toHaveBeenCalled();
  });
});

// ─── quem está ligando ───────────────────────────────────────────────────────

describe("peerDigitsFromJid — o JID vira telefone sem ganhar dígito", () => {
  it("tira o servidor do JID", () => {
    expect(peerDigitsFromJid("555185960716@s.whatsapp.net")).toBe("555185960716");
  });

  // O caso que já custou ligações nesta base: cortar no `@` DEPOIS de filtrar
  // dígitos gruda o sufixo do dispositivo no número — `55518596071612`, 14
  // dígitos que passam por qualquer validação de comprimento e não casam com
  // lead nenhum, para sempre e sem erro.
  it("o sufixo de dispositivo NÃO entra no telefone", () => {
    expect(peerDigitsFromJid("555185960716:12@s.whatsapp.net")).toBe("555185960716");
  });

  it("um JID que não é telefone continua não sendo — nada é inventado", () => {
    expect(peerDigitsFromJid("")).toBe("");
  });
});

function renderNome(peer: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderHook(() => useIncomingCallerName(peer), {
    wrapper: ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children),
  });
}

/** Um lead com as colunas que o produto lê. */
function lead(over: Partial<Row> & { id: string; name: string }): Row {
  return {
    organization_id: "org-1",
    normalized_phone: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("quem está ligando — e os 47% que não têm cadastro", () => {
  // O JID vem com DDI e SEM o nono dígito (`555185960716`); o CRM guarda
  // `51985960716`. `normalizePhone` é a tradução entre os dois, e é a mesma que
  // o chat usa — espelho de `normalize_brazilian_phone` no banco.
  it("acha o lead pelo JID, que não tem o nono dígito", async () => {
    tabelas.leads = [lead({ id: "l-1", name: "Maria", normalized_phone: "51985960716" })];
    const { result } = renderNome("555185960716");
    await waitFor(() => expect(result.current).toBe("Maria"));
  });

  // Medido em produção: `leads.normalized_phone` tem 124 linhas gravadas COM o
  // DDI. Contra elas a igualdade canônica sozinha erra em silêncio.
  it("acha o lead gravado COM o DDI", async () => {
    tabelas.leads = [lead({ id: "l-1", name: "João", normalized_phone: "5551985960716" })];
    const { result } = renderNome("555185960716");
    await waitFor(() => expect(result.current).toBe("João"));
  });

  // 47% dos contatos não têm cadastro, e a ligação de um cliente novo é a mais
  // valiosa que entra aqui. Um cartão que só funcionasse com lead seria um
  // cartão que não funciona em quase metade das ligações.
  it("sem lead, devolve null — a tela cai para o telefone", async () => {
    tabelas.leads = [];
    const { result } = renderNome("555185960716");
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("lead APAGADO não empresta o nome dele", async () => {
    tabelas.leads = [
      lead({
        id: "l-1",
        name: "Apagado",
        normalized_phone: "51985960716",
        deleted_at: "2026-01-02T00:00:00Z",
      }),
    ];
    const { result } = renderNome("555185960716");
    // O controle positivo importa: sem ele, este teste passaria também porque o
    // telefone não alcançava o lead por caminho nenhum.
    await waitFor(() => expect(result.current).toBeNull());
    tabelas.leads = [
      lead({ id: "l-2", name: "Vivo", normalized_phone: "51985960716" }),
    ];
    const outro = renderNome("555185960716");
    await waitFor(() => expect(outro.result.current).toBe("Vivo"));
  });

  it("lead de outra organização nunca empresta o nome", async () => {
    tabelas.leads = [
      lead({
        id: "l-9",
        name: "Da outra empresa",
        organization_id: "org-9",
        normalized_phone: "51985960716",
      }),
    ];
    const { result } = renderNome("555185960716");
    await waitFor(() => expect(result.current).toBeNull());

    // Controle positivo: o MESMO telefone, no MESMO formato, alcança o lead
    // quando ele é da organização certa. Sem isto, um erro na conta do nono
    // dígito faria este teste passar com o filtro de organização apagado — foi
    // exatamente assim que um mutante sobreviveu na fatia anterior.
    tabelas.leads = [
      lead({ id: "l-1", name: "Da minha empresa", normalized_phone: "51985960716" }),
    ];
    const controle = renderNome("555185960716");
    await waitFor(() => expect(controle.result.current).toBe("Da minha empresa"));
  });

  it("sem telefone utilizável, nem chega a consultar", async () => {
    const { result } = renderNome("");
    await waitFor(() => expect(result.current).toBeNull());
    expect(consultas.filter((c) => c.startsWith("leads:"))).toEqual([]);
  });
});
