/**
 * Quando o "telefone" da conversa não é um telefone.
 *
 * O WhatsApp esconde o número do interlocutor por privacidade e entrega um
 * **LID** (`<id>@lid`) no lugar do JID de telefone. O backfill de histórico da
 * Uazapi devolve a conversa só por esse identificador — sem número e sem nome
 * (medido em 2026-09-03 na Café Jurerê: 498 conversas, `push_name` preenchido
 * em ZERO delas). O inbox então listava contatos chamados `210028246085780`.
 *
 * O mesmo vale para canais/Status (`@newsletter`), que aparecem como
 * `120363404701403742`.
 *
 * Aqui é só APRESENTAÇÃO: um código que não diz nada vira um rótulo que diz o
 * que houve. A conversa continua acessível e o identificador continua no banco.
 *
 * ⚠️ A detecção é por COMPRIMENTO, e isso é uma escolha com custo conhecido: a
 * lista do inbox vem de `get_whatsapp_conversation_list`, que devolve
 * `phone_number` já sem o sufixo `@lid` — o front não tem como saber pelo dado
 * que recebe. E.164 admite até 15 dígitos, então um número internacional de 14
 * ou 15 dígitos seria rotulado por engano; nenhum número brasileiro chega lá
 * (12–13 com o país). A correção definitiva é a RPC devolver a natureza do
 * identificador, e não o front adivinhar pelo tamanho — segue anotado como
 * follow-up no PR #1975.
 */

/** Acima disto, não é telefone de gente: E.164 vai até 15 dígitos. */
const MIN_DIGITOS_OCULTO = 14;

/** Grupos e canais do WhatsApp compartilham este prefixo de id. */
const PREFIXO_CANAL = "120363";

function digitosDe(bruto: string | null | undefined): string {
  if (!bruto) return "";
  return bruto.split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Este identificador é um código opaco (LID / canal) em vez de um telefone?
 */
export function ehIdentificadorOculto(bruto: string | null | undefined): boolean {
  return digitosDe(bruto).length >= MIN_DIGITOS_OCULTO;
}

/**
 * Rótulo humano para um identificador opaco, ou `null` se for telefone de
 * verdade — `null` e não string vazia para que quem chama exiba o que já
 * exibia, em vez de desenhar um rótulo em branco.
 *
 * O sufixo de 6 dígitos não é decoração: sem ele, 514 conversas viram 514
 * linhas idênticas chamadas "Contato sem número", e o operador perde a única
 * forma que resta de distinguir uma da outra.
 */
export function rotuloDeIdentificadorOculto(
  bruto: string | null | undefined,
): string | null {
  const digitos = digitosDe(bruto);
  if (digitos.length < MIN_DIGITOS_OCULTO) return null;
  if (digitos.startsWith(PREFIXO_CANAL)) return "Canal do WhatsApp";
  return `Contato sem número · ${digitos.slice(-6)}`;
}

/**
 * O que exibir no lugar de um telefone: o rótulo, quando o identificador é
 * opaco; senão o próprio valor, intocado.
 */
export function telefoneParaExibicao(
  bruto: string | null | undefined,
): string | null | undefined {
  return rotuloDeIdentificadorOculto(bruto) ?? bruto;
}

/**
 * Legenda para a LINHA DO TELEFONE (subtítulo do cabeçalho, painel de
 * contexto), onde o rótulo com discriminador seria eco do título logo acima.
 * Aqui o que falta explicar não é QUAL contato é, e sim por que não há número.
 */
export function legendaDoTelefone(
  bruto: string | null | undefined,
): string | null | undefined {
  return ehIdentificadorOculto(bruto) ? "Número oculto pelo WhatsApp" : bruto;
}
