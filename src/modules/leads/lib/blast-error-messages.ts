/**
 * Turns a blast refusal code into something a salesperson can act on.
 *
 * The backend answers with a machine code (`daily_budget_exhausted`,
 * `wa_reach_limit_reached`, …) and, until now, the dialog piped that string
 * straight into the toast — so hitting the daily ceiling showed the literal
 * text `daily_budget_exhausted`. Every refusal read like a crash.
 *
 * These messages say what happened AND what to do, because every one of them
 * is a wall the user can do something about: wait, use another number, or pick
 * fewer leads. A refusal the user cannot interpret becomes a support ticket.
 */
const BLAST_ERROR_MESSAGES: Record<string, string> = {
  daily_budget_exhausted:
    "Sua organização já atingiu o limite de disparos de hoje. O envio recomeça amanhã, ou você pode agendar em lotes.",
  instance_daily_cap_exhausted:
    "Este número já atingiu o limite de disparos de hoje. Use outro número conectado ou agende para amanhã.",
  wa_reach_limit_reached:
    "O WhatsApp atingiu o limite de novos contatos que este número pode alcançar agora. Aguarde algumas horas ou use outro número — insistir aumenta o risco de restrição.",
  no_recipients:
    "Nenhum lead selecionado tem telefone válido para disparo.",
  no_leads: "Selecione ao menos um lead para disparar.",
  empty_message: "Escreva a mensagem antes de disparar.",
  instance_org_mismatch:
    "Este número não pertence à sua organização. Recarregue a página e tente de novo.",
  blast_failed: "Não foi possível iniciar o disparo. Tente de novo em instantes.",
};

/**
 * Falls back to the raw text when the code is unknown — an unmapped code is
 * still more useful on screen than a generic "algo deu errado", and it makes
 * the gap visible instead of hiding it.
 */
export function blastErrorMessage(raw: string | undefined | null): string {
  if (!raw) return BLAST_ERROR_MESSAGES.blast_failed;
  return BLAST_ERROR_MESSAGES[raw] ?? raw;
}
