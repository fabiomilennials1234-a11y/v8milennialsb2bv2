/**
 * Fila de envio do chat WhatsApp (CP-v2, régua de espera, entrega ① CX).
 *
 * O contrato que estes testes guardam é o da área frágil: nunca dois envios em
 * voo na mesma conversa, a ordem do vendedor é a ordem do WhatsApp, nada sai
 * depois de uma falha, nada é reenviado às cegas.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: Record<string, unknown> | null; error: unknown };
type Chamada = [string, unknown[]];

const invoke = vi.fn<(fn: string, opts: { body: Record<string, unknown> }) => Promise<Resposta>>();
const upsert = vi.fn((..._a: unknown[]) => Promise.resolve({ error: null }));
/** Cada `from("whatsapp_messages")` do confirm registra a cadeia aqui. */
const consultas: Chamada[][] = [];
/** O "banco" que o confirm enxerga: linhas gravadas pelo webhook. */
let linhasDoWebhook: Array<{ message_id: string; content: string; timestamp: string }> = [];

function cadeia(chamadas: Chamada[]): unknown {
  const alvo: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(alvo, {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "maybeSingle") return async () => ({ data: { metadata: {} }, error: null });
      if (prop === "upsert") return (...a: unknown[]) => upsert(...a);
      if (prop === "limit") {
        return async (...a: unknown[]) => {
          chamadas.push(["limit", a]);
          return { data: responderConfirm(chamadas), error: null };
        };
      }
      return (...a: unknown[]) => {
        chamadas.push([prop, a]);
        return proxy;
      };
    },
  });
  return proxy;
}

/** Emula o filtro do confirm sobre `linhasDoWebhook`: conteúdo, janela e exclusão. */
function responderConfirm(chamadas: Chamada[]) {
  const arg = (nome: string) => chamadas.find(([n]) => n === nome)?.[1];
  const desde = (arg("gte")?.[1] as string | undefined) ?? "";
  const conteudo = chamadas.find(([n, a]) => n === "eq" && a[0] === "content")?.[1][1];
  const excluidos = String(chamadas.find(([n, a]) => n === "not" && a[0] === "message_id")?.[1][2] ?? "");
  const linhas = linhasDoWebhook
    .filter((l) => l.timestamp >= desde && l.content === conteudo && !excluidos.includes(`"${l.message_id}"`))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const limite = Number(arg("limit")?.[0] ?? 1);
  return linhas.slice(0, limite).map(({ message_id }) => ({ message_id }));
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (fn: string, opts: { body: Record<string, unknown> }) => invoke(fn, opts) },
    from: () => {
      const chamadas: Chamada[] = [];
      consultas.push(chamadas);
      return cadeia(chamadas);
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org", id: "member" } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useSendWhatsAppMessage, useSendWhatsAppMedia, useRetryMessage } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import { FilaCheiaError, FilaInterrompidaError, LIMITE_DA_FILA_POR_CONVERSA } from "@/modules/communication/hooks/chat/shared/filaDeEnvio";
import type { ChatContact, FailedMessage, WhatsAppMessage } from "@/modules/communication/hooks/chat/types";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";

const PHONE = "5511999990000";
const BASE = { phoneNumber: PHONE, instanceId: "inst", instanceName: "Vendas" };
const KEY_MSGS = ["whatsapp_messages", "org", PHONE, "inst"];
const KEY_FALHAS = ["whatsapp_failed_messages", "org", PHONE, "inst"];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const ok = (id: string): Resposta => ({ data: { result: { message_id: id } }, error: null });
const http = (status: number): Resposta => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: { status } }),
});

function montar(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ texto: useSendWhatsAppMessage(), midia: useSendWhatsAppMedia(), reenviar: useRetryMessage() }), { wrapper });
  return { qc, ...hook };
}

const textoDe = (opts: { body: Record<string, unknown> }) =>
  ((opts.body.payload as Record<string, unknown>).text ?? (opts.body.payload as Record<string, unknown>).caption) as string;

