import { getErrorMessage, userMessageOf } from "@/shared/errors";

/*
 * Tradução da falha ao excluir funil — pura e exportada porque a versão
 * anterior vivia dentro do `catch` e tinha dois
 * defeitos que só apareciam em produção:
 *
 * 1. `e instanceof Error` é FALSO para erro do Supabase — `PostgrestError` é
 *    objeto simples ({ message, details, hint, code }), não instância de `Error`.
 *    A mensagem virava "" e TODA falha caía no genérico.
 * 2. Não havia ramo final que mostrasse a mensagem: depois de checar "invasor"
 *    ia direto para o genérico, então qualquer recusa fora dos 4 padrões
 *    conhecidos perdia a causa.
 *
 * Resultado medido em 2026-09-04: o CTO viu "Erro ao excluir funil" sem nenhuma
 * pista, e os logs mostraram que a requisição nem chegou a sair do navegador.
 * As RPCs recusam em português e dizem o motivo — jogar isso fora transforma
 * recusa acionável em mistério.
 */

const FALLBACK = "Não foi possível excluir o funil.";

/**
 * As recusas que a exclusão conhece, traduzidas para o que o usuário faz a
 * seguir. `null` quando não é nenhuma delas — aí quem decide é o contrato de
 * erro (ADR-0038): frase PT do banco passa, texto técnico vira o fallback e vai
 * para o relatório.
 */
export function traducaoDeFalhaAoExcluir(e: unknown): string | null {
  const msg = getErrorMessage(e);
  if (msg.includes("pipeline_is_org_default")) {
    return "Este funil ainda é o padrão da organização. Escolha o substituto e tente de novo.";
  }
  if (msg.includes("não encontrado") || msg.includes("não tem o funil")) {
    return "Este funil já não existe nesta organização.";
  }
  if (msg.includes("permissão")) {
    return "Você não tem permissão para excluir este funil";
  }
  return null;
}

/**
 * Traduz a falha da exclusão em mensagem para o usuário.
 *
 * Até o ADR-0038, qualquer recusa fora dos padrões conhecidos ia CRUA para a
 * tela ("preferimos texto técnico feio a usuário sem pista"). Agora a pista vai
 * para o relatório, com o código que aparece no toast, e a tela recebe uma
 * frase — o `PostgrestError` como objeto simples continua reconhecido, que era
 * o defeito medido em 2026-09-04.
 */
export function mensagemDeFalhaAoExcluir(e: unknown): string {
  return traducaoDeFalhaAoExcluir(e) ?? userMessageOf(e, FALLBACK);
}
