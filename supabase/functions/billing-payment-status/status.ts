/**
 * O ESTADO DE PAGAMENTO QUE A TELA VÊ — resolvedor puro (SCRUM-289, Fatia 8).
 *
 * Quatro valores, fechado, e o VOCABULÁRIO DO GATEWAY NÃO VAZA PARA O NAVEGADOR.
 * A distinção entre `confirmed` e `received` da Asaas é FINANCEIRA — dinheiro
 * confirmado × dinheiro disponível, e no cartão são 32 dias de diferença —, não
 * é distinção de produto. Se ela vazar para a tela, o dia em que a regra de
 * liberação mudar obriga a mexer no front junto.
 *
 * NADA AQUI REIMPLEMENTA O MAPA DE EVENTOS DA ASAAS.
 * ------------------------------------------------
 * `decidir()` e `proximoStatus()` vêm de `asaas-webhook/decide.ts`, que é o
 * dono do vocabulário e da ESCADA MONOTÔNICA. Uma cópia deste mapa aqui seria a
 * segunda — e este repositório já pagou por uma terceira cópia de uma regra:
 * o CHECK de `payment_link_charges.method` aceitava `boleto`, método que o
 * produto não vende, porque era a terceira cópia do vocabulário de método e foi
 * onde ele divergiu (#1533). Cópia que anda sozinha diverge; a única defesa é
 * não haver cópia.
 *
 * DE ONDE VEM `paid`, e por que NÃO é de `org_subscriptions`
 * ---------------------------------------------------------
 * De `payment_webhook_events`, casando pelo `provider_charge_id` das cobranças
 * deste link. Medido, não presumido:
 *
 *   - `org_subscriptions` só ganha linha quando existe ORGANIZAÇÃO. No ramo
 *     `new_org` ela ainda não existe — é a Fatia 9 que a cria, DEPOIS do
 *     pagamento. Derivar de lá deixaria o `new_org` em `pending` PARA SEMPRE
 *     com o dinheiro já pago, e `new_org` é justamente o que o checkout público
 *     mais serve: o cliente que ainda não é cliente.
 *   - `payment_history.organization_id` é NOT NULL, e no ramo `new_org` o
 *     handler do webhook monta `organization_id` nulo — o upsert falha, o erro
 *     é engolido (o handler responde 200 por desenho) e a compra não deixa
 *     linha lá. Também não serve.
 *   - `payment_webhook_events` é gravada PRIMEIRO pelo handler, antes de
 *     resolver organização, e a coluna de organização dela é ANULÁVEL. É a
 *     única trilha que existe nos DOIS ramos.
 *
 * Quem "melhorar" isto para ler `org_subscriptions` reintroduz o pending
 * eterno. O parágrafo acima existe para essa pessoa.
 */

import { decidir, proximoStatus, type PaymentStatus } from "../asaas-webhook/decide.ts";

/** O que a tela entende. Fechado — ver o cabeçalho. */
export type EstadoDeTela = "pending" | "paid" | "expired" | "failed";

/** Uma linha de `payment_webhook_events`, no recorte que importa aqui. */
export interface EventoDoLivro {
  /**
   * `provider_event_id` da linha do livro — `NOT NULL` lá, então sempre existe.
   *
   * Parece supérfluo aqui, e não é: `decidir()` RECUSA classificar um evento sem
   * id, porque sem id não há idempotência e uma re-entrega viraria cobrança
   * duplicada. Passar o id REAL do livro é o que mantém `decidir` como único
   * dono do mapa; forjar um id constante só para passar pela guarda seria
   * contornar a regra de outra pessoa por dentro.
   */
  event_id: string | null;
  event_type: string | null;
  /** ISO. Quando o provedor informou a data de pagamento. */
  paid_at?: string | null;
}

export interface EntradaDoStatus {
  /** Código de `billing_resolve_payment_link`. */
  linkCode: string;
  /** ISO. Da proposta, não do gateway. */
  expiresAt?: string | null;
  eventos: EventoDoLivro[];
  /** Injetado para o teste não depender do relógio. */
  now: Date;
}

export interface ResultadoDoStatus {
  state: EstadoDeTela;
  paid_at?: string;
}

/** Canônicos que significam DINHEIRO CHEGOU. Mesmo par do webhook. */
const PAGOS: PaymentStatus[] = ["confirmed", "received"];

/**
 * Canônicos que significam NÃO VAI DAR CERTO por esta cobrança.
 *
 * `refunded` entra aqui e não em `paid`: estorno vem DEPOIS de um pagamento e o
 * substitui (é o topo da escada em `decide.ts`), então quem estornou não tem
 * acesso a comprar — a tela precisa dizer que não deu, não que deu.
 *
 * `overdue` NÃO entra: boleto/Pix vencido no gateway não fecha a proposta, e a
 * proposta tem validade própria. Quem decide vencimento aqui é o nosso
 * `expires_at`, não o do gateway.
 */