beforeEach(() => {
  invoke.mockReset();
  upsert.mockClear();
  consultas.length = 0;
  linhasDoWebhook = [];
});
afterEach(() => vi.useRealTimers());

describe("fila de envio — ordem e um em voo", () => {
  it("três envios rápidos saem 1, 2, 3 e nunca dois ao mesmo tempo", async () => {
    let emVoo = 0;
    let picoEmVoo = 0;
    const saidas: string[] = [];
    const pendentes: Array<ReturnType<typeof deferred<Resposta>>> = [];
    invoke.mockImplementation(async (_fn, opts) => {
      emVoo += 1;
      picoEmVoo = Math.max(picoEmVoo, emVoo);
      saidas.push(textoDe(opts));
      const d = deferred<Resposta>();
      pendentes.push(d);
      const r = await d.promise;
      emVoo -= 1;
      return r;
    });
    const { result, qc, unmount } = montar();

    let todos!: Promise<unknown[]>;
    act(() => {
      todos = Promise.all(["1", "2", "3"].map((m) => result.current.texto.mutateAsync({ ...BASE, message: m })));
    });

    // Bolha instantânea: as três aparecem antes de qualquer envio terminar.
    await waitFor(() => expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.content)).toEqual(["1", "2", "3"]));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(pendentes).toHaveLength(i + 1));
      // Enquanto o item i está em voo, o i+1 não chamou o provider.
      expect(invoke).toHaveBeenCalledTimes(i + 1);
      await act(async () => { pendentes[i].resolve(ok(`id-${i + 1}`)); });
    }
    await act(async () => { await todos; });

    expect(saidas).toEqual(["1", "2", "3"]);
    expect(picoEmVoo).toBe(1);
    unmount(); qc.clear();
  });

  it("texto e mídia intercalados mantêm a ordem — a mesma fila para os dois", async () => {
    const saidas: string[] = [];
    invoke.mockImplementation(async (_fn, opts) => {
      saidas.push(`${opts.body.action}:${textoDe(opts) ?? ""}`);
      return ok(`id-${saidas.length}`);
    });
    const { result, qc, unmount } = montar();
    await act(async () => {
      await Promise.all([
        result.current.texto.mutateAsync({ ...BASE, message: "1" }),
        result.current.midia.mutateAsync({ ...BASE, mediaType: "image", media: "https://test.invalid/2.png", caption: "2" }),
        result.current.texto.mutateAsync({ ...BASE, message: "3" }),
      ]);
    });
    expect(saidas).toEqual(["sendText:1", "sendMedia:2", "sendText:3"]);
    unmount(); qc.clear();
  });

  it("mídia ainda sendo preparada (base64) segura a vez dela: o texto seguinte não passa na frente", async () => {
    const saidas: string[] = [];
    invoke.mockImplementation(async (_fn, opts) => {
      saidas.push(String(opts.body.action));
      return ok(`id-${saidas.length}`);
    });
    const preparo = deferred<string>();
    const { result, qc, unmount } = montar();
    let todos!: Promise<unknown>;
    act(() => {
      todos = Promise.all([
        result.current.midia.mutateAsync({ ...BASE, mediaType: "document", media: { previa: null, preparar: () => preparo.promise }, fileName: "a.pdf" }),
        result.current.texto.mutateAsync({ ...BASE, message: "depois do pdf" }),
      ]);
    });
    await waitFor(() => expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)).toHaveLength(2));
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { preparo.resolve("https://test.invalid/a.pdf"); await todos; });
    expect(saidas).toEqual(["sendMedia", "sendText"]);
    unmount(); qc.clear();
  });
});

