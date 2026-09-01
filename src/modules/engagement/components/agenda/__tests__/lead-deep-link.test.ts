/**
 * O contrato do deep-link do lead: `/leads?lead=<uuid>`.
 *
 * `Leads.tsx` lê `searchParams.get("lead")` e SÓ isso abre o modal. Quatro
 * lugares mandavam `?id=` — a Agenda e três abas da ficha — e o efeito era
 * mudo: a rota casa, a página monta, a lista aparece, e o modal simplesmente
 * não abre. Nenhum erro, nenhum 404. Parece que o clique não pegou.
 *
 * O teste é uma varredura do repo, e não um render de um componente, de
 * propósito: o defeito não era de UM componente, era de VOCABULÁRIO — 18 call
 * sites acertaram e 4 erraram. Um teste por componente protegeria os 4 de
 * ontem e nenhum dos que forem escritos amanhã.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Raiz do repo. Derivada do cwd do vitest (que roda na raiz), e NÃO de
 * `__dirname` com uma pilha de "..": a primeira versão contou cinco níveis
 * em vez de seis, `RAIZ` virou `<repo>/src`, o grep rodou contra
 * `<repo>/src/src` — que não existe — e devolveu vazio. A asserção principal
 * passou VERDE por não ter olhado arquivo nenhum. É o mesmo teto de sempre:
 * teste que não acha nada não prova nada.
 *
 * A segunda asserção deste arquivo existe justamente para derrubar esse verde.
 */
const RAIZ = process.cwd();

/** Caminho deste próprio teste, relativo à raiz — ver o filtro em `procurar`. */
const ESTE_ARQUIVO =
  "src/modules/engagement/components/agenda/__tests__/lead-deep-link.test.ts";

/** Grep sem depender de shell — devolve as linhas que casam, ou []. */
function procurar(padrao: string): string[] {
  try {
    const saida = execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", padrao, "src"],
      { cwd: RAIZ, encoding: "utf8" },
    );
    return saida
      .trim()
      .split("\n")
      .filter(Boolean)
      // Este arquivo cita as duas formas em texto — sem tirá-lo, ele se acusa
      // sozinho e o teste nunca fica verde.
      .filter((linha) => !linha.startsWith(ESTE_ARQUIVO));
  } catch {
    // grep sai 1 quando não acha nada. É o caso feliz.
    return [];
  }
}

describe("deep-link do lead", () => {
  it("nenhum lugar do app manda /leads?id= — o parâmetro que abre o modal é `lead`", () => {
    expect(procurar("/leads?id=")).toEqual([]);
  });

  it("os call sites que existem usam /leads?lead=", () => {
    // Guarda contra o teste acima passar por motivo errado (ninguém mais
    // linkar lead nenhum). Se este número cair a zero, o de cima é vácuo.
    expect(procurar("/leads?lead=").length).toBeGreaterThan(0);
  });
});
