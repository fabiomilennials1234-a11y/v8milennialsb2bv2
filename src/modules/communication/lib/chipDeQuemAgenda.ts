import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Chip de QUEM AGENDA, para gravar no agendamento (flag
 * `agendamento_chip_do_criador`, Café Jurerê).
 *
 * O card do lead, o detalhe do lead e a Revisão agendam sem chip. Sem chip
 * gravado, a linha não aparece na bandeja da conversa (que filtra por
 * `whatsapp_instance_id`) e o worker tem que adivinhar na hora do envio.
 *
 * Mesma regra de `resolverChipDoCriador` em
 * `supabase/functions/process-scheduled-user-messages/index.ts` — mudou uma,
 * mude a outra:
 *  - chips de quem agenda = os que ele atende (`whatsapp_instance_allowed_members`)
 *    + o preferido (`team_members.preferred_whatsapp_instance_id`);
 *  - só elegíveis: mesma org, conectado, uazapi/evolution, não reservado;
 *  - com mais de um: o dele em que a conversa com o cliente é mais recente;
 *    senão o preferido; senão o primeiro.
 * Sem chip elegível devolve `null`: a linha nasce sem chip e o worker decide.
 */

const PROVIDERS_LEGADOS = ["uazapi", "evolution"];
const STATUS_CONECTADO = ["connected", "open"];

export async function resolverChipDeQuemAgenda(
  client: SupabaseClient,
  params: {
    organizationId: string;
    teamMemberId: string;
    leadId: string | null;
    phoneNumber: string;
  },
): Promise<string | null> {
  const [{ data: vinculos }, { data: membro }] = await Promise.all([
    client
      .from("whatsapp_instance_allowed_members")
      .select("whatsapp_instance_id")
      .eq("team_member_id", params.teamMemberId),
    client
      .from("team_members")
      .select("preferred_whatsapp_instance_id")
      .eq("id", params.teamMemberId)
      .eq("organization_id", params.organizationId)
      .maybeSingle(),
  ]);

  const preferido: string | null =
    (membro as { preferred_whatsapp_instance_id?: string | null } | null)?.preferred_whatsapp_instance_id ?? null;
  const ids = new Set<string>();
  for (const v of (vinculos ?? []) as Array<{ whatsapp_instance_id?: string | null }>) {
    if (v.whatsapp_instance_id) ids.add(v.whatsapp_instance_id);
  }
  if (preferido) ids.add(preferido);
  if (ids.size === 0) return null;

  const { data: instancias } = await client
    .from("whatsapp_instances")
    .select("id")
    .eq("organization_id", params.organizationId)
    .in("id", [...ids])
    .in("provider", PROVIDERS_LEGADOS)
    .in("status", STATUS_CONECTADO)
    .is("reserved_for", null);
  const elegiveis = ((instancias ?? []) as Array<{ id: string }>)
    .map((i) => i.id)
    .sort((a, b) => a.localeCompare(b));
  if (elegiveis.length === 0) return null;
  if (elegiveis.length === 1) return elegiveis[0];

  const maisRecente = async (
    filtrar: (q: ReturnType<typeof baseConversa>) => ReturnType<typeof baseConversa>,
  ): Promise<string | null> => {
    const { data } = await filtrar(baseConversa())
      .order("timestamp", { ascending: false })
      .limit(1);
    const id = (data as Array<{ instance_id?: string | null }> | null)?.[0]?.instance_id;
    return id && elegiveis.includes(id) ? id : null;
  };
  function baseConversa() {
    return client
      .from("whatsapp_messages")
      .select("instance_id")
      .eq("organization_id", params.organizationId)
      .in("instance_id", elegiveis);
  }

  if (params.leadId) {
    const porLead = await maisRecente((q) => q.eq("lead_id", params.leadId as string));
    if (porLead) return porLead;
  }
  const digitos = params.phoneNumber.replace(/\D/g, "");
  if (digitos.length >= 8) {
    const porTelefone = await maisRecente((q) => q.ilike("phone_number", `%${digitos.slice(-8)}%`));
    if (porTelefone) return porTelefone;
  }

  return preferido && elegiveis.includes(preferido) ? preferido : elegiveis[0];
}