describe("fila de envio — teto", () => {
  it(`o envio nº ${LIMITE_DA_FILA_POR_CONVERSA + 1} é recusado sem bolha e sem chamar o provider`, async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    const { result, qc, unmount } = montar();
    act(() => {
      for (let i = 1; i <= LIMITE_DA_FILA_POR_CONVERSA; i++) {
        void result.current.texto.mutateAsync({ ...BASE, message: `m${i}` }).catch(() => {});
      }
    });
    await waitFor(() => expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)).toHaveLength(LIMITE_DA_FILA_POR_CONVERSA));
    await expect(result.current.texto.mutateAsync({ ...BASE, message: "sexta" })).rejects.toBeInstanceOf(FilaCheiaError);
    await expect(result.current.midia.mutateAsync({ ...BASE, mediaType: "image", media: "https://test.invalid/x.png" })).rejects.toBeInstanceOf(FilaCheiaError);
    expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)).toHaveLength(LIMITE_DA_FILA_POR_CONVERSA);
    expect(invoke).toHaveBeenCalledTimes(1);
    unmount(); qc.cancelQueries(); qc.getMutationCache().clear(); qc.clear();
  });

  it("conversas diferentes têm filas independentes", async () => {
    const pendente = deferred<Resposta>();
    invoke.mockImplementation(() => pendente.promise);
    const { result, qc, unmount } = montar();
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "a" }).catch(() => {});
      void result.current.texto.mutateAsync({ ...BASE, phoneNumber: "5511988887777", message: "b" }).catch(() => {});
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await act(async () => { pendente.resolve(ok("x")); });
    unmount(); qc.clear();
  });
});

describe("fila de envio — parar na falha", () => {
  it("2º falha: o 3º não chama a edge function e vira bolha de falha; a ordem não inverte", async () => {
    const saidas: string[] = [];
    invoke.mockImplementation(async (_fn, opts) => {
      const t = textoDe(opts);
      saidas.push(t);
      // 400 é recusa definitiva: sendWithBoundedRecovery devolve sem retentar.
      return t === "2" ? http(400) : ok(`id-${t}`);
    });
    const { result, qc, unmount } = montar();
    let resultados!: PromiseSettledResult<unknown>[];
    await act(async () => {
      resultados = await Promise.allSettled(["1", "2", "3"].map((m) => result.current.texto.mutateAsync({ ...BASE, message: m })));
    });

    expect(saidas).toEqual(["1", "2"]);
    expect(resultados.map((r) => r.status)).toEqual(["fulfilled", "rejected", "rejected"]);
    expect((resultados[2] as PromiseRejectedResult).reason).toBeInstanceOf(FilaInterrompidaError);

    const falhas = qc.getQueryData<FailedMessage[]>(KEY_FALHAS) ?? [];
    expect(falhas.map((f) => f.message)).toEqual(["2", "3"]);
    expect(falhas[1].error).toMatch(/anterior falhou/);
    // Reenvio manual continua disponível para o item que nunca saiu.
    expect(falhas[1].retry_attempt).toBe(0);
    expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.content)).toEqual(["1"]);
    unmount(); qc.clear();
  });

  it("duas mensagens IGUAIS, a 2ª interrompida: as duas bolhas de falha ficam", async () => {
    invoke.mockImplementation(async () => http(400));
    const { result, qc, unmount } = montar();
    await act(async () => {
      await Promise.allSettled(["oi", "oi"].map((m) => result.current.texto.mutateAsync({ ...BASE, message: m })));
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<FailedMessage[]>(KEY_FALHAS)).toHaveLength(2);
    unmount(); qc.clear();
  });

  it("depois que a fila esvazia, um envio novo sai normalmente", async () => {
    invoke.mockResolvedValueOnce(http(400)).mockResolvedValue(ok("novo"));
    const { result, qc, unmount } = montar();
    await act(async () => {
      await result.current.texto.mutateAsync({ ...BASE, message: "falha" }).catch(() => {});
    });
    await act(async () => { await result.current.texto.mutateAsync({ ...BASE, message: "depois" }); });
    expect(invoke).toHaveBeenCalledTimes(2);
    unmount(); qc.clear();
  });

  it("reenviar pela bolha um item interrompido chama o provider uma vez, com o mesmo id", async () => {
    invoke.mockResolvedValueOnce(http(400)).mockResolvedValue(ok("reenviada"));
    const { result, qc, unmount } = montar();
    await act(async () => {
      await Promise.allSettled(["1", "2"].map((m) => result.current.texto.mutateAsync({ ...BASE, message: m })));
    });
    const interrompida = qc.getQueryData<FailedMessage[]>(KEY_FALHAS)!.find((f) => f.message === "2")!;
    await act(async () => { await result.current.reenviar(interrompida); });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.message_id)).toEqual(["reenviada"]);
    unmount(); qc.clear();
  });
});

