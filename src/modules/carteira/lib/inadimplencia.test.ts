import { describe, it, expect } from "vitest";
import { resumirInadimplencia } from "./inadimplencia";
import type { Titulo } from "@/modules/integrations";

/**
 * SCRUM-229 bloco 4.1 — a leitura de inadimplência.
 *
 * Medido em produção em 2026-08-21: 214 títulos, 193 abertos e 21 atrasados,
 * R$ 667.624 em aberto — e nenhuma superfície da Carteira mostrava isso. O dado
 * chegava ao banco e morria lá.
 */

const HOJE = new Date(2026, 7, 21); // 21/08/2026, meio do dia local

const t = (over: Partial<Titulo>): Titulo => ({
  id: crypto.randomUUID(),
  order_id: null,
  client_id: "c1",
  valor: 100,
  vencimento: "2026-08-30",
  status: "aberto",
  pago_em: null,
  ...over,
});

describe("resumirInadimplencia", () => {
  it("pago não entra em nada", () => {
    const r = resumirInadimplencia([t({ status: "pago", valor: 999, pago_em: "2026-08-01" })], HOJE);
    expect(r.emAberto).toBe(0);
    expect(r.fila).toHaveLength(0);
  });

  it("'aberto' com vencimento PASSADO conta como atrasado", () => {
    // O status é o que o ERP disse na última sincronização; entre uma e outra o
    // calendário anda. Repetir "aberto" seria repetir uma verdade vencida.
    const r = resumirInadimplencia([t({ status: "aberto", vencimento: "2026-08-20", valor: 500 })], HOJE);
    expect(r.quantidadeAtrasada).toBe(1);
    expect(r.atrasado).toBe(500);
    expect(r.fila[0].diasDeAtraso).toBe(1);
  });

  it("vence HOJE ainda não está atrasado", () => {
    const r = resumirInadimplencia([t({ vencimento: "2026-08-21" })], HOJE);
    expect(r.quantidadeAtrasada).toBe(0);
    expect(r.fila[0].diasDeAtraso).toBe(0);
    expect(r.proximoVencimento).toBe("2026-08-21");
  });

  it("status 'atrasado' do ERP é PISO — vale mesmo sem data", () => {
    const r = resumirInadimplencia([t({ status: "atrasado", vencimento: null, valor: 300 })], HOJE);
    expect(r.quantidadeAtrasada).toBe(1);
    expect(r.atrasado).toBe(300);
  });

  it("título SEM vencimento e 'aberto' não vira atrasado por omissão", () => {
    // Dizer "vence hoje" sobre um campo vazio seria inventar data. Ele conta no
    // valor em aberto e fica fora da fila de atraso.
    const r = resumirInadimplencia([t({ vencimento: null, valor: 250 })], HOJE);
    expect(r.emAberto).toBe(250);
    expect(r.quantidadeAtrasada).toBe(0);
    expect(r.fila[0].diasDeAtraso).toBeNull();
  });

  it("valor nulo soma zero, não quebra a conta", () => {
    const r = resumirInadimplencia([t({ valor: null }), t({ valor: 100 })], HOJE);
    expect(r.emAberto).toBe(100);
  });

  it("a fila é a ordem da cobrança: atrasado mais antigo no topo", () => {
    const r = resumirInadimplencia(
      [
        t({ id: "a-vencer-longe", vencimento: "2026-09-30" }),
        t({ id: "atrasado-novo", vencimento: "2026-08-19" }),
        t({ id: "a-vencer-perto", vencimento: "2026-08-25" }),
        t({ id: "atrasado-velho", vencimento: "2026-06-01" }),
      ],
      HOJE,
    );
    expect(r.fila.map((x) => x.id)).toEqual([
      "atrasado-velho",
      "atrasado-novo",
      "a-vencer-perto",
      "a-vencer-longe",
    ]);
  });

  it("maior atraso é o do mais antigo", () => {
    const r = resumirInadimplencia(
      [t({ vencimento: "2026-08-19" }), t({ vencimento: "2026-07-22" })],
      HOJE,
    );
    expect(r.maiorAtraso).toBe(30);
  });

  it("sem título nenhum: tudo zero e nada nulo virando NaN", () => {
    const r = resumirInadimplencia([], HOJE);
    expect(r).toMatchObject({
      emAberto: 0,
      atrasado: 0,
      quantidadeAtrasada: 0,
      proximoVencimento: null,
      maiorAtraso: null,
    });
    expect(r.fila).toEqual([]);
  });

  it("próximo vencimento ignora os atrasados", () => {
    // O que o vendedor quer saber é a próxima data a cobrar, não a que passou.
    const r = resumirInadimplencia(
      [t({ vencimento: "2026-08-01" }), t({ vencimento: "2026-09-10" })],
      HOJE,
    );
    expect(r.proximoVencimento).toBe("2026-09-10");
  });
});
