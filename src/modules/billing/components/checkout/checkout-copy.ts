/**
 * Toda a copy do checkout e os formatadores dela. Nenhuma mensagem ecoa o valor digitado.
 *
 * TEXTO DE AUTORIZAÇÃO: RASCUNHO. A redação de `consentText` e de `cancellationText` aguarda
 * aprovação do CTO. Mudou o texto, muda `CHECKOUT_CONSENT_VERSION` junto com
 * `RECURRING_CONSENT_VERSION` em `billing-checkout-subscription/flow.ts`:
 * `tests/unit/checkout-copy.test.ts` amarra os dois. A versão fica gravada em
 * `payment_link_buyers` e nos metadados da assinatura, e é ela que prova o que foi aceito.
 */
import { cycleLabel, money } from "../../lib/billing-display";
import { isValidEmail, isValidTaxId, onlyDigits } from "../../lib/buyer-input";

export const CHECKOUT_CONSENT_VERSION = "2026-11-04";

export const formatMoney = (cents: number): string => money(cents / 100);

export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

export function recurrenceText(cycle: string | null | undefined): string | null {
  switch (cycle) {
    case "monthly":
      return "todo mês";
    case "semiannual":
    case "semester":
      return "a cada 6 meses";
    case "annual":
      return "todo ano";
    default:
      return null;
  }
}

export const cycleText = cycleLabel;

