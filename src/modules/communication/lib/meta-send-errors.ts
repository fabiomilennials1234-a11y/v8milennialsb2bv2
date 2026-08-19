/**
 * O que a recusa da Meta quer dizer, em português.
 *
 * ─── POR QUE TRADUZIR ───────────────────────────────────────────────────────
 *
 * O texto que a Meta devolve é escrito para quem integra, não para quem vende:
 *
 *   "(#132012) Parameter format does not match format in the created template |
 *    details: header: Format mismatch, expected IMAGE, received UNKNOWN"
 *   "(#131026) Message Undeliverable."
 *
 * O primeiro quer dizer "faltou a imagem do cabeçalho". O segundo, "esse número
 * não recebe WhatsApp". São ações completamente diferentes — anexar um arquivo,
 * ou corrigir o cadastro do lead — e o vendedor não tem como saber disso lendo o
 * original.
 *
 * ⚠️ O TEXTO CRU NÃO SOME. Ele fica disponível para quem for investigar: a
 * tradução some com o código, e sem o código eu não acho nada em produção. Quem
 * chama decide onde mostrar cada um.
 */

export interface RecusaDaMeta {
  /** Frase para o vendedor. */
  mensagem: string;
  /** O que fazer, quando há uma ação óbvia. */
  acao?: string;
  /** O código, mantido para investigação. */
  codigo: string | null;
}

/**
 * Códigos medidos ou documentados. A lista é curta de propósito: cada entrada
 * afirma que sabemos o que aquilo significa, e um mapeamento errado é pior que
 * nenhum — manda o vendedor consertar a coisa errada.
 */
const CONHECIDOS: Record<string, Omit<RecusaDaMeta, "codigo">> = {
  // Medido em produção 2026-08-19: template com cabeçalho de imagem enviado sem
  // o componente de header.
  "132012": {
    mensagem: "Faltou um parâmetro que este template exige",
    acao: "Reenvie pelo seletor de template — ele pede o que falta antes de liberar o envio.",
  },
  // Medido em produção 2026-08-19: número de lista importada, com um dígito a
  // menos, normalizado para um celular que não existe.
  "131026": {
    mensagem: "Este número não recebe mensagens no WhatsApp",
    acao: "Confira o telefone do lead — o número pode estar incompleto ou sem conta no WhatsApp.",
  },
  // Medido em produção 2026-08-19: áudio em MP4 fragmentado.
  "131053": {
    mensagem: "A Meta não aceitou o arquivo enviado",
    acao: "Tente outro arquivo — formatos fora da lista da Meta são recusados no processamento.",
  },
  "132000": {
    mensagem: "O template esperava outra quantidade de parâmetros",
    acao: "Reenvie pelo seletor: ele monta os parâmetros a partir do template aprovado.",
  },
  "131047": {
    mensagem: "A janela de 24 horas fechou",
    acao: "Só template aprovado é aceito agora.",
  },
  "131051": {
    mensagem: "Tipo de mensagem não suportado neste canal",
  },
};

/**
 * Lê `provider_code` e o texto cru, e devolve o que mostrar.
 *
 * Código desconhecido devolve o texto do fornecedor — que é feio, mas verdadeiro.
 * Inventar uma frase amigável para um código que não conhecemos seria adivinhar
 * em nome da Meta.
 */
export function traduzirRecusaDaMeta(
  codigo: string | null | undefined,
  textoCru: string | null | undefined,
): RecusaDaMeta | null {
  const cru = (textoCru ?? "").trim();
  const cod = (codigo ?? "").trim() || null;

  if (cod && CONHECIDOS[cod]) {
    return { ...CONHECIDOS[cod], codigo: cod };
  }
  if (!cru) return null;
  return { mensagem: cru, codigo: cod };
}
