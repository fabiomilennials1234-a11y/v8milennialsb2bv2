/**
 * Régua de cobrança — o lado da edge (ADR-0040, entrega 2).
 *
 *  1. o texto: o renderizador da edge e o gêmeo do front dão o MESMO resultado;
 *  2. o laço (`processarTiqueDaRegua`) com dublês: classificação, e nada de
 *     "falhou" depois que o fornecedor aceitou;
 *  3. o choke: número reservado à cobrança não envia automação comercial;
 *  4. o setor do número: cache e fail-open.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../supabase/functions/_shared/send-governor/gate.ts", () => ({
  governSend: async (_sb: unknown, _ctx: unknown, doSend: () => Promise<unknown>) => await doSend(),
  isSkippedSend: () => false,
}));
const sendTextSpy = vi.fn(async () => ({ success: true, messageId: "m-1" }));
vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(async () => ({ sendText: sendTextSpy })),
}));

import { renderizarMensagem as renderEdge } from "../../supabase/functions/_shared/cobranca-regua-mensagem.ts";
import { renderizarMensagem as renderFront, variaveisDesconhecidas } from "../../src/modules/cobranca/lib/regua";
import {
  classificarFalha,
  type DepsDaRegua,
  type EnvioReservado,
  processarTiqueDaRegua,
} from "../../supabase/functions/_shared/cobranca-regua-runner.ts";
import { recusaDoNumeroReservado, sendTextViaInstance } from "../../supabase/functions/_shared/whatsapp-dispatch.ts";
import { limparCacheDoSetor, setorDoNumero } from "../../supabase/functions/_shared/numero-reservado.ts";

describe("texto da régua: edge e prévia da tela dizem a mesma coisa", () => {
  const vars = {
    primeiro_nome: "Joana", nome: "Joana Prates", empresa: "TorqueCRM", valor: "1840.5",
    vencimento: "2026-10-05", dias_atraso: 16, como_pagar: "", quando: "amanhã",
    parcela_valor: 460, parcela_vencimento: "2026-10-30",
    prazo_data: "2026-11-20", prazo_horario: "18:00",
  };
  const casos: [string, string][] = [
    ["Olá, {primeiro_nome}! {valor} vence em {vencimento}.", "Olá, Joana! R$ 1.840,50 vence em 05/10/2026."],
    ["Linha 1\n{como_pagar}\nResponda SAIR.", "Linha 1\nResponda SAIR."],
    ["Parágrafo 1\n\nParágrafo 2", "Parágrafo 1\n\nParágrafo 2"],
    ["{quando} ({parcela_vencimento}): {parcela_valor}", "amanhã (30/10/2026): R$ 460,00"],
    ["Oi {inexistente}  {primeiro_nome}", "Oi Joana"],
    ["  {como_pagar}  ", ""],
    ["Retorne até {prazo_data}, às {prazo_horario}.", "Retorne até 20/11/2026, às 18:00."],
  ];
  it.each(casos)("%j", (modelo, esperado) => {
    expect(renderEdge(modelo, vars)).toBe(esperado);
    expect(renderFront(modelo, vars)).toBe(esperado);
  });
  it("valor com $ não corrompe o texto (substituição por função)", () => {
    expect(renderEdge("Pague: {como_pagar}", { como_pagar: "PIX $$ 123" })).toBe("Pague: PIX $$ 123");
    expect(renderFront("Pague: {como_pagar}", { como_pagar: "PIX $$ 123" })).toBe("Pague: PIX $$ 123");
  });
  it("aponta variável digitada errado", () => {
    expect(variaveisDesconhecidas("Oi {primeiro_nome}, {valr} {valr}")).toEqual(["valr"]);
  });
});

describe("texto da régua: linhas de título se repetem por título em aberto", () => {
  const LISTA = [
    { vencimento: "2026-10-11", valor: 233.15, numero: "NF 10" },
    { vencimento: "2026-10-11", valor: "69.97", numero: null },
  ];
  const vars = { primeiro_nome: "Joana", valor: 303.12, vencimento: "2026-10-11", titulos: 2, lista_titulos: LISTA };
  const casos: [string, string, Record<string, unknown>][] = [
    // O formato que o cliente pediu: bloco de duas linhas, um por título.
    [
      "Dados dos Documentos:\n\nVencimento: {titulo_vencimento}\n• Valor de: {titulo_valor}\n\nAgradecemos a parceria!",
      "Dados dos Documentos:\n\nVencimento: 11/10/2026\n• Valor de: R$ 233,15\n\nVencimento: 11/10/2026\n• Valor de: R$ 69,97\n\nAgradecemos a parceria!",
      vars,
    ],
    // Uma linha vira lista; variável do caso dentro da linha segue valendo.
    ["Títulos:\n• {titulo_vencimento}: {titulo_valor} ({primeiro_nome})\nTotal: {valor}",
      "Títulos:\n• 11/10/2026: R$ 233,15 (Joana)\n• 11/10/2026: R$ 69,97 (Joana)\nTotal: R$ 303,12", vars],
    // Título sem número: a linha só com o número some naquele título.
    ["{titulo_numero}\n{titulo_vencimento}", "NF 10\n11/10/2026\n\n11/10/2026", vars],
    // {titulos} é a contagem, não marca linha de título.
    ["São {titulos} títulos.", "São 2 títulos.", vars],
    // Sem título em aberto (ou edge/banco sem a lista): o bloco some, o resto fica.
    ["A\nVencimento: {titulo_vencimento}\nB", "A\nB", { ...vars, lista_titulos: [] }],
    ["A\nVencimento: {titulo_vencimento}\nB", "A\nB", { primeiro_nome: "Joana" }],
    // Lista cortada pelo banco (20): fecha com quantos ficaram de fora.
    ["• {titulo_valor}", "• R$ 233,15\n• R$ 69,97\nE mais 21 títulos em aberto.", { ...vars, titulos: 23 }],
    ["V: {titulo_vencimento}\nR: {titulo_valor}",
      "V: 11/10/2026\nR: R$ 233,15\n\nV: 11/10/2026\nR: R$ 69,97\n\nE mais 1 título em aberto.", { ...vars, titulos: 3 }],
  ];
  it.each(casos)("%j", (modelo, esperado, v) => {
    expect(renderEdge(modelo, v)).toBe(esperado);
    expect(renderFront(modelo, v)).toBe(esperado);
  });
  it("variáveis de título são conhecidas", () => {
    expect(variaveisDesconhecidas("{titulo_vencimento} {titulo_valor} {titulo_numero} {titulo_juros}")).toEqual(["titulo_juros"]);
  });
});

describe("laço da régua", () => {
  const RESERVADO: EnvioReservado = {
    envio_id: "e-1", organization_id: "org", instancia_id: "inst", telefone: "5548999990001",
    mensagem: "Olá {primeiro_nome}", variaveis: { primeiro_nome: "Ana" },
  };
  function deps(over: Partial<DepsDaRegua> = {}) {
    const concluidos: Parameters<DepsDaRegua["concluir"]>[0][] = [];
    const gravados: unknown[] = [];
    const d: DepsDaRegua = {
      reservar: async () => [RESERVADO],
      concluir: async (a) => { concluidos.push(a); },
      carregarInstancia: async (id) => ({ id, organization_id: "org", provider: "uazapi" }),
      verificarNumero: async () => null,
      enviarTexto: async () => ({ success: true, messageId: "pm-1" }),
      gravarNoChat: async (a) => { gravados.push(a); },
      ehRetentavel: (e) => (e ?? "").includes("circuit breaker open"),
      ...over,
    };
    return { d, concluidos, gravados };
  }

  it("enviado: renderiza, grava no chat com o id do fornecedor e conclui", async () => {
    const enviar = vi.fn(async () => ({ success: true, messageId: "pm-1" }));
    const { d, concluidos, gravados } = deps({ enviarTexto: enviar });
    const r = await processarTiqueDaRegua(d, { lote: 5 });
    expect(r).toMatchObject({ reservados: 1, enviados: 1, falhas: 0 });
    expect(enviar).toHaveBeenCalledWith(expect.anything(), "5548999990001", "Olá Ana",
      { trackSource: "cobranca", trackId: "e-1", idempotencyKey: "cobranca:e-1" });
    expect(gravados).toEqual([expect.objectContaining({ texto: "Olá Ana", providerMessageId: "pm-1" })]);
    expect(concluidos).toEqual([{ envioId: "e-1", resultado: "enviado", texto: "Olá Ana", providerMessageId: "pm-1" }]);
  });

  it("número sem WhatsApp: não tenta enviar", async () => {
    const enviar = vi.fn();
    const { d, concluidos } = deps({ verificarNumero: async () => "Recipient is not on WhatsApp", enviarTexto: enviar });
    await processarTiqueDaRegua(d, { lote: 5 });
    expect(enviar).not.toHaveBeenCalled();
    expect(concluidos[0].resultado).toBe("sem_whatsapp");
  });

  it("classifica a falha: só repete o que provadamente não saiu", () => {
    const ret = (e: string | null | undefined) => (e ?? "").includes("circuit breaker open");
    expect(classificarFalha("circuit breaker open", ret)).toBe("retentar");
    expect(classificarFalha("HTTP 500 timeout", ret)).toBe("falhou");
    expect(classificarFalha("recipient_not_on_whatsapp", ret)).toBe("sem_whatsapp");
    expect(classificarFalha("instance_reserved_for_collections", ret)).toBe("falhou");
  });

  it("mensagem vazia não sai; instância sumida volta para a fila", async () => {
    const a = deps({ reservar: async () => [{ ...RESERVADO, mensagem: "{como_pagar}", variaveis: {} }] });
    await processarTiqueDaRegua(a.d, { lote: 5 });
    expect(a.concluidos[0]).toMatchObject({ resultado: "falhou", erro: "mensagem_vazia" });
    const b = deps({ carregarInstancia: async () => null });
    await processarTiqueDaRegua(b.d, { lote: 5 });
    expect(b.concluidos[0].resultado).toBe("retentar");
  });

  it("depois que saiu, nada vira 'falhou': chat que não grava e conclusão que falha uma vez", async () => {
    let tentativas = 0;
    const concluidos: string[] = [];
    const { d } = deps({
      gravarNoChat: async () => { throw new Error("db fora"); },
      concluir: async (a) => {
        tentativas++;
        if (tentativas === 1) throw new Error("rpc fora");
        concluidos.push(a.resultado);
      },
    });
    const r = await processarTiqueDaRegua(d, { lote: 5 });
    expect(concluidos).toEqual(["enviado"]);
    expect(r.enviados).toBe(1);
    expect(r.falhas).toBe(0);
  });
});

describe("choke: número reservado à cobrança", () => {
  const COBRANCA = { id: "i", organization_id: "o", provider: "uazapi", instance_name: "cobrança", reserved_for: "collections" } as never;
  const COMUM = { id: "j", organization_id: "o", provider: "uazapi", instance_name: "vendas" } as never;
  beforeEach(() => sendTextSpy.mockClear());

  it("recusa automação comercial e deixa passar a régua e a mão humana", () => {
    expect(recusaDoNumeroReservado(COBRANCA, "workflow")).toBe("instance_reserved_for_collections");
    expect(recusaDoNumeroReservado(COBRANCA, "copilot")).toBe("instance_reserved_for_collections");
    expect(recusaDoNumeroReservado(COBRANCA, undefined)).toBe("instance_reserved_for_collections");
    expect(recusaDoNumeroReservado(COBRANCA, "cobranca")).toBeNull();
    expect(recusaDoNumeroReservado(COBRANCA, "manual")).toBeNull();
    expect(recusaDoNumeroReservado(COBRANCA, "whatsapp-api-proxy", "manual")).toBeNull();
    expect(recusaDoNumeroReservado(COMUM, "workflow")).toBeNull();
  });

  it("o envio recusado nem chega ao fornecedor", async () => {
    const r = await sendTextViaInstance({} as never, COBRANCA, "5548999990001", "oferta", { trackSource: "workflow" });
    expect(r).toEqual({ success: false, deliveryState: "not_sent", error: "instance_reserved_for_collections" });
    expect(sendTextSpy).not.toHaveBeenCalled();
    const ok = await sendTextViaInstance({} as never, COBRANCA, "5548999990001", "lembrete", { trackSource: "cobranca" });
    expect(ok.success).toBe(true);
    expect(sendTextSpy).toHaveBeenCalledTimes(1);
  });
});

describe("setor do número (webhook e agent-message)", () => {
  beforeEach(() => limparCacheDoSetor());
  const cliente = (resp: { data?: unknown; error?: unknown } | Error) => {
    const maybeSingle = vi.fn(async () => {
      if (resp instanceof Error) throw resp;
      return resp;
    });
    return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }), maybeSingle };
  };

  it("lê uma vez e usa o cache", async () => {
    const c = cliente({ data: { reserved_for: "collections" }, error: null });
    expect(await setorDoNumero(c, "i")).toBe("collections");
    expect(await setorDoNumero(c, "i")).toBe("collections");
    expect(c.maybeSingle).toHaveBeenCalledTimes(1);
  });
  it("fail-open: erro de leitura não silencia o copilot", async () => {
    expect(await setorDoNumero(cliente({ data: null, error: { message: "column does not exist" } }), "x")).toBeNull();
    expect(await setorDoNumero(cliente(new Error("rede")), "y")).toBeNull();
    expect(await setorDoNumero(cliente({ data: { reserved_for: null }, error: null }), null)).toBeNull();
  });
});
