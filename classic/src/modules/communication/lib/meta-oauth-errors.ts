/**
 * O `?reason=` com que a `meta-oauth-callback` devolve o usuário à tela.
 *
 * Até o ADR-0038 o toast mostrava o código com `_` trocado por espaço —
 * "Erro ao conectar: access denied" quando o usuário só tinha cancelado no
 * Facebook. Cada motivo pede uma reação diferente, então cada um diz qual.
 */
const META_OAUTH_ERRORS: Record<string, string> = {
  // Vem do próprio Facebook: o usuário fechou ou negou a autorização.
  access_denied: "Você cancelou a autorização no Facebook. Conecte de novo quando quiser.",
  codigo_ausente: "O Facebook não devolveu a autorização. Tente conectar de novo.",
  state_invalido: "A conexão expirou ou foi aberta em outra aba. Tente conectar de novo por aqui.",
  erro_ao_salvar_conexao:
    "O Facebook autorizou, mas não conseguimos salvar a conexão. Tente de novo; se continuar, fale com o suporte.",
};

const META_OAUTH_FALLBACK =
  "Não foi possível conectar ao Facebook. Tente de novo; se continuar, fale com o suporte.";

export function metaOAuthErrorMessage(reason: string | null | undefined): string {
  if (!reason) return META_OAUTH_FALLBACK;
  return Object.prototype.hasOwnProperty.call(META_OAUTH_ERRORS, reason)
    ? META_OAUTH_ERRORS[reason]
    : META_OAUTH_FALLBACK;
}
