/**
 * Adoção de canal PRÉ-EXISTENTE na subconta. PURO.
 *
 * ─── O BURACO QUE ISTO FECHA ────────────────────────────────────────────────
 *
 * O fluxo de conexão do Torque pressupõe que o canal NASCE durante o clique: o
 * `channel-start` fotografa os canais existentes, o Seamless cria um novo, e o
 * `channel-finish` vincula "o que apareceu depois da foto". A foto existe por um
 * bom motivo — sem ela, um popup abandonado deixa um canal solto e toda conexão
 * seguinte da org bate em `ambiguous_channel` para sempre.
 *
 * Só que o pressuposto é falso para o cliente que JÁ USAVA o NotificaMe antes do
 * Torque. Aí o canal existe desde antes, e o fluxo trava duas vezes:
 *
 *   • a cota da subconta já está gasta, então o Seamless responde
 *     `channel limit exceeded` e o popup morre antes de carregar. Sem popup não
 *     há `postMessage`, e o `postMessage` é o ÚNICO gatilho do finish — o poll de
 *     `popup.closed` só cancela, nunca conclui;
 *   • e mesmo forçando o finish, o canal está DENTRO da foto e é descartado:
 *     zero candidatos ⇒ `no_channel_found`.
 *
 * Resultado medido em produção (Chique Distribuidora, 18/08/2026): sete
 * tentativas, sete `409`, com o canal certo conectado e visível no painel do
 * fornecedor o tempo todo. E a mensagem que chega ao cliente —
 * `Nenhum canal de whatsapp liberado` — o manda cobrar o suporte do fornecedor,
 * que não tem culpa nenhuma: a conta dele está certa, falta o registro do NOSSO
 * lado. O desvio manual foi zerar a baseline e chamar o finish pelo console.
 *
 * ─── COMO ISTO RESOLVE, SEM AFROUXAR A PROTEÇÃO ─────────────────────────────
 *
 * Não removemos a foto: removemos DELA o canal adotado, e só ele. Todos os
 * outros seguem descartados como antes, então um popup abandonado continua sem
 * poder ser reivindicado por engano. O finish enxerga exatamente um candidato e
 * grava pelo caminho normal — mesma tabela, mesmos guards, mesma cota.
 *
 * ─── POR QUE "EXATAMENTE UM" ────────────────────────────────────────────────
 *
 * Zero não é adoção: é conexão nova, e o fluxo antigo já a atende. Dois ou mais é
 * ambiguidade, e adivinhar aqui entrega as mensagens de uma empresa a outra — o
 * mesmo raciocínio que já faz o finish parar em `ambiguous_channel`. Na dúvida,
 * não adota: o custo é um clique a mais; o custo do erro é cross-tenant.
 */
import { normalizeSeamlessType, type SeamlessChannelType } from "./notificame.ts";

/** O que `listChannels` devolve — só o que a decisão precisa. */
export interface CanalDoFornecedor {
  id: string;
  /** `undefined` entra porque o fornecedor às vezes OMITE o campo — não é o
   * mesmo que declarar nulo, e `normalizeSeamlessType` trata os dois igual. */
  type?: string | null;
}

export type AdoptDecision =
  | { ok: true; channelId: string }
  /** `none` = nada a adotar (fluxo normal). `ambiguous` = 2+, e PARA. */
  | { ok: false; reason: "none" | "ambiguous" };

/**
 * Decide se há UM canal do tipo pedido, ainda não vinculado, pronto para adoção.
 *
 * `jaVinculados` são os `channel_id` que o Torque já gravou para esta org — em
 * `whatsapp_instances.provider_config->>'channel_id'` e em
 * `messaging_channels.external_channel_id`. Sem esse filtro, a SEGUNDA conexão da
 * org adotaria o canal da primeira, roubando o vínculo que já funcionava.
 *
 * O tipo é lido pelo vocabulário do FORNECEDOR (`normalizeSeamlessType`), não
 * pela palavra do nosso pedido: o canal oficial chega como
 * `whatsapp_business_account`, e comparar string crua perderia todos eles.
 */
export function pickAdoptableChannel(
  canais: readonly CanalDoFornecedor[],
  jaVinculados: ReadonlySet<string>,
  tipoPedido: SeamlessChannelType,
): AdoptDecision {
  const candidatos = canais.filter((c) =>
    !jaVinculados.has(c.id) && normalizeSeamlessType(c.type) === tipoPedido
  );

  if (candidatos.length === 0) return { ok: false, reason: "none" };
  if (candidatos.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, channelId: candidatos[0].id };
}

/**
 * A foto MENOS o canal adotado.
 *
 * Este recorte é a diferença entre "adotar um canal" e "desligar a proteção":
 * sem adoção a foto sai inteira, e com adoção sai inteira menos um id.
 */
export function baselineExcluindoAdotado(
  todosOsIds: readonly string[],
  adotado: string | null,
): string[] {
  return adotado === null ? [...todosOsIds] : todosOsIds.filter((id) => id !== adotado);
}
