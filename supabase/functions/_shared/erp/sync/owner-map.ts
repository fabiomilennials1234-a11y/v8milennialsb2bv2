/**
 * De-para entre o representante do ERP e o team member do Torque.
 *
 * 🔴 **Por que existe uma tabela, e não um `LIKE` por nome.** Medido na Café
 * Jurerê em 02/09: o ERP tem **216 representantes distintos** cobrindo 11.228
 * clientes; a org tem **8 team members**. Casar por nome erra de três formas,
 * todas observadas:
 *
 *   - **Ambiguidade** — "Fernanda" casa com `FERNANDA C.PRIOTTO` e com
 *     `FERNANDA LESSIR MACHADO`.
 *   - **Grafia** — "Isabelli" (Torque) contra `ISABELLE FERRERA RAMOS` (ERP),
 *     que sozinha responde por 1.186 clientes.
 *   - **Nem todo representante é pessoa** — `TORREFAÇÃO`,
 *     `TORREFACAO-CAROLINI`, `TORREFAÇÃO-FRANCIELLE` e outros três são canais,
 *     e cobrem 3.525 clientes (31%).
 *
 * A chave é o `codigoRepresentante`, estável e sem ambiguidade. Quem preenche é
 * um humano, pela tela de admin.
 *
 * ⚠️ **Silêncio nunca vira palpite.** Código sem linha no mapa devolve
 * `undefined`, e o chamador NÃO toca em `responsible_id` — diferente de linha
 * com `team_member_id` nulo, que devolve `null` e limpa o dono de propósito
 * (é como um canal é registrado). A distinção existe porque atribuir dono muda
 * quem enxerga o lead no Torque, e mudança de visibilidade por engano é cara.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * `codigoRepresentante` → team member.
 *
 * Ausente = não mapeado (não mexer). Presente com `null` = sem dono por decisão.
 */
export type OwnerMap = Map<string, string | null>;

/**
 * Carrega o mapa inteiro da org uma vez por execução.
 *
 * São 216 linhas no maior caso conhecido — resolver cliente a cliente custaria
 * 11 mil consultas para ler algo que cabe folgado na memória do isolate.
 */
export async function loadOwnerMap(
  admin: SupabaseClient,
  organizationId: string,
  provider: string,
): Promise<OwnerMap> {
  const { data, error } = await admin
    .from("erp_owner_map")
    .select("erp_owner_external_id, team_member_id")
    .eq("organization_id", organizationId)
    .eq("provider", provider);

  if (error) throw new Error(`loadOwnerMap: ${error.message}`);

  const mapa: OwnerMap = new Map();
  for (const linha of data ?? []) {
    const codigo = String((linha as { erp_owner_external_id?: unknown }).erp_owner_external_id ?? "")
      .trim();
    if (!codigo) continue;
    const tm = (linha as { team_member_id?: unknown }).team_member_id;
    mapa.set(codigo, typeof tm === "string" && tm ? tm : null);
  }
  return mapa;
}

/**
 * Responsável para este código, no vocabulário de "não mexer" vs "limpar".
 *
 * Devolve `undefined` quando não há decisão registrada — e `undefined` some do
 * objeto de escrita em `clientEnrichmentColumns`, que é exatamente o
 * comportamento desejado: mapa vazio deixa a base como está.
 */
export function resolveResponsible(
  mapa: OwnerMap | undefined,
  ownerExternalId: string | null | undefined,
): string | null | undefined {
  if (!mapa || mapa.size === 0) return undefined;
  const codigo = String(ownerExternalId ?? "").trim();
  if (!codigo) return undefined;
  return mapa.has(codigo) ? mapa.get(codigo) : undefined;
}