/** Máscara progressiva: até 11 dígitos é CPF; do 12º em diante, CNPJ. */
export function maskTaxId(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

/** O que sobra do documento depois do envio: o tipo e os 2 últimos dígitos. */
export function taxIdTail(raw: string): { kind: "CNPJ" | "CPF"; tail: string } {
  const d = onlyDigits(raw);
  return { kind: d.length === 14 ? "CNPJ" : "CPF", tail: d.slice(-2) };
}

export const legalNameError = (value: string): string | null =>
  value.trim() ? null : "Informe a razão social ou o nome.";

export function taxIdError(value: string): string | null {
  const d = onlyDigits(value);
  if (!d) return "Informe o CNPJ ou o CPF.";
  if (d.length !== 11 && d.length !== 14) return "O documento precisa ter 14 dígitos (CNPJ) ou 11 (CPF).";
  return isValidTaxId(d) ? null : COPY.buyer.taxIdInvalid;
}

export function emailError(value: string): string | null {
  if (!value.trim()) return "Informe o e-mail.";
  return isValidEmail(value) ? null : COPY.buyer.emailInvalid;
}

/** RASCUNHO, versão 2026-11-04. Ver o cabeçalho. */
export function consentText(amountCents: number, cycle: string): string {
  const valor = formatMoney(amountCents);
  return `Autorizo a Torque CRM a cobrar ${valor} hoje, no cartão que vou informar a seguir, e ${valor} ${recurrenceText(cycle)}, de forma automática, até o cancelamento.`;
}

/** RASCUNHO, versão 2026-11-04. Ver o cabeçalho. */
export function cancellationText(nextCharge: string | null): string {
  const quando = nextCharge ? `antes da próxima cobrança, em ${nextCharge}` : "antes da próxima cobrança";
  return `Para cancelar, fale com o time do Torque ${quando}. O acesso segue até o fim do período já pago.`;
}

export const COPY = {
  summary: {
    eyebrow: "Assinatura para",
    fallbackTitle: "Assinatura do Torque",
    captionMonthly: "no cartão, hoje.",
    captionUpfront: (monthly: string | null) =>
      monthly ? `à vista no cartão, hoje. Equivale a ${monthly} por mês.` : "à vista no cartão, hoje.",
    today: "Hoje",
    paidToday: "Pago hoje",
    onRenewal: "Na renovação",
    renews: (recurrence: string) => `Renova automaticamente ${recurrence}, até o cancelamento.`,
    plan: "Plano",
    users: "Usuários",
    cycle: "Cobrança",
    listPrice: "Preço de tabela por mês",
    cycleDiscount: "Desconto do ciclo",
    coupon: "Cupom",
    negotiated: "Desconto negociado",
    monthly: "Valor por mês",
    showDetails: "Ver detalhes da proposta",
    hideDetails: "Ocultar detalhes",
    validUntil: (date: string) => `Proposta válida até ${date}`,
    privacy: "Privacidade",
    brand: "Torque CRM",
  },
  buyer: {
    title: "Dados de faturamento",
    legalName: "Razão social ou nome",
    taxId: "CNPJ ou CPF",
    email: "E-mail",
    emailHelp: "Fica registrado como contato de cobrança.",
    taxIdRetype: "Por segurança, digite o documento de novo.",
    cta: "Continuar para o cartão",
    ctaBusy: "Conferindo os dados",
    taxIdInvalid: "Documento inválido. Confira os dígitos.",
    emailInvalid: "E-mail inválido. Confira o endereço.",
    legalNameMissing: "Informe a razão social ou o nome.",
    consentRequired: "Marque a autorização para continuar.",
    rateLimited: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
    offline: "Não conseguimos conectar. Confira sua internet e tente de novo.",
    sessionExpired: "A sessão de pagamento expirou e nada foi cobrado. Confirme os dados para continuar.",
    edit: "Alterar",
    collapsedDoc: (kind: string, tail: string) => `${kind} terminado em ${tail}`,
    consentGiven: "Cobrança recorrente autorizada.",
  },
  card: {
    title: "Cartão",
    testEnv: "Ambiente de teste. Nenhuma cobrança real será feita.",
    cta: (valor: string) => `Pagar ${valor}`,
    ctaBusy: "Processando pagamento",
    statusBusy: "Se o banco pedir confirmação, uma janela vai abrir. Não feche esta página.",
    trust: "Pagamento processado pela Stripe. O Torque não recebe nem guarda o número do cartão.",
    loadError: "O formulário do cartão não carregou. Confira sua conexão ou desative o bloqueador de anúncios nesta página.",
    retry: "Tentar de novo",
    unconfirmed: "Não foi possível confirmar o pagamento. Tente de novo: a nova tentativa não cobra duas vezes.",
  },
  confirmed: {
    title: "Pagamento confirmado",
    pending: (org: string) => `Estamos registrando a assinatura ${org}. Você já pode fechar esta página.`,
    paid: (org: string) => `Assinatura registrada. O acesso ${org} é atualizado automaticamente em alguns minutos.`,
    slow: "O pagamento foi aprovado e você não precisa pagar de novo. O registro está demorando mais que o normal. Se o acesso não atualizar até amanhã, fale com quem enviou este link.",
    amountPaid: "Valor pago",
    nextCharge: "Próxima cobrança",
    enter: "Entrar no Torque",
    renewal: (recurrence: string) =>
      `Renova automaticamente ${recurrence}. Para cancelar, fale com o time do Torque antes da próxima cobrança.`,
    analysisTitle: "Pagamento em análise",
    analysis: "O banco ainda está confirmando. Você já pode fechar esta página; nada mais precisa ser feito.",
  },
} as const;

export const orgPossessive = (displayName: string | null): string =>
  displayName ? `de ${displayName}` : "da sua empresa";

/**
 * Chame só com recusa explícita do banco (`isExplicitDecline`). Queda de conexão não é recusa: o
 * pagamento pode ter passado, e dizer "Nada foi cobrado" seria falso. Medido: resposta do confirm
 * perdida com PaymentIntent `succeeded`.
 */
export function declineMessage(code: string | undefined, declineCode: string | undefined, amountCents: number): string {
  const k = declineCode ?? code;
  switch (k) {
    case "insufficient_funds":
      return `O cartão não tem limite disponível para ${formatMoney(amountCents)}. Nada foi cobrado. Tente outro cartão ou peça a liberação ao banco.`;
    case "expired_card":
      return "Este cartão está vencido. Nada foi cobrado. Use outro cartão.";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "O código de segurança não confere. Nada foi cobrado. Confira e tente de novo.";
    case "incorrect_number":
    case "invalid_number":
      return "O número do cartão não confere. Nada foi cobrado. Confira e tente de novo.";
    case "processing_error":
      return "O banco não respondeu. Nada foi cobrado. Tente de novo em instantes.";
    case "payment_intent_authentication_failure":
    case "authentication_required":
      return "A confirmação no banco não foi concluída. Nada foi cobrado. Tente de novo ou use outro cartão.";
    default:
      return "O banco recusou este cartão. Nada foi cobrado. Tente outro cartão ou fale com o banco.";
  }
}

const EXPLICIT_DECLINE_CODES = new Set(["payment_intent_authentication_failure", "authentication_required"]);

export function isExplicitDecline(error: { type?: string; code?: string }): boolean {
  return error.type === "card_error" || EXPLICIT_DECLINE_CODES.has(error.code ?? "");
}

export type TerminalId =
  | "not_found"
  | "expired"
  | "revoked"
  | "already_paid"
  | "not_supported"
  | "org_subscribed"
  | "unavailable"
  | "offline"
  | "rate_limited"
  | "stale_bundle"
  | "resume_unknown";

/**
 * "Nada foi cobrado" só com prova. Falta de resposta, tela indisponível, link vencido ou pausa não
 * provam: o pagamento pode ter passado em outra aba, com o webhook a caminho. Sobram três usos:
 * - recusa (`declineMessage`): `card_error`, 3DS falho ou `last_payment_error` do próprio PI;
 * - sessão expirada: status do PI lido, nem pago nem em processamento;
 * - `org_subscribed`: POST recusado antes de criar objeto na Stripe ("agora").
 */
export type TerminalAction = "enter" | "retry" | "retry_delayed" | "reload" | null;

export function terminalCopy(id: TerminalId, displayName: string | null): { title: string; body: string; action: TerminalAction; actionLabel: string | null } {
  switch (id) {
    case "not_found":
      return { title: "Não encontramos este link", body: "Confira se o endereço chegou completo. Se veio por mensagem, copie de novo ou peça outro a quem enviou.", action: null, actionLabel: null };
    case "expired":
      return { title: "Esta proposta venceu", body: "O prazo do link terminou. Peça um link novo a quem enviou a proposta.", action: null, actionLabel: null };
    case "revoked":
      return { title: "Este link foi cancelado", body: "Se a negociação continua, peça o link atualizado a quem enviou a proposta.", action: null, actionLabel: null };
    case "already_paid":
      return { title: "Este link já foi pago", body: "Não há nada a pagar por aqui. Para consultar a assinatura, entre no Torque.", action: "enter", actionLabel: "Entrar no Torque" };
    case "not_supported":
      return { title: "Este link não pode ser pago aqui", body: "Peça um link novo a quem enviou a proposta.", action: null, actionLabel: null };
    case "org_subscribed":
      return { title: `${displayName ?? "Sua empresa"} já tem uma assinatura em andamento`, body: "Nada foi cobrado agora. Fale com quem enviou este link para ajustar a assinatura atual.", action: null, actionLabel: null };
    case "unavailable":
      return { title: "Pagamento indisponível no momento", body: "O problema é do nosso lado. Tente de novo em alguns minutos.", action: "retry", actionLabel: "Tentar de novo" };
    case "offline":
      return { title: "Pagamento indisponível no momento", body: "Não conseguimos conectar. Confira sua internet e tente de novo.", action: "retry", actionLabel: "Tentar de novo" };
    case "rate_limited":
      return { title: "Muitas tentativas em pouco tempo", body: "Por segurança, esta página pausou por alguns minutos.", action: "retry_delayed", actionLabel: "Tentar de novo" };
    case "resume_unknown":
      return { title: "Não conseguimos confirmar o pagamento", body: "A volta do banco não pôde ser conferida agora. Confira de novo antes de fazer outro pagamento.", action: "retry", actionLabel: "Tentar de novo" };
    case "stale_bundle":
      return { title: "Esta página foi atualizada", body: "Os termos da autorização mudaram desde que você abriu o link. Recarregue para ver a versão atual.", action: "reload", actionLabel: "Recarregar" };
  }
}