describe("fila de envio — mídia que não ficou pronta (N6)", () => {
  const URL_PRONTA = "https://test.invalid/audio.mp3";

  it("preparo falha: lido UMA vez; a bolha de falha guarda o preparo e o reenvio prepara de novo", async () => {
    const preparar = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("Não foi possível converter o áudio para MP3."));
    invoke.mockResolvedValue(ok("audio-ok"));
    const { result, qc, unmount } = montar();
    await act(async () => {
      await result.current.midia.mutateAsync({ ...BASE, mediaType: "audio", media: { previa: null, preparar } }).catch(() => {});
    });
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    const [falha] = qc.getQueryData<FailedMessage[]>(KEY_FALHAS)!;
    expect(falha).toMatchObject({ mediaType: "audio", mediaUrl: null, error: expect.stringMatching(/MP3/) });
    expect(falha.preparo).toBeDefined();

    // Reenvio coerente: a bolha não fica sem o que reenviar.
    preparar.mockResolvedValueOnce(URL_PRONTA);
    await act(async () => { await result.current.reenviar(falha); });
    expect(preparar).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<FailedMessage[]>(KEY_FALHAS)).toHaveLength(0);
    expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.message_id)).toEqual(["audio-ok"]);
    unmount(); qc.clear();
  });

  it("item de mídia interrompido não relê o arquivo; reenviar prepara só então", async () => {
    invoke.mockResolvedValueOnce(http(400)).mockResolvedValue(ok("doc-ok"));
    const preparar = vi.fn(async () => URL_PRONTA);
    const { result, qc, unmount } = montar();
    await act(async () => {
      await Promise.allSettled([
        result.current.texto.mutateAsync({ ...BASE, message: "falha" }),
        result.current.midia.mutateAsync({ ...BASE, mediaType: "document", media: { previa: "data:image/png;base64,AA", preparar }, fileName: "a.pdf" }),
      ]);
    });
    expect(preparar).not.toHaveBeenCalled();
    const interrompida = qc.getQueryData<FailedMessage[]>(KEY_FALHAS)!.find((f) => f.mediaType === "document")!;
    expect(interrompida).toMatchObject({ mediaUrl: null, error: expect.stringMatching(/anterior falhou/) });
    expect(interrompida.preparo?.previa).toBe("data:image/png;base64,AA");
    await act(async () => { await result.current.reenviar(interrompida); });
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    unmount(); qc.clear();
  });

  it("dois itens de mídia interrompidos com a mesma legenda: as duas bolhas ficam", async () => {
    invoke.mockResolvedValue(http(400));
    const { result, qc, unmount } = montar();
    await act(async () => {
      await Promise.allSettled([
        result.current.texto.mutateAsync({ ...BASE, message: "falha" }),
        result.current.midia.mutateAsync({ ...BASE, mediaType: "image", media: { previa: null, preparar: async () => URL_PRONTA } }),
        result.current.midia.mutateAsync({ ...BASE, mediaType: "image", media: { previa: null, preparar: async () => URL_PRONTA } }),
      ]);
    });
    expect(qc.getQueryData<FailedMessage[]>(KEY_FALHAS)).toHaveLength(3);
    unmount(); qc.clear();
  });
});

