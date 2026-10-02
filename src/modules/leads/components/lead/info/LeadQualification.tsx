/**
 * LeadQualification — slot da qualificação na ficha aberta pelo chat.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C3). O input de `rating` saiu em
 * 2026-09-03 com a remoção do calor da interface.
 *
 * O "Score IA: N%" (`qualification_score`) saiu em 2026-10-01 — decisão do CTO:
 * o score do lead não é mais usado. Ficam só qualificação e pré-qualificação
 * (os tiers), que esta ficha não desenhava aqui. O componente segue exportado e
 * com a mesma assinatura porque `LeadTabInfo` o monta e testes o dublam; os
 * hooks e exports de score (`useLeadScore`…) continuam intocados — outros
 * pontos do produto ainda os importam.
 */

interface LeadQualificationProps {
  /** Mantido por compatibilidade de assinatura; não é mais exibido. */
  qualificationScore?: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LeadQualification(_props: LeadQualificationProps) {
  return null;
}
