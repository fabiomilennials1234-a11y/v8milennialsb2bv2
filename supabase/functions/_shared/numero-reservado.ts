/**
 * Setor dono de um número de WhatsApp (`whatsapp_instances.reserved_for`).
 *
 * Hoje só existe `'collections'` — o número da cobrança (ADR-0040). Mensagem que
 * CHEGA nele não pode acionar copilot nem resolver espera de workflow comercial:
 * o devedor conversa com gente da cobrança, e a resposta dele não é lead. O
 * banco já impede o vínculo com lead (gatilho `trg_resolve_message_lead_id_zz_cobranca`);
 * isto aqui fecha a reação na edge.
 *
 * Cache por isolate (60 s): o webhook recebe milhares de mensagens por hora, e a
 * reserva muda raramente. Uma consulta por número por minuto basta.
 *
 * Fail-open: erro de leitura (coluna ainda não migrada, rede) devolve `null` —
 * um soluço do banco não pode silenciar o copilot da plataforma inteira. O
 * isolamento de lead continua garantido pelo gatilho no banco.
 */
// deno-lint-ignore no-explicit-any
type Cliente = any;

const TTL_MS = 60_000;
const cache = new Map<string, { setor: string | null; ate: number }>();

export async function setorDoNumero(supabase: Cliente, instanceId: string | null | undefined): Promise<string | null> {
  if (!instanceId) return null;
  const agora = Date.now();
  const hit = cache.get(instanceId);
  if (hit && hit.ate > agora) return hit.setor;
  try {
    const { data, error } = await supabase
      .from("whatsapp_instances")
      .select("reserved_for")
      .eq("id", instanceId)
      .maybeSingle();
    if (error) return null;
    const setor = (data?.reserved_for as string | null | undefined) ?? null;
    cache.set(instanceId, { setor, ate: agora + TTL_MS });
    return setor;
  } catch {
    return null;
  }
}

/** Só para teste: o cache é por isolate. */
export function limparCacheDoSetor(): void {
  cache.clear();
}
