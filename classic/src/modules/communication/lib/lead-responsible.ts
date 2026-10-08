/**
 * Quem pode ser gravado como responsável de um lead. PURO.
 *
 * ─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * `useCurrentTeamMember` devolve a master e a gestor de portfólio um membro
 * VIRTUAL, com id `master-virtual-<uuid>` / `gestor-virtual-<uuid>`. O próprio
 * módulo declara que ele "NUNCA é persistido em FK" (ADR-0021) — não é sequer um
 * uuid.
 *
 * A criação de lead pelo chat gravava esse id em `responsible_id`/`sdr_id`. O
 * banco recusa, a mutation rejeita, e como ninguém tratava o erro o botão "Criar
 * Lead" simplesmente NÃO FAZIA NADA. Medido em produção com um master em shadow
 * na Chique, 2026-08-19.
 */
import { isVirtualTeamMember } from "@/modules/identity";

/**
 * O responsável a gravar: o escolhido na tela ganha; senão o ator, se for
 * persistível; senão ninguém.
 *
 * `null` é desfecho legítimo. Lead sem responsável é melhor que lead com
 * responsável inexistente — ele existe, aparece no funil, e alguém o assume. A
 * alternativa (recusar a criação) tiraria do master exatamente a operação que ele
 * foi fazer na org do cliente.
 */
export function responsavelParaGravar(
  atorTeamMemberId: string | null | undefined,
  responsavelEscolhido?: string | null,
): string | null {
  const escolhido = responsavelEscolhido?.trim();
  if (escolhido) return escolhido;
  if (isVirtualTeamMember(atorTeamMemberId)) return null;
  return atorTeamMemberId ?? null;
}
