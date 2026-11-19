/**
 * Confirm da fila de envio do WhatsApp — NUNCA falso positivo.
 *
 * Envio ambíguo (timeout/5xx) é fechado procurando a linha do webhook por
 * conteúdo. Com mensagens IGUAIS e respostas sem message_id (o sz-chat-send
 * nunca devolve id), a linha de um item anterior pode parecer a do item atual.
 * Marcar "enviada" uma mensagem que não saiu é perda silenciosa; falso
 * negativo (bolha de falha + reenvio manual) é aceitável.
 */
import { act, renderHook } from "@testing-library/react";
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
import {
  assinaturaDoEnvio,
  encerrarItem,
  FilaInterrompidaError,
  provaDeConfirmacao,
  registrarConfirmado,
  registrarTentativa,
} from "@/modules/communication/hooks/chat/shared/filaDeEnvio";
import type { FailedMessage, WhatsAppMessage } from "@/modules/communication/hooks/chat/types";

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


beforeEach(() => {
  invoke.mockReset();
  upsert.mockClear();
  consultas.length = 0;
  linhasDoWebhook = [];
});
afterEach(() => vi.useRealTimers());

const semId: Resposta = { data: { result: {} }, error: null };
/** Segundo truncado, como o webhook grava o timestamp do provider. */
const truncado = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();
const bolhas = (qc: QueryClient) => (qc.getQueryData<WhatsAppMessage[]>(KEY_MSGS) ?? []).map((m) => m.message_id);

describe("confirm — repro do qa (F2)", () => {
  it("anterior SEM id, 2 textos IGUAIS: 2º não entregue (504) não reivindica a linha do 1º (timestamp truncado)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    const primeiroSai = deferred<Resposta>();
    invoke.mockImplementationOnce(() => primeiroSai.promise).mockImplementationOnce(async () => http(504));
    const { result, qc, unmount } = montar();
    let segundo!: Promise<unknown>;
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "ok" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "ok" }).then((r) => ({ ok: r }), (e) => ({ erro: e }));
    });
    // 1º entregue às 12:00:05.500; webhook grava 12:00:05 (precisão de segundo).
    await act(async () => { await vi.advanceTimersByTimeAsync(5_700); });
    linhasDoWebhook = [{ message_id: "WA-DO-1", content: "ok", timestamp: "2026-11-19T12:00:05.000Z" }];
    // Resposta do 1º sem message_id (sz-chat-send / provider sem id).
    await act(async () => { primeiroSai.resolve(semId); await vi.advanceTimersByTimeAsync(0); });
    // O 2º nunca chega ao WhatsApp: nenhuma linha nova.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const r = (await segundo) as { erro?: unknown };
    expect(r.erro).toBeDefined();
    expect(bolhas(qc)).not.toContain("WA-DO-1");
    expect((qc.getQueryData<FailedMessage[]>(KEY_FALHAS) ?? []).map((f) => f.message)).toEqual(["ok"]);
    unmount(); qc.clear();
  });

  it("mesmo cenário, mas o 2º FOI entregue: duas linhas na janela → confirma, cada bolha com a sua", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    const primeiroSai = deferred<Resposta>();
    invoke.mockImplementationOnce(() => primeiroSai.promise).mockImplementationOnce(async () => {
      linhasDoWebhook.push({ message_id: "WA-DO-2", content: "ok", timestamp: "2026-11-19T12:00:05.000Z" });
      return http(504);
    });
    const { result, qc, unmount } = montar();
    let segundo!: Promise<unknown>;
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "ok" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "ok" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_700); });
    linhasDoWebhook = [{ message_id: "WA-DO-1", content: "ok", timestamp: "2026-11-19T12:00:05.000Z" }];
    await act(async () => { primeiroSai.resolve(semId); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); await segundo; });
    const confirms = consultas.filter((c) => c.some(([n]) => n === "gte"));
    expect(confirms.length).toBeGreaterThan(0);
    // O 1º ficou sem dono: o 2º precisa de DUAS linhas para provar que saiu.
    for (const c of confirms) expect(c).toContainEqual(["limit", [2]]);
    expect(bolhas(qc).filter((id) => id.startsWith("WA-"))).toHaveLength(1);
    unmount(); qc.clear();
  });

  it("anterior COM id, provider truncado antes do fim do 1º: 2º ainda é achado e não casa o 1º", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    const primeiroSai = deferred<Resposta>();
    invoke.mockImplementationOnce(() => primeiroSai.promise).mockImplementationOnce(async () => http(504));
    const { result, qc, unmount } = montar();
    let segundo!: Promise<unknown>;
    act(() => {
      void result.current.texto.mutateAsync({ ...BASE, message: "ok" });
      segundo = result.current.texto.mutateAsync({ ...BASE, message: "ok" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_700); });
    linhasDoWebhook = [
      { message_id: "WA-1", content: "ok", timestamp: "2026-11-19T12:00:05.000Z" },
      { message_id: "WA-2", content: "ok", timestamp: "2026-11-19T12:00:05.000Z" },
    ];
    await act(async () => { primeiroSai.resolve(ok("WA-1")); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); await segundo; });
    expect(bolhas(qc)).toEqual(["WA-1", "WA-2"]);
    unmount(); qc.clear();
  });
});

