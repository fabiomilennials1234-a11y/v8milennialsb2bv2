/**
 * O que a tela diz depois de submeter um template.
 *
 * Este arquivo existe por um caso REAL de 2026-08-19: um template voltou
 * `REJECTED` no mesmo instante da criação — a recusa da Meta nem sempre demora
 * horas — e a tela exibiu "A Meta revisa e responde em algumas horas". O usuário
 * esperaria por um veredito que já tinha chegado, e a recusa só apareceria se ele
 * voltasse à lista e clicasse Atualizar.
 *
 * O status vem na resposta da criação; o defeito era ignorá-lo.
 */
import { describe, expect, it } from "vitest";

import { mensagemDaCriacao } from "./NotificameTemplateEditor";

describe("mensagemDaCriacao", () => {
  it("recusa imediata é anunciada como recusa, não como espera", () => {
    const m = mensagemDaCriacao("REJECTED");

    expect(m.title).toContain("recusou");
    expect(m.variant).toBe("destructive");
    // O ponto do defeito: não pode mandar esperar por algo que já foi decidido.
    expect(m.description).not.toContain("algumas horas");
  });

  it("aprovação imediata libera o envio na hora", () => {
    const m = mensagemDaCriacao("APPROVED");

    expect(m.title).toContain("aprovado");
    expect(m.variant).toBeUndefined();
  });

  it("pendente mantém a espera — e diz ONDE acompanhar", () => {
    const m = mensagemDaCriacao("PENDING");

    expect(m.title).toContain("análise");
    expect(m.description).toContain("Atualizar");
  });

  it("status ausente cai em análise, não em aprovado", () => {
    // O erro barato é dizer "em análise" para algo já decidido: o usuário confere
    // na lista. O caro seria afirmar aprovação e o vendedor tentar enviar.
    for (const entrada of [null, undefined, "", "   "]) {
      expect(mensagemDaCriacao(entrada).title).toContain("análise");
    }
  });

  it("palavra desconhecida do fornecedor não vira aprovação", () => {
    const m = mensagemDaCriacao("SOMETHING_NEW");

    expect(m.title).toContain("análise");
    expect(m.variant).toBeUndefined();
  });

  it("não depende de caixa nem de espaço em volta", () => {
    expect(mensagemDaCriacao(" rejected ").variant).toBe("destructive");
    expect(mensagemDaCriacao("Approved").title).toContain("aprovado");
  });
});