describe("fila de envio — confirm idempotente", () => {
  it("duas mensagens iguais seguidas: o confirm do 2º nunca reivindica o id do 1º", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    invoke
      .mockImplementationOnce(async () => ok("A"))
      // 2º envio: 504 — desfecho desconhecido, só confirmação pode fechar.
      .mockImplementationOnce(async () => http(504));
    // Linha do 1º gravada pelo webhook com relógio do servidor ADIANTADO: cai
    // dentro de qualquer janela de tempo. Só a exclusão por id a separa.
    linhasDoWebhook = [{ message_id: "A", content: "oi", timestamp: new Date(t0 + 60_000).toISOString() }];
    const { result, qc, unmount } = montar();

    let primeiro!: Promise<unknown>;
    let segundo!: Promise<unknown>;
    act(() => {
      primeiro = result.current.texto.mutateAsync({ ...BASE, message: "oi" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "oi" });
    });
    await act(async () => { await primeiro; });
    // Algumas tentativas sem linha nova: o confirm não pode casar com "A".
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    linhasDoWebhook.push({ message_id: "B", content: "oi", timestamp: new Date(t0 + 61_000).toISOString() });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); await segundo; });

    expect(invoke).toHaveBeenCalledTimes(2);
    const ids = qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.message_id);
    expect(ids).toEqual(["A", "B"]);
    const confirmDo2 = consultas.filter((c) => c.some(([n]) => n === "gte"));
    expect(confirmDo2.length).toBeGreaterThan(0);
    for (const c of confirmDo2) {
      expect(c).toContainEqual(["not", ["message_id", "in", '("A")']]);
    }
    unmount(); qc.clear();
  });

  it("janela do confirm: anterior com id → sem corte por tempo (a exclusão por id o separa)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.300Z"));
    const primeiroSai = deferred<Resposta>();
    invoke.mockImplementationOnce(() => primeiroSai.promise).mockImplementationOnce(async () => http(504));
    const { result, qc, unmount } = montar();
    let segundo!: Promise<unknown>;
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "x" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "y" }).catch((e) => e);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    const tsDo2 = new Date(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)![1].timestamp).getTime();
    await act(async () => { primeiroSai.resolve(ok("X")); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    const confirms = consultas.filter((c) => c.some(([n]) => n === "gte"));
    expect(confirms.length).toBeGreaterThan(0);
    for (const c of confirms) {
      const desde = new Date(c.find(([n]) => n === "gte")![1][1] as string).getTime();
      expect(desde).toBe(tsDo2 - 1000);
      expect(c).toContainEqual(["not", ["message_id", "in", '("X")']]);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await segundo; });
    unmount(); qc.clear();
  });

  it("timestamp do provider (precisão de segundo) anterior ao fim do item anterior ainda é encontrado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    const primeiroSai = deferred<Resposta>();
    invoke.mockImplementationOnce(() => primeiroSai.promise).mockImplementationOnce(async () => http(504));
    const { result, qc, unmount } = montar();
    let segundo!: Promise<unknown>;
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "x" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "y" });
    });
    // O 1º termina às 12:00:05.700 (relógio do cliente)…
    await act(async () => { await vi.advanceTimersByTimeAsync(5_700); });
    const fimDo1 = Date.now();
    await act(async () => { primeiroSai.resolve(ok("X")); await vi.advanceTimersByTimeAsync(0); });
    // …o 2º é entregue 200 ms depois, mas o provider grava 12:00:05 (truncado):
    // ANTES do fim do 1º. Um corte em `fimDo1` nunca acharia esta linha.
    const tsDoProvider = new Date(Math.floor((fimDo1 + 200) / 1000) * 1000).toISOString();
    expect(new Date(tsDoProvider).getTime()).toBeLessThan(fimDo1);
    linhasDoWebhook = [{ message_id: "Y", content: "y", timestamp: tsDoProvider }];
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); await segundo; });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)?.map((m) => m.message_id)).toEqual(["X", "Y"]);
    unmount(); qc.clear();
  });

  it("retentativa sem duplicar: o _sendId da bolha é o mesmo do onMutate ao fim", async () => {
    vi.useFakeTimers();
    invoke.mockImplementationOnce(async () => http(504));
    const { result, qc, unmount } = montar();
    let envio!: Promise<unknown>;
    act(() => { envio = result.current.texto.mutateAsync({ ...BASE, message: "único" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const idDaBolha = qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)![0].id;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    const durante = qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)!;
    expect(durante).toHaveLength(1);
    expect(durante[0]).toMatchObject({ id: idDaBolha, retry_attempt: expect.any(Number) });
    linhasDoWebhook = [{ message_id: "real", content: "único", timestamp: new Date(Date.now()).toISOString() }];
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); await envio; });
    expect(invoke).toHaveBeenCalledTimes(1);
    const fim = qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS)!;
    expect(fim).toHaveLength(1);
    expect(fim[0].message_id).toBe("real");
    unmount(); qc.clear();
  });
});