describe("confirm — reenvio da MESMA mensagem", () => {
  /** Original: o provider foi chamado e recusou (reenviável pela bolha). Pela regra fica "sem dono". */
  async function originalSemDono() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    invoke.mockImplementationOnce(async () => http(422)).mockImplementation(async () => http(504));
    const m = montar();
    let original!: Promise<unknown>;
    act(() => { original = m.result.current.texto.mutateAsync({ ...BASE, message: "ok" }).catch((e) => e); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await original; });
    const [falha] = m.qc.getQueryData<FailedMessage[]>(KEY_FALHAS)!;
    // Uma linha "ok" aparece — pode ser a do original.
    linhasDoWebhook = [{ message_id: "WA-ORIGINAL", content: "ok", timestamp: "2026-11-19T12:00:20.000Z" }];
    return { ...m, falha };
  }

  it("outra mensagem igual (outro item) não fecha com a linha que pode ser do original", async () => {
    const { result, qc, unmount } = await originalSemDono();
    let outra!: Promise<unknown>;
    act(() => { outra = result.current.texto.mutateAsync({ ...BASE, message: "ok" }).catch((e) => e); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(await outra).toBeInstanceOf(Error);
    expect(bolhas(qc)).not.toContain("WA-ORIGINAL");
    unmount(); qc.clear();
  });

  it("o reenvio manual (mesmo _sendId) fecha com a linha do original: é a mesma mensagem", async () => {
    const { result, qc, unmount, falha } = await originalSemDono();
    let reenvio!: Promise<unknown>;
    act(() => { reenvio = result.current.reenviar(falha); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); await reenvio; });
    expect(bolhas(qc)).toEqual(["WA-ORIGINAL"]);
    unmount(); qc.clear();
  });
});

type Desfecho = "id" | "semId" | "504-entregue" | "504-perdido";
const DESFECHOS: Desfecho[] = ["id", "semId", "504-entregue", "504-perdido"];
const entregue = (d: Desfecho) => d !== "504-perdido";
const combinacoes: Desfecho[][] = DESFECHOS.flatMap((a) => DESFECHOS.flatMap((b) => DESFECHOS.map((c) => [a, b, c])));

/**
 * "ok" × 3 em todas as combinações de com/sem id e entregue/perdido. As
 * linhas são gravadas com relógio de servidor ADIANTADO (caem em toda janela)
 * e segundo truncado (empate): o pior caso para casar a linha de outro item.
 */