const FALHOS: PaymentStatus[] = ["failed", "cancelled", "refunded"];

/**
 * Dobra os eventos do livro pela MESMA escada do webhook.
 *
 * Ordem de chegada não é garantida fora do modo SEQUENTIALLY, então reduzir por
 * `proximoStatus` — e não pegar "o último que chegou" — é o que impede um
 * `CONFIRMED` atrasado de rebaixar quem já está `RECEIVED` e dizer "aguardando"
 * para quem já pagou.
 */
function statusCanonico(eventos: EventoDoLivro[]): PaymentStatus | null {
  let atual: PaymentStatus | null = null;
  for (const e of eventos) {
    if (!e?.event_type || !e?.event_id) continue;
    // `decidir` quer a forma de um evento da Asaas. O que ele usa daqui é o id
    // (guarda de idempotência) e o tipo (o mapa).
    const { status } = decidir({ id: e.event_id, event: e.event_type, payment: {} });
    if (!status) continue; // tipo fora do mapa: absorve, não derruba a tela.
    atual = proximoStatus(atual, status);
  }
  return atual;
}

/** A data que a tela mostra: a primeira que o provedor informou. */
function primeiroPagamento(eventos: EventoDoLivro[]): string | undefined {
  const datas = eventos
    .map(e => e?.paid_at)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return datas[0];
}

/**
 * PRECEDÊNCIA, e ela não é arbitrária:
 *
 *   1. PAGO vence tudo, inclusive vencido. Dinheiro que chegou é fato mais
 *      forte que relógio — dizer "expirado" para quem acabou de pagar é o pior
 *      desfecho possível desta tela, e acontece de verdade: o cliente paga o
 *      Pix nos últimos segundos de validade e o nosso `expires_at` passa antes
 *      do webhook chegar.
 *   2. FALHOU vence vencido, pelo mesmo motivo invertido: a razão específica
 *      ajuda mais que a genérica.
 *   3. VENCIDO vence pendente.
 *   4. O resto é pendente — e pendente é o único estado em que a página segue
 *      perguntando.
 */
export function resolverStatusDeTela(entrada: EntradaDoStatus): ResultadoDoStatus {
  const { linkCode, expiresAt, eventos, now } = entrada;

  const canonico = statusCanonico(eventos ?? []);

  if (canonico && PAGOS.includes(canonico)) {
    const paidAt = primeiroPagamento(eventos ?? []);
    return paidAt ? { state: "paid", paid_at: paidAt } : { state: "paid" };
  }

  if (canonico && FALHOS.includes(canonico)) return { state: "failed" };

  // Proposta que não existe mais, ou que foi revogada, não vai receber
  // pagamento nenhum. `failed` e não `expired`: expirado é relógio, e estes
  // dois são decisão de alguém.
  if (linkCode === "link_not_found" || linkCode === "link_revoked") {
    return { state: "failed" };
  }

  // `link_already_paid` do resolvedor é caminho PREPARADO, não vivo: nada no
  // repositório escreve `payment_links.paid_at` hoje (medido em 2026-08-12 no
  // origin/main). Tratado assim mesmo, para o dia em que passar a ser escrito
  // esta linha já estar certa em vez de virar bug novo.
  if (linkCode === "link_already_paid") return { state: "paid" };

  const vencido = linkCode === "link_expired" ||
    (!!expiresAt && new Date(expiresAt).getTime() <= now.getTime());
  if (vencido) return { state: "expired" };

  return { state: "pending" };
}

/**
 * ORÇAMENTO DE PERGUNTA. A página pergunta rápido enquanto o cliente está
 * olhando, e devagar depois — Pix chega em segundos, cartão pode levar minutos.
 *
 * Isto vive aqui, e não no componente, porque é o mesmo número que dimensiona o
 * teto por IP do endpoint: 2 min a cada 3s já são 40 perguntas, e o teto de
 * 20/5min da porta do LINK (que o front chama uma vez por sessão) reprovaria o
 * uso legítimo. Dois números que precisam concordar não moram em dois arquivos.
 */
export const POLL_RAPIDO_MS = 3_000;
export const POLL_LENTO_MS = 10_000;
export const POLL_JANELA_RAPIDA_MS = 120_000;

/** Intervalo da próxima pergunta, dado quanto tempo já se está perguntando. */
export function intervaloDePoll(decorridoMs: number): number {
  return decorridoMs < POLL_JANELA_RAPIDA_MS ? POLL_RAPIDO_MS : POLL_LENTO_MS;
}

/** Estado terminal: a resposta não muda mais, então não se pergunta de novo. */
export function ehTerminal(state: EstadoDeTela): boolean {
  return state !== "pending";
}
