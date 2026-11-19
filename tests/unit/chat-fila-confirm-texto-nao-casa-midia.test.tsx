/**
 * Fila de envio (CX ①, volta 3 — F2-b) — o confirm nunca dá falso positivo,
 * e texto NUNCA é confirmado por linha de mídia (o webhook grava a legenda em
 * `content`; a consulta de texto exige `media_url IS NULL`).
 * Mock fiel: respeita limit, filtra telefone/conteúdo/media_url (eq e is
 * null)/citação/exclusão/janela.
 */
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: Record<string, unknown> | null; error: unknown };
type Chamada = [string, unknown[]];
interface Linha { message_id: string; content: string | null; media_url: string | null; phone_number: string; timestamp: string; reply: string | null }

const invoke = vi.fn<(fn: string, opts: { body: Record<string, unknown> }) => Promise<Resposta>>();
let banco: Linha[] = [];
const consultas: Chamada[][] = [];

function responder(ch: Chamada[]) {
  const eqs = ch.filter(([n]) => n === "eq").map(([, a]) => a as [string, unknown]);
  const val = (c: string) => eqs.find(([k]) => k === c)?.[1];
  const desde = String(ch.find(([n]) => n === "gte")?.[1][1] ?? "");
  const excl = String(ch.find(([n, a]) => n === "not" && a[0] === "message_id")?.[1][2] ?? "");
  const citacao = val("reply_context->>messageId") as string | undefined;
  const midiaNula = ch.some(([n, a]) => n === "is" && a[0] === "media_url" && a[1] === null);
  const lim = Number(ch.find(([n]) => n === "limit")?.[1][0] ?? 1000);
  return banco
    .filter((l) => l.timestamp >= desde)
    .filter((l) => val("phone_number") === undefined || l.phone_number === val("phone_number"))
    .filter((l) => val("content") === undefined || l.content === val("content"))
    .filter((l) => val("media_url") === undefined || l.media_url === val("media_url"))
    .filter((l) => !midiaNula || l.media_url === null)
    .filter((l) => (citacao ? l.reply === citacao : l.reply === null))
    .filter((l) => !excl.includes(`"${l.message_id}"`))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, lim)
    .map(({ message_id }) => ({ message_id }));
}