async function rodarTres(desfechos: Desfecho[], modo: "juntos" | "em-sequencia") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00.500Z"));
  const chamou: number[] = [];
  invoke.mockImplementation(async () => {
    const i = chamou.length;
    chamou.push(i);
    const d = desfechos[i];
    if (entregue(d)) linhasDoWebhook.push({ message_id: `WA-${i}`, content: "ok", timestamp: truncado(Date.now() + 5 * 60_000) });
    if (d === "id") return ok(`WA-${i}`);
    if (d === "semId") return semId;
    return http(504);
  });
  const { result, qc, unmount } = montar();
  const desfechosReais: Array<"saiu" | "falhou" | "interrompido"> = [];
  const enviar = () => result.current.texto.mutateAsync({ ...BASE, message: "ok" })
    .then(() => "saiu" as const, (e) => (e instanceof FilaInterrompidaError ? "interrompido" as const : "falhou" as const));
  if (modo === "juntos") {
    let ps: Promise<"saiu" | "falhou" | "interrompido">[] = [];
    act(() => { ps = [enviar(), enviar(), enviar()]; });
    await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
    desfechosReais.push(...(await Promise.all(ps)));
  } else {
    for (let k = 0; k < 3; k++) {
      let p!: Promise<"saiu" | "falhou" | "interrompido">;
      act(() => { p = enviar(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      desfechosReais.push(await p);
    }
  }
  const ids = bolhas(qc);
  unmount(); qc.clear();
  return { chamou: chamou.length, desfechosReais, ids };
}

describe("confirm — \"ok\" × 3, todas as combinações (nunca falso positivo)", () => {
  for (const modo of ["juntos", "em-sequencia"] as const) {
    it.each(combinacoes.map((c) => [c.join(" → "), c] as const))(`${modo}: %s`, async (_nome, desfechos) => {
      const { chamou, desfechosReais, ids } = await rodarTres([...desfechos], modo);
      // Cada linha pertence a no máximo uma bolha.
      const reais = ids.filter((id) => id.startsWith("WA-"));
      expect(new Set(reais).size).toBe(reais.length);
      // Bolhas "enviadas" nunca superam as mensagens que de fato saíram.
      const saidas = desfechosReais.filter((d) => d === "saiu").length;
      const entregues = desfechos.slice(0, chamou).filter(entregue).length;
      expect(saidas).toBeLessThanOrEqual(entregues);
      for (let i = 0; i < desfechosReais.length; i++) {
        if (i >= chamou) continue;
        // Perdido NUNCA vira "saiu".
        if (desfechos[i] === "504-perdido") expect(desfechosReais[i]).toBe("falhou");
        // Resposta com id ou sem id (2xx) sempre "saiu".
        if (desfechos[i] === "id" || desfechos[i] === "semId") expect(desfechosReais[i]).toBe("saiu");
      }
    });
  }
});

describe("provaDeConfirmacao — a regra, sem rede", () => {
  const C = { organizationId: "org", instanceId: "inst", phoneNumber: PHONE };
  const ass = assinaturaDoEnvio({ conteudo: "ok" });
  const encerrar = (qc: QueryClient, sendId: string, id: string | null, a = ass) => {
    registrarTentativa(qc, C, a, sendId);
    if (id) registrarConfirmado(qc, C, id);
    encerrarItem(qc, C);
  };

  it("sem anteriores: uma linha basta", () => {
    expect(provaDeConfirmacao(new QueryClient(), C, ass, "s1")).toEqual({ excluir: [], minimoDeLinhas: 1 });
  });

  it("cada anterior igual sem dono exige mais uma linha; com id, exclui", () => {
    const qc = new QueryClient();
    encerrar(qc, "s1", null);
    encerrar(qc, "s2", "WA-2");
    encerrar(qc, "s3", null);
    expect(provaDeConfirmacao(qc, C, ass, "s4")).toEqual({ excluir: ["WA-2"], minimoDeLinhas: 3 });
  });

  it("anterior de outra assinatura (texto, citação ou mídia diferentes) não pesa", () => {
    const qc = new QueryClient();
    encerrar(qc, "s1", null, assinaturaDoEnvio({ conteudo: "oi" }));
    encerrar(qc, "s2", null, assinaturaDoEnvio({ conteudo: "ok", citacao: "Q" }));
    encerrar(qc, "s3", null, assinaturaDoEnvio({ conteudo: "ok", mediaUrl: "https://x.invalid/a.png" }));
    expect(provaDeConfirmacao(qc, C, ass, "s4")?.minimoDeLinhas).toBe(1);
  });

  it("anterior que nunca chamou o provider (interrompido) não pesa", () => {
    const qc = new QueryClient();
    encerrarItem(qc, C);
    expect(provaDeConfirmacao(qc, C, ass, "s2")?.minimoDeLinhas).toBe(1);
  });

  it("o próprio original (mesmo sendId) não pesa no reenvio", () => {
    const qc = new QueryClient();
    encerrar(qc, "s1", null);
    expect(provaDeConfirmacao(qc, C, ass, "s1")?.minimoDeLinhas).toBe(1);
  });

  it("fora do horizonte o anterior sai da conta; acima do teto de ids, não prova nada", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    encerrar(qc, "s1", null);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(provaDeConfirmacao(qc, C, ass, "s2")?.minimoDeLinhas).toBe(1);
    for (let i = 0; i < 51; i++) encerrar(qc, `x${i}`, `WA-${i}`);
    expect(provaDeConfirmacao(qc, C, ass, "s2")).toBeNull();
  });
});
