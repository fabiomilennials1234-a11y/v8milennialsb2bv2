/**
 * `computeChatDeepLinkPlan` — traduz os query params de entrada do chat no que
 * a tela precisa fazer antes de abrir uma conversa.
 *
 * Existe porque `?lead=` era produzido por três call sites da carteira e lido
 * por nenhum. Um parâmetro sem consumidor não dá erro: a tela abre vazia e o
 * usuário conclui que a conversa sumiu. Concentrar a leitura aqui deixa o
 * conjunto de params suportados visível num lugar só.
 *
 * `instance` e `box` acompanham qualquer plano, inclusive `none` — os dois
 * pré-selecionam a caixa e valem mesmo quando não há conversa alvo.
 */

export interface ComputeChatDeepLinkPlanArgs {
  /** Valor de `?phone=` na URL. */
  phone: string | null;
  /** Valor de `?instance=` na URL (WhatsApp). */
  instance: string | null;
  /** Valor de `?box=` na URL (caixa, WhatsApp ou canal social). */
  box: string | null;
  /** Valor de `?lead=` na URL. */
  lead: string | null;
}

interface PlanBase {
  instance: string | null;
  box: string | null;
}

export type ChatDeepLinkPlan =
  | ({ kind: "none" } & PlanBase)
  | ({ kind: "phone"; phone: string } & PlanBase)
  | ({ kind: "lead"; leadId: string } & PlanBase);

export function computeChatDeepLinkPlan({
  phone,
  instance,
  box,
  lead,
}: ComputeChatDeepLinkPlanArgs): ChatDeepLinkPlan {
  // `phone` vence: é o alvo direto, e dispensa a consulta que o `lead` exige.
  if (phone) return { kind: "phone", phone, instance, box };
  if (lead) return { kind: "lead", leadId: lead, instance, box };
  return { kind: "none", instance, box };
}