function cadeia(ch: Chamada[]): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "maybeSingle") return async () => ({ data: { metadata: {} }, error: null });
      if (prop === "upsert") return async () => ({ error: null });
      if (prop === "limit") return async (...a: unknown[]) => { ch.push(["limit", a]); return { data: responder(ch), error: null }; };
      return (...a: unknown[]) => { ch.push([prop, a]); return proxy; };
    },
  });
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (fn: string, opts: { body: Record<string, unknown> }) => invoke(fn, opts) },
    from: () => { const ch: Chamada[] = []; consultas.push(ch); return cadeia(ch); },
  },
}));
vi.mock("@/modules/identity", () => ({ useCurrentTeamMember: () => ({ data: { organization_id: "org", id: "member" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useSendWhatsAppMessage, useSendWhatsAppMedia, useRetryMessage } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import type { FailedMessage } from "@/modules/communication/hooks/chat/types";

const PA = "5511999990000";
const PB = "5511888880000";
const base = (phone = PA) => ({ phoneNumber: phone, instanceId: "inst", instanceName: "Vendas" });
const http = (status: number): Resposta => ({ data: null, error: Object.assign(new Error("non-2xx"), { context: { status } }) });
const okId = (id: string): Resposta => ({ data: { result: { message_id: id } }, error: null });
const okSemId = (): Resposta => ({ data: { result: {} }, error: null });
const segundo = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
let seq = 0;
const linha = (o: Partial<Linha>): Linha => ({ message_id: `WA-${++seq}`, content: "ok", media_url: null, phone_number: PA, timestamp: segundo(), reply: null, ...o });

function montar(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const h = renderHook(() => ({ texto: useSendWhatsAppMessage(), midia: useSendWhatsAppMedia(), reenviar: useRetryMessage() }), { wrapper });
  return { qc, ...h };
}
const desfecho = (p: Promise<unknown>) => p.then((r) => ({ ok: r as Record<string, unknown> }), (e) => ({ erro: e as Error }));
const avancar = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const falhas = (qc: QueryClient, phone = PA) => qc.getQueryData<FailedMessage[]>(["whatsapp_failed_messages", "org", phone, "inst"]) ?? [];

beforeEach(() => { invoke.mockReset(); banco = []; consultas.length = 0; seq = 0; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T12:00:00.300Z")); });
afterEach(() => vi.useRealTimers());

describe("fila de envio — confirm sem falso positivo (ataques dirigidos)", () => {
  it("ok×3: com id, 504 entregue, 504 NÃO entregue → 3º falha", async () => {
    invoke
      .mockImplementationOnce(async () => { banco.push(linha({ message_id: "WA-1" })); return okId("WA-1"); })
      .mockImplementationOnce(async () => { banco.push(linha({})); return http(504); })
      .mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    const r: Promise<unknown>[] = [];
    act(() => { for (let i = 0; i < 3; i++) r.push(desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }))); });
    await avancar(200_000);
    const d = await Promise.all(r) as Array<{ ok?: unknown; erro?: Error }>;
    expect(d[0].ok).toBeDefined(); expect(d[1].ok).toBeDefined(); expect(d[2].erro).toBeDefined();
    unmount();
  });

  it("ok×3: SEM id entregue, 504 entregue, 504 NÃO entregue (mesmo segundo) → 3º falha", async () => {
    invoke
      .mockImplementationOnce(async () => { banco.push(linha({})); return okSemId(); })
      .mockImplementationOnce(async () => { banco.push(linha({})); return http(504); })
      .mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    const r: Promise<unknown>[] = [];
    act(() => { for (let i = 0; i < 3; i++) r.push(desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }))); });
    await avancar(200_000);
    const d = await Promise.all(r) as Array<{ ok?: unknown; erro?: Error }>;
    expect(d[2].erro).toBeDefined();
    unmount();
  });

  it("reenvio manual (422): 1º 'ok' 422; 2º 'ok' sem id entregue; reenvio do 1º 504 não entregue → falha", async () => {
    invoke.mockImplementationOnce(async () => http(422));
    const { result, qc, unmount } = montar();
    const p1 = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    await avancar(5_000);
    expect(((await p1) as { erro?: Error }).erro).toBeDefined();
    const bolha = falhas(qc)[0];
    expect(bolha.retry_attempt ?? 0).toBeLessThan(10);
    invoke.mockImplementationOnce(async () => { banco.push(linha({})); return okSemId(); });
    const p2 = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    await avancar(5_000);
    expect(((await p2) as { ok?: unknown }).ok).toBeDefined();
    invoke.mockImplementationOnce(async () => http(504));
    let r3: unknown;
    await act(async () => { const p = desfecho(result.current.reenviar(bolha)); await vi.advanceTimersByTimeAsync(80_000); r3 = await p; });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect((r3 as { erro?: Error }).erro).toBeDefined();
    unmount();
  });

  it("reenvio manual (interrompido): 'x' 422 interrompe 'ok'; depois 'ok' com id entregue; reenvio do 'ok' interrompido 504 não entregue → falha", async () => {
    invoke.mockImplementationOnce(async () => http(422));
    const { result, qc, unmount } = montar();
    let p1!: Promise<unknown>, p2!: Promise<unknown>;
    act(() => { p1 = desfecho(result.current.texto.mutateAsync({ ...base(), message: "x" })); p2 = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" })); });
    await avancar(5_000); await p1; await p2;
    const bolha = falhas(qc).find((m) => m.message === "ok")!;
    expect(bolha).toBeDefined();
    invoke.mockImplementationOnce(async () => { banco.push(linha({ message_id: "WA-OK" })); return okId("WA-OK"); });
    const p3 = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    await avancar(5_000); await p3;
    invoke.mockImplementationOnce(async () => http(504));
    let r: unknown;
    await act(async () => { const p = desfecho(result.current.reenviar(bolha)); await vi.advanceTimersByTimeAsync(80_000); r = await p; });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect((r as { erro?: Error }).erro).toBeDefined();
    unmount();
  });

  it("troca de conversa no meio: A 'ok' em voo, tela desmonta, volta em A e manda 'ok' (504 não entregue) → falha", async () => {
    let solta!: (r: Resposta) => void;
    invoke.mockImplementationOnce(() => new Promise<Resposta>((r) => { solta = r; }));
    const t1 = montar();
    const a1 = desfecho(t1.result.current.texto.mutateAsync({ ...base(PA), message: "ok" }));
    await avancar(1_000);
    t1.unmount();
    const t2 = montar(t1.qc);
    invoke.mockImplementationOnce(async () => http(504));
    let a2!: Promise<unknown>;
    act(() => { a2 = desfecho(t2.result.current.texto.mutateAsync({ ...base(PA), message: "ok" })); });
    banco.push(linha({}));
    await act(async () => { solta(okSemId()); await vi.advanceTimersByTimeAsync(0); });
    await avancar(80_000);
    expect(((await a1) as { ok?: unknown }).ok).toBeDefined();
    const r2 = (await a2) as { ok?: unknown; erro?: Error };
    expect(r2.erro).toBeDefined();
    t2.unmount();
  });

  it("2 conversas, mesmo texto, simultâneas: A 'ok' sem id entregue; B 'ok' 504 não entregue → B falha", async () => {
    invoke.mockImplementation(async (_f, o) => {
      const num = String((o.body.payload as Record<string, unknown>).number);
      if (num.includes("99999")) { banco.push(linha({ phone_number: PA })); return okSemId(); }
      return http(504);
    });
    const { result, unmount } = montar();
    let a!: Promise<unknown>, b!: Promise<unknown>;
    act(() => {
      a = desfecho(result.current.texto.mutateAsync({ ...base(PA), message: "ok" }));
      b = desfecho(result.current.texto.mutateAsync({ ...base(PB), message: "ok" }));
    });
    await avancar(80_000);
    expect(((await a) as { ok?: unknown }).ok).toBeDefined();
    expect(((await b) as { erro?: Error }).erro).toBeDefined();
    unmount();
  });

  it("mídia com legenda 'ok' (com id) + texto 'ok' 504 não entregue → texto falha", async () => {
    invoke
      .mockImplementationOnce(async () => { banco.push(linha({ message_id: "IMG-1", media_url: "https://s.test.invalid/a.png" })); return okId("IMG-1"); })
      .mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    let m!: Promise<unknown>, t!: Promise<unknown>;
    act(() => {
      m = desfecho(result.current.midia.mutateAsync({ ...base(), mediaType: "image", caption: "ok", media: "https://s.test.invalid/a.png" }));
      t = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    });
    await avancar(100_000);
    expect(((await m) as { ok?: unknown }).ok).toBeDefined();
    expect(((await t) as { erro?: Error }).erro).toBeDefined();
    unmount();
  });

  it("mídia com legenda 'ok' que termina SEM linha atribuída + texto 'ok' 504 não entregue → texto falha", async () => {
    // Mídia: 200 sem id (não-realista p/ Uazapi, que lança 502; mas é o caso 'sem dono' de assinatura de mídia)
    invoke
      .mockImplementationOnce(async () => { banco.push(linha({ media_url: "https://s.test.invalid/b.png" })); return okSemId(); })
      .mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    let m!: Promise<unknown>, t!: Promise<unknown>;
    act(() => {
      m = desfecho(result.current.midia.mutateAsync({ ...base(), mediaType: "image", caption: "ok", media: "https://s.test.invalid/b.png" }));
      t = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    });
    await avancar(100_000);
    const rt = (await t) as { ok?: Record<string, unknown>; erro?: Error };
    expect(rt.erro).toBeDefined();
    unmount();
  });
});

describe("fila de envio — relógio do cliente atrasado (F2-b)", () => {
  it("imagem legenda 'ok' 504 com webhook atrasado → bolha; depois texto 'ok' 504 NÃO entregue; cliente 2 min atrás do servidor", async () => {
    const atraso = 120_000;
    const servidor = () => new Date(Math.floor((Date.now() + atraso) / 1000) * 1000).toISOString();
    invoke.mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    const m = desfecho(result.current.midia.mutateAsync({ ...base(), mediaType: "image", caption: "ok", media: "https://s.test.invalid/c.png" }));
    const tsImg = servidor();
    await avancar(80_000);
    expect(((await m) as { erro?: Error }).erro).toBeDefined();
    banco.push(linha({ media_url: "https://s.test.invalid/c.png", timestamp: tsImg }));
    await avancar(10_000);
    invoke.mockImplementationOnce(async () => http(504));
    const t = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    await avancar(80_000);
    const rt = (await t) as { ok?: Record<string, unknown>; erro?: Error };
    expect(rt.erro).toBeDefined();
    unmount();
  });
  it("controle: mesmo cenário com 2 textos 'ok' (sem mídia) → texto 2 falha (regra conta o sem-dono)", async () => {
    const atraso = 120_000;
    const servidor = () => new Date(Math.floor((Date.now() + atraso) / 1000) * 1000).toISOString();
    invoke.mockImplementationOnce(async () => http(504));
    const { result, unmount } = montar();
    const a = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    const ts1 = servidor();
    await avancar(80_000);
    expect(((await a) as { erro?: Error }).erro).toBeDefined();
    banco.push(linha({ timestamp: ts1 }));
    await avancar(10_000);
    invoke.mockImplementationOnce(async () => http(504));
    const t = desfecho(result.current.texto.mutateAsync({ ...base(), message: "ok" }));
    await avancar(80_000);
    const rt = (await t) as { ok?: Record<string, unknown>; erro?: Error };
    expect(rt.erro).toBeDefined();
    unmount();
  });
});

describe.each([
  { semIdDeMidia: false },
  { semIdDeMidia: true },
])("fila de envio — propriedade sucesso ⇒ entregue (mídia 200 sem id: $semIdDeMidia)", ({ semIdDeMidia }) => {
  type Saida = "okId" | "okSemId" | "504e" | "504eTarde" | "504n" | "500n";
  const SAIDAS: Saida[] = ["okId", "okSemId", "504e", "504eTarde", "504n", "500n"];
  let semente = 12345;
  const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };

  it("300 sequências de 1–5 'ok'/'OK'/mídia, desfechos e atrasos aleatórios", async () => {
    const violacoes: string[] = [];
    for (let caso = 0; caso < 300; caso++) {
      banco = []; invoke.mockReset();
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 19, 12, 0, 0, Math.floor(rnd() * 999))));
      const n = 1 + Math.floor(rnd() * 5);
      const itens = Array.from({ length: n }, () => ({
        tipo: rnd() < 0.2 ? "midia" : "texto",
        texto: rnd() < 0.8 ? "ok" : "OK",
        saida: SAIDAS[Math.floor(rnd() * SAIDAS.length)],
        entregue: false, assentado: false,
      }));
      itens.forEach((x) => { if (x.tipo === "midia" && x.saida === "okSemId" && !semIdDeMidia) x.saida = "okId"; });
      const tarde: Linha[] = [];
      invoke.mockImplementation(async () => {
        const i = itens.findIndex((x) => !x.assentado && !(x as { chamou?: boolean }).chamou);
        const it_ = itens[i]; (it_ as { chamou?: boolean }).chamou = true;
        const l = linha({ content: it_.texto, media_url: it_.tipo === "midia" ? `https://s.test.invalid/${caso}-${i}.png` : null });
        switch (it_.saida) {
          case "okId": it_.entregue = true; banco.push(l); return okId(l.message_id);
          case "okSemId": it_.entregue = true; banco.push(l); return okSemId();
          case "504e": it_.entregue = true; banco.push(l); return http(504);
          case "504eTarde": it_.entregue = true; tarde.push(l); return http(504);
          case "504n": return http(504);
          default: return http(500);
        }
      });
      const { result, unmount } = montar();
      const ps: Promise<{ ok?: unknown; erro?: Error }>[] = [];
      act(() => {
        itens.forEach((x, i) => {
          const p = x.tipo === "midia"
            ? result.current.midia.mutateAsync({ ...base(), mediaType: "image", caption: x.texto, media: `https://s.test.invalid/${caso}-${i}.png` })
            : result.current.texto.mutateAsync({ ...base(), message: x.texto });
          ps.push(desfecho(p.finally(() => { x.assentado = true; })) as Promise<{ ok?: unknown; erro?: Error }>);
        });
      });
      for (let k = 0; k < n; k++) { await avancar(70_000); banco.push(...tarde.splice(0)); }
      const ds = await Promise.all(ps);
      ds.forEach((d, i) => { if (d.ok && !itens[i].entregue) violacoes.push(`caso ${caso} item ${i}: ${JSON.stringify(itens.map((x) => `${x.tipo}:${x.texto}:${x.saida}`))}`); });
      unmount();
    }
    expect(violacoes).toEqual([]);
  }, 600_000);
});