describe("fila de envio — cache depois do envio", () => {
  const contato = (over: Partial<ChatContact> = {}): ChatContact => ({
    channel: "whatsapp", instance_id: "inst", phone_number: PHONE, push_name: "Maria",
    last_message: "antiga", last_message_time: "2020-01-01T00:00:00.000Z", last_message_direction: "incoming",
    last_message_sent_source: null, unread_count: 0, lead_id: null, lead_name: null,
    ...over,
  } as ChatContact);

  it("não invalida a raiz [\"whatsapp_contacts\"]; atualiza a linha da conversa no lugar", async () => {
    invoke.mockImplementation(async (_f, opts) => ok(`id-${textoDe(opts)}`));
    const { result, qc, unmount } = montar();
    const lista = chatQueryKeys.contactsMulti("org", ["inst"], "");
    qc.setQueryData(lista, { contatos: [contato(), contato({ phone_number: "5511911112222" })], cheia: false });
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    await act(async () => {
      await Promise.all(["a", "b"].map((m) => result.current.texto.mutateAsync({ ...BASE, message: m })));
    });
    const raiz = invalidar.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(["whatsapp_contacts"]));
    expect(raiz).toHaveLength(0);
    const linha = qc.getQueryData<{ contatos: ChatContact[] }>(lista)!.contatos.find((c) => c.phone_number === PHONE)!;
    expect(linha).toMatchObject({ last_message: "b", last_message_direction: "outgoing" });
    // A conversa que acabou de receber envio sobe para o topo.
    expect(qc.getQueryData<{ contatos: ChatContact[] }>(lista)!.contatos[0].phone_number).toBe(PHONE);
    // Mensagens: uma invalidação EXATA, só quando o último item da fila termina.
    const msgs = invalidar.mock.calls.filter(([f]) => (f?.queryKey as unknown[] | undefined)?.[0] === "whatsapp_messages");
    expect(msgs).toHaveLength(1);
    expect(msgs[0][0]).toMatchObject({ queryKey: KEY_MSGS, exact: true });
    unmount(); qc.clear();
  });

  it("isPending acompanha o que ainda está na fila", async () => {
    const d = deferred<Resposta>();
    invoke.mockImplementation(() => d.promise);
    const { result, qc, unmount } = montar();
    let envio!: Promise<unknown>;
    act(() => { envio = result.current.texto.mutateAsync({ ...BASE, message: "a" }); });
    await waitFor(() => expect(result.current.texto.isPending).toBe(true));
    await act(async () => { d.resolve(ok("a")); await envio; });
    await waitFor(() => expect(result.current.texto.isPending).toBe(false));
    unmount(); qc.clear();
  });
});

describe("fila de envio — sair da página", () => {
  it("avisa no beforeunload enquanto houver item na fila, e para de avisar quando esvazia", async () => {
    const d = deferred<Resposta>();
    invoke.mockImplementation(() => d.promise);
    const { result, qc, unmount } = montar();
    let envio!: Promise<unknown>;
    act(() => { envio = result.current.texto.mutateAsync({ ...BASE, message: "a" }); });
    const comFila = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(comFila);
    expect(comFila.defaultPrevented).toBe(true);
    await act(async () => { d.resolve(ok("a")); await envio; });
    const semFila = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(semFila);
    expect(semFila.defaultPrevented).toBe(false);
    unmount(); qc.clear();
  });
});
