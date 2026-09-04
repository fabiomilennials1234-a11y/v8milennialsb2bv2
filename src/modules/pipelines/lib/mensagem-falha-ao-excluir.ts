import { getErrorMessage } from "@/shared/errors";

/**
 * Traduz a falha da exclusão em mensagem para o usuário.
 *
 * Exportada e pura porque a versão anterior vivia dentro do `catch` e tinha dois
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
export function mensagemDeFalhaAoExcluir(e: unknown): string {
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
  // Qualquer outra recusa vai CRUA para a tela. Preferimos texto técnico feio a
  // usuário e suporte sem nenhuma pista do que aconteceu.
  //
  // `getErrorMessage` cai em `String(error)` quando o objeto não tem campo
  // nenhum, e aí devolve "[object Object]" — que é pior que o genérico, porque
  // parece defeito de código em vez de erro de operação. Esses dois casos são
  // ausência de informação, não informação.
  const semInformacao = !msg || msg === "Erro desconhecido" || msg === "[object Object]";
  if (!semInformacao) return msg;
  return "Erro ao excluir funil";
}
