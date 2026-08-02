/**
 * Query canônica das ligações de UMA conversa do chat.
 *
 * ── Por que `call_logs` e não `voip_calls` ──
 * `voip_calls` é o estado cru do plano de voz (`status`, `end_reason`,
 * `connected_at`). Derivar "atendeu / não atendeu / quanto durou" a partir dele
 * no navegador seria uma SEGUNDA implementação da regra que
 * `fn_voip_project_call_log` já aplica no banco — duas cópias que divergem no
 * primeiro `end_reason` novo que o VPS inventar.
 *
 * `call_logs` é a camada já projetada: traz `outcome` e `duration_seconds`
 * prontos. E, decisivo, é a única das duas que enxerga a ligação REGISTRADA À
 * MÃO (`LogCallModal`) — `voip_calls` só conhece chamada que passou pelo
 * TorqueCalls. Quem abre a conversa pergunta "o que aconteceu com esse lead",
 * e a ligação anotada pelo vendedor faz parte da resposta.
 *
 * Bônus: `call_logs` existe em `src/integrations/supabase/types.ts`;
 * `voip_calls` NÃO (nenhuma das duas tabelas de voz foi regerada), então lê-la
 * exigiria `(supabase.from as any)`.
 *
 * ── Como a ligação encontra a conversa ──
 * A conversa do chat é identificada por TELEFONE NORMALIZADO, não por lead:
 * medido em produção (2026-08-02), 1.790.210 de 2.117.873 linhas de
 * `whatsapp_messages` (84,5%) têm `lead_id` NULO, enquanto `normalized_phone`
 * está 100% populado. Casar só por `lead_id` perderia a maioria das conversas.
 *
 * O telefone casa porque os dois lados usam o mesmo formato — DDD + 9 dígitos,
 * só números. Medido em prod: `voip_calls.peer_phone = '48996458738'` e
 * `whatsapp_messages.normalized_phone = '48996458738'`. A projeção do #1352
 * grava `call_logs.phone_number := voip_calls.peer_phone`, então o formato se
 * mantém. (`leads.phone` NÃO serve de chave: a mesma base guarda
 * `'+55 48 9189-2653'`, `'+554899053409'` e `'554891470458'`.)
 *
 * Mesmo assim o `lead_id` entra como SEGUNDA identidade, em OU: a ligação
 * registrada à mão nasce com lead e pode ter `phone_number` nulo — é
 * exatamente o caso da única linha de `call_logs` que existe hoje em prod.
 *
 * ── Janela ──
 * Sem `.limit()`, de propósito. A query de mensagens
 * (`whatsappMessagesQuery.ts`) também não tem: ela carrega a thread inteira num
 * único fetch, sem paginação. Dar às ligações QUALQUER recorte diferente do
 * das mensagens abriria buraco (ligação sem a mensagem vizinha) ou duplicata na
 * rolagem. As duas fontes cobrem a conversa inteira, então o merge cronológico
 * é exato e não tem fronteira onde errar. Se um dia a thread virar paginada,
 * este comentário é o aviso: as duas janelas têm que passar a andar juntas.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";

/**
 * Colunas que a peça da conversa desenha. Deliberadamente SEM `notes` e
 * `recording_url`: a anotação comercial do vendedor não vai para o corpo da
 * thread, e o áudio não é reproduzido aqui.
 */
export const CONVERSATION_CALL_COLUMNS =
  "id, lead_id, direction, outcome, duration_seconds, phone_number, started_at";

export interface ConversationCall {
  id: string;
  lead_id: string | null;
  /** `inbound` | `outbound` — CHECK no banco. */
  direction: string;
  /**
   * Vocabulário do CHECK de `call_logs` (9 valores após a fundação TorqueCalls).
   * Fica como `string` de propósito: o rótulo é resolvido por consulta a
   * `OUTCOME_LABELS`, com fallback, então um valor novo no banco degrada em vez
   * de quebrar a thread.
   */
  outcome: string;
  duration_seconds: number | null;
  phone_number: string | null;
  started_at: string;
}

export interface FetchConversationCallsParams {
  organizationId: string;
  /** Telefone da conversa, em qualquer formato — normalizado antes do filtro. */
  phoneNumber: string | null;
  /** Lead resolvido da conversa, quando existe. Segunda identidade. */
  leadId?: string | null;
}

/** Só aceita UUID canônico — o valor entra numa expressão `.or()` do PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchConversationCalls({
  organizationId,
  phoneNumber,
  leadId,
}: FetchConversationCallsParams): Promise<ConversationCall[]> {
  const normalized = normalizePhone(phoneNumber);

  // `normalized` é dígito puro (normalizePhone descarta o resto) e `leadId` é
  // validado como UUID — nenhum dos dois pode injetar vírgula ou parêntese e
  // reescrever o filtro do PostgREST.
  const identities: string[] = [];
  if (normalized) identities.push(`phone_number.eq.${normalized}`);
  if (leadId && UUID_RE.test(leadId)) identities.push(`lead_id.eq.${leadId}`);

  if (identities.length === 0) return [];

  const { data, error } = await supabase
    .from("call_logs")
    .select(CONVERSATION_CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .or(identities.join(","))
    .order("started_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ConversationCall[];
}

/** Uma ligação só "aconteceu" de verdade quando foi atendida. */
export function isCallConnected(outcome: string): boolean {
  return outcome === "connected";
}

/**
 * Duração legível. Devolve `null` quando não há duração a mostrar — chamada não
 * atendida tem `duration_seconds` nulo, e "0s" seria ruído com cara de dado.
 */
export function formatCallDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;

  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return m > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}min ${s}s` : `${m}min`;
  return `${s}s`;
}
