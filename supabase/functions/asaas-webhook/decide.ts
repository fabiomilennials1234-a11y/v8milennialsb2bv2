/**
 * O que fazer com um evento do gateway — lógica pura, sem Deno, sem rede.
 *
 * Três regras mandam aqui, e as três vieram da documentação do provedor, não de
 * intuição:
 *
 * 1. PAGO = `CONFIRMED` **OU** `RECEIVED`, o que chegar primeiro.
 *    `CONFIRMED` é "o cliente pagou, saldo ainda não disponível"; `RECEIVED` é
 *    "dinheiro na conta". No CARTÃO o `RECEIVED` chega 32 DIAS depois do
 *    `CONFIRMED`; no PIX o `CONFIRMED` é PULADO (CREATED → RECEIVED direto).
 *    Esperar só o `RECEIVED` deixa o cliente de cartão um mês sem acesso;
 *    esperar só o `CONFIRMED` nunca libera o cliente de Pix. É a decisão que,
 *    errada, aparece como cliente pagando e não recebendo acesso.
 *
 * 2. A TRANSIÇÃO É MONOTÔNICA. A ordem de entrega só é garantida no modo
 *    SEQUENTIALLY; em NON_SEQUENTIALLY o `RECEIVED` pode chegar ANTES do
 *    `CONFIRMED`. Então o estado nunca REBAIXA: quem já está `received` não
 *    volta para `confirmed` porque um evento atrasado chegou depois.
 *
 * 3. O DESCONHECIDO É ABSORVIDO. Em modo SEQUENTIALLY, UM evento penalizado
 *    bloqueia TODOS os seguintes da mesma fila, e 15 falhas consecutivas pausam
 *    a fila inteira — evento pausado morre em 14 dias. Devolver erro num tipo
 *    que não sabemos tratar derruba o recebimento de TODA a receita, não só
 *    daquele evento. Aqui ele vira `unknown_type` e espera inspeção.
 */

/** Estados de `payment_history.status` — vocabulário do provedor, já no CHECK. */
export type PaymentStatus =
  | "pending"
  | "confirmed"
  | "received"
  | "overdue"
  | "refunded"
  | "failed"
  | "cancelled";

/** Posição na escada. Só se sobe. */
const RANK: Record<PaymentStatus, number> = {
  pending: 0,
  overdue: 1,
  failed: 2,
  cancelled: 3,
  confirmed: 4,
  received: 5,
  // Estorno é o único que anda "para trás" e ainda assim é avanço no tempo:
  // vem depois de um pagamento e o substitui.
  refunded: 6,
};

const EVENT_TO_STATUS: Record<string, PaymentStatus> = {
  PAYMENT_CREATED: "pending",
  PAYMENT_AWAITING_RISK_ANALYSIS: "pending",
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: "pending",
  PAYMENT_UPDATED: "pending",
  PAYMENT_CONFIRMED: "confirmed",
  PAYMENT_RECEIVED: "received",
  PAYMENT_ANTICIPATED: "received",
  PAYMENT_OVERDUE: "overdue",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "failed",
  PAYMENT_DELETED: "cancelled",
  PAYMENT_RESTORED: "pending",
  PAYMENT_REFUNDED: "refunded",
  PAYMENT_PARTIALLY_REFUNDED: "refunded",
  PAYMENT_REFUND_IN_PROGRESS: "refunded",
  PAYMENT_CHARGEBACK_REQUESTED: "refunded",
  PAYMENT_CHARGEBACK_DISPUTE: "refunded",
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: "refunded",
};

/** Os dois que liberam acesso. Ver regra 1. */
const LIBERAM_ACESSO: PaymentStatus[] = ["confirmed", "received"];

export interface AsaasEvent {
  /** `evt_…` — estável entre re-entregas. É a chave de idempotência. */
  id?: unknown;
  event?: unknown;
  payment?: {
    id?: unknown;
    subscription?: unknown;
    value?: unknown;
    billingType?: unknown;
    confirmedDate?: unknown;
    paymentDate?: unknown;
    invoiceUrl?: unknown;
    transactionReceiptUrl?: unknown;
    externalReference?: unknown;
  } | null;
}

export interface Decisao {
  /** Falso quando o corpo não é um evento utilizável. */
  usavel: boolean;
  eventId: string | null;
  eventType: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
  /** Nulo quando o tipo não está no mapa — o caso "absorve e registra". */
  status: PaymentStatus | null;
  /** Se este evento deve liberar/renovar o acesso da organização. */
  provisiona: boolean;
  /** `applied` | `ignored` | `unknown_type` — o que vai para o livro. */
  registro: "applied" | "ignored" | "unknown_type";
  invoiceUrl: string | null;
  receiptUrl: string | null;
  billingType: string | null;
  /** ISO, quando o provedor informa. */
  paidAt: string | null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function decidir(evento: AsaasEvent): Decisao {
  const eventId = texto(evento?.id);
  const eventType = texto(evento?.event);
  const pagamento = evento?.payment ?? null;

  const base: Decisao = {
    usavel: false,
    eventId,
    eventType,
    paymentId: texto(pagamento?.id),
    subscriptionId: texto(pagamento?.subscription),
    status: null,
    provisiona: false,
    registro: "unknown_type",
    invoiceUrl: texto(pagamento?.invoiceUrl),
    receiptUrl: texto(pagamento?.transactionReceiptUrl),
    billingType: texto(pagamento?.billingType),
    paidAt: texto(pagamento?.confirmedDate) ?? texto(pagamento?.paymentDate),
  };

  // Sem o id do evento não há idempotência possível — e sem idempotência, uma
  // re-entrega viraria cobrança duplicada no histórico. Recusa a gravar, mas
  // quem chama ainda responde 200: a fila não pode pausar por isso.
  if (!eventId) return base;

  base.usavel = true;

  const status = eventType ? EVENT_TO_STATUS[eventType] : undefined;
  if (!status) {
    // Tipo que ainda não existe no nosso mapa. Absorvido, não recusado.
    return { ...base, registro: "unknown_type" };
  }

  return {
    ...base,
    status,
    provisiona: LIBERAM_ACESSO.includes(status),
    registro: "applied",
  };
}

/**
 * O estado só sobe. Devolve o que deve ficar gravado.
 *
 * Sem isto, um `CONFIRMED` atrasado chegando depois do `RECEIVED` rebaixaria a
 * cobrança — e a tela do cliente diria "aguardando" para quem já pagou.
 */
export function proximoStatus(
  atual: PaymentStatus | null,
  novo: PaymentStatus,
): PaymentStatus {
  if (!atual) return novo;
  return RANK[novo] > RANK[atual] ? novo : atual;
}

/**
 * O acesso já foi liberado uma vez? Então o segundo evento que libera não
 * provisiona de novo — é o par CONFIRMED/RECEIVED do cartão chegando duas
 * vezes para a mesma cobrança.
 */
export function deveProvisionar(
  statusAtual: PaymentStatus | null,
  statusNovo: PaymentStatus,
): boolean {
  if (!LIBERAM_ACESSO.includes(statusNovo)) return false;
  if (statusAtual && LIBERAM_ACESSO.includes(statusAtual)) return false;
  return true;
}
