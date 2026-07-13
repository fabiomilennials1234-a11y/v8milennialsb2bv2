/**
 * gate-decision — lógica pura de decisão dos gates de entrada do agent-message
 * quando o inbound NÃO vai gerar resposta (sem agente ativo OU audience gate
 * bloqueou telefone desconhecido).
 *
 * A flag org `auto_create_lead_on_inbound` é ADITIVA: com ela OFF (default de
 * TODAS as orgs) o comportamento é byte-a-byte o de hoje — o gate retorna
 * `skipped` SEM criar lead. Com ela ON, o mesmo early-return acontece (a IA não
 * responde NESTE turno), mas o lead é materializado antes de sair.
 *
 * Extraída como função pura pra ser testável isolada dos side-effects
 * (lock, getOrCreateLead, Response) que vivem inline no index.ts.
 */

/** Gate que produziu a decisão. Só afeta o `reason` retornado. */
export type InboundGate = "no_active_agents" | "audience_blocked";

export interface GateDecision {
  /** Se true, o index.ts deve chamar getOrCreateLead antes do early-return. */
  createLead: boolean;
  /** `reason` do corpo JSON do Response 200 (skipped). */
  reason: string;
}

/**
 * Decide o que fazer quando um gate barraria o turno (sem resposta a gerar).
 *
 * Retrocompat (autoCreateLead=false): mantém EXATAMENTE os reasons legados
 *   - no_active_agents  → { createLead:false, reason:"no_active_agents" }
 *   - audience_blocked  → { createLead:false, reason:"unknown_phone_blocked" }
 *
 * Flag ON (autoCreateLead=true): cria o lead e reporta um reason distinto
 *   - no_active_agents  → { createLead:true,  reason:"lead_created_no_ai" }
 *   - audience_blocked  → { createLead:true,  reason:"lead_created_ai_blocked" }
 *
 * Em ambos os casos o turno termina em early-return 200 (skipped): a flag não
 * faz a IA responder NO TURNO que cria o lead. A partir do lead existir, o
 * atendimento segue o fluxo normal (o audience-gate deixa de barrar os próximos
 * inbounds do mesmo número via short-circuit de existingLead).
 */
export function decideBlockedInboundAction(
  gate: InboundGate,
  autoCreateLead: boolean,
): GateDecision {
  if (autoCreateLead) {
    return {
      createLead: true,
      reason: gate === "no_active_agents" ? "lead_created_no_ai" : "lead_created_ai_blocked",
    };
  }
  return {
    createLead: false,
    reason: gate === "no_active_agents" ? "no_active_agents" : "unknown_phone_blocked",
  };
}
