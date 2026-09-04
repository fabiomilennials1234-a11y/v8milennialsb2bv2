/**
 * Regressão: a exclusão de funil engolia a causa e mostrava "Erro ao excluir
 * funil" para tudo.
 *
 * Dois defeitos reais, medidos em produção em 2026-09-04:
 *
 * 1. `e instanceof Error` é FALSO para erro do Supabase. `PostgrestError` é
 *    objeto simples, não instância de `Error` — a mensagem virava "" e TODA
 *    falha caía no genérico.
 * 2. Não havia ramo final que mostrasse a mensagem, então qualquer recusa fora
 *    dos padrões conhecidos perdia a causa.
 *
 * O caso do CTO: viu o genérico, e os logs mostraram que a requisição nem saiu
 * do navegador. Sem a causa na tela, não havia como diagnosticar pela tela.
 */
import { describe, it, expect } from "vitest";
import { mensagemDeFalhaAoExcluir } from "@/modules/pipelines/lib/mensagem-falha-ao-excluir";

// O formato REAL do erro do Supabase: objeto simples, sem prototype de Error.
const erroSupabase = (over: Record<string, unknown> = {}) => ({
  message: "erro",
  details: null,
  hint: null,
  code: "P0001",
  ...over,
});

describe("mensagemDeFalhaAoExcluir", () => {
  it("reconhece o funil padrão da org vindo como PostgrestError (não como Error)", () => {
    const e = erroSupabase({
      message:
        'pipeline_is_org_default: o funil "Oportunidades" é o funil padrão da organização.',
    });
    // Antes: `e instanceof Error` = false -> "" -> genérico.
    expect(mensagemDeFalhaAoExcluir(e)).toBe(
      "Este funil ainda é o padrão da organização. Escolha o substituto e tente de novo.",
    );
  });

  it("reconhece a recusa por permissão", () => {
    expect(mensagemDeFalhaAoExcluir(erroSupabase({ message: "sem permissão sobre este funil" })))
      .toBe("Você não tem permissão para excluir este funil");
  });

  it("reconhece funil inexistente", () => {
    expect(mensagemDeFalhaAoExcluir(erroSupabase({ message: "funil não encontrado" })))
      .toBe("Este funil já não existe nesta organização.");
  });

  it("mostra a mensagem CRUA quando não casa nenhum padrão conhecido", () => {
    // É este o caso que produzia "Erro ao excluir funil" sem pista nenhuma.
    const e = erroSupabase({
      message: "JSON object requested, multiple (or no) rows returned",
      code: "PGRST116",
    });
    const saida = mensagemDeFalhaAoExcluir(e);
    expect(saida).toContain("multiple (or no) rows returned");
    expect(saida).not.toBe("Erro ao excluir funil");
  });

  it("aproveita details e hint do PostgrestError, que carregam a causa concreta", () => {
    const e = erroSupabase({
      message: "insert or update violates foreign key constraint",
      details: 'Key (pipeline_id) is still referenced from table "pipeline_entries".',
      hint: "Mova os cards antes.",
    });
    const saida = mensagemDeFalhaAoExcluir(e);
    expect(saida).toContain("pipeline_entries");
    expect(saida).toContain("Mova os cards antes.");
  });

  it("ainda funciona com Error nativo, que é o caminho do throw do próprio front", () => {
    expect(mensagemDeFalhaAoExcluir(new Error("Sem organização"))).toBe("Sem organização");
  });

  it("só cai no genérico quando não há mensagem nenhuma", () => {
    expect(mensagemDeFalhaAoExcluir(null)).toBe("Erro ao excluir funil");
    expect(mensagemDeFalhaAoExcluir({})).toBe("Erro ao excluir funil");
  });
});
