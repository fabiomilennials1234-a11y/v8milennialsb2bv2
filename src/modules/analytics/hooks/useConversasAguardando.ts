import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/modules/communication";

/**
 * Comando — "Clientes aguardando resposta".
 *
 * A fila é: o cliente falou e NENHUM humano respondeu depois. Resposta da IA
 * não tira da fila, só marca `aiReplied` — decisão de produto de 21/08, porque
 * em org com Copilot ligado o predicado do inbox (`p_waiting`, que é só
 * "a última mensagem é 'incoming'") esvaziaria o card justamente nas orgs mais
 * movimentadas.
 *
 * ⚠️ FAN-OUT POR CHIP, não uma query só. A RPC exige `p_instance` e o expande
 * para o chip (instância viva + apagadas do mesmo número). Ler
 * `whatsapp_conversation_summary` direto resolveria tudo numa query e está
 * PROIBIDO: a RLS daquela tabela não conhece `chat_restrict_to_owner`, que só
 * existe dentro da RPC — o cabeçalho da migration 20270819100000 conta que esse
 * exato descasamento já vazou o inbox inteiro uma vez.
 */

/** Uma conversa esperando resposta humana. */
export interface ConversaAguardando {
  /** Chave estável de lista: a tabela-resumo tem PK composta, não tem `id`. */
  key: string;
  phoneNumber: string;
  normalizedPhone: string;
  /** push_name do WhatsApp → nome do lead → o próprio número. */
  displayName: string;
  leadId: string | null;
  instanceId: string;
  instanceName: string;
  lastClientMessage: string | null;
  lastClientMessageAt: string;
  aiReplied: boolean;
  aiRepliedAt: string | null;
}

export interface ConversasAguardandoResult {
  items: ConversaAguardando[];
  /** Total antes do corte — alimenta o "e mais N". */
  total: number;
  isLoading: boolean;
  isError: boolean;
  /**
   * `true` quando a RPC nova ainda não está no banco e caímos no predicado
   * antigo do inbox. A lista fica mais CURTA (perde as que a IA respondeu),
   * nunca errada. A tela avisa em vez de mentir.
   */
  isDegraded: boolean;
}

interface AwaitingRow {
  phone_number: string | null;
  normalized_phone: string;
  push_name: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  last_client_message: string | null;
  last_client_message_at: string;
  ai_replied: boolean;
  ai_replied_at: string | null;
  waiting_total: number;
}

interface FallbackRow {
  phone_number: string;
  normalized_phone: string;
  push_name: string | null;
  last_message: string | null;
  last_message_time: string;
  lead_id: string | null;
}

interface PgLikeError {
  code?: string;
  message?: string;
}

interface InstanceQueryResult {
  rows: ConversaAguardando[];
  total: number;
  degraded: boolean;
}

/**
 * A função não existe neste banco ainda. PostgREST devolve PGRST202 quando não
 * acha a função no schema cache; o Postgres devolve 42883 quando a chamada
 * chega. Tratamos os dois como "ainda não migrado", não como falha.
 */
function isMissingFunctionError(error: unknown): boolean {
  const e = error as PgLikeError;
  if (e?.code === "PGRST202" || e?.code === "42883") return true;
  return /could not find the function|does not exist/i.test(e?.message ?? "");
}

/**
 * `supabase.rpc` é tipado pelo `types.ts` gerado a partir do PROD, e a função
 * nova ainda não está lá. `as unknown as` (e não `any`) mantém a chamada tipada
 * do nosso lado sem introduzir assinatura nova no typecheck:ratchet.
 */
type AwaitingRpc = (
  fn: "get_conversations_awaiting_human_reply",
  args: { p_org: string; p_instance: string; p_limit: number },
) => PromiseLike<{ data: AwaitingRow[] | null; error: PgLikeError | null }>;

async function nomesDeLead(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const { data, error } = await supabase
    .from("leads")
    .select("id, name")
    .in("id", ids);
  // Nome é acessório: a lista é o payload. Degradar aqui mostra o push_name ou
  // o número, que continua sendo informação útil — mas deixa rastro.
  if (error) {
    console.error("[comando] enriquecimento de nome de lead falhou", error);
    return mapa;
  }
  for (const linha of data ?? []) {
    if (linha.name) mapa.set(linha.id, linha.name);
  }
  return mapa;
}

async function buscarPorInstancia(
  organizationId: string,
  instanceId: string,
  instanceName: string,
  limit: number,
): Promise<InstanceQueryResult> {
  const chamarRpc = supabase.rpc as unknown as AwaitingRpc;
  const { data, error } = await chamarRpc(
    "get_conversations_awaiting_human_reply",
    { p_org: organizationId, p_instance: instanceId, p_limit: limit },
  );

  if (!error) {
    const linhas = data ?? [];
    const ids = [
      ...new Set(linhas.map((r) => r.lead_id).filter((id): id is string => !!id)),
    ];
    const nomes = await nomesDeLead(ids);
    return {
      total: linhas[0]?.waiting_total ?? 0,
      degraded: false,
      rows: linhas.map((r) => ({
        key: `${instanceId}:${r.normalized_phone}`,
        phoneNumber: r.phone_number ?? r.normalized_phone,
        normalizedPhone: r.normalized_phone,
        displayName:
          r.push_name ??
          (r.lead_id ? nomes.get(r.lead_id) : undefined) ??
          r.phone_number ??
          r.normalized_phone,
        leadId: r.lead_id,
        instanceId,
        instanceName,
        lastClientMessage: r.last_client_message,
        lastClientMessageAt: r.last_client_message_at,
        aiReplied: r.ai_replied,
        aiRepliedAt: r.ai_replied_at,
      })),
    };
  }

  if (!isMissingFunctionError(error)) throw error;

  // ── Degradado: a RPC nova ainda não foi aplicada neste banco ──────────────
  // O predicado antigo (`p_waiting`) só enxerga "a última mensagem é do
  // cliente", então perde as que a IA respondeu. Lista mais curta, nunca errada.
  // Os demais parâmetros são omitidos de propósito: a RPC os declara com
  // DEFAULT NULL. Passar `null` explícito não compila — o `types.ts` gerado os
  // tipa como `?: T | undefined`, não `| null`.
  const { data: fb, error: fbError } = await supabase.rpc(
    "get_whatsapp_conversation_list",
    {
      p_org: organizationId,
      p_instance: instanceId,
      p_limit: limit,
      p_waiting: true,
    },
  );
  if (fbError) throw fbError;

  const linhas = (fb ?? []) as unknown as FallbackRow[];
  const ids = [
    ...new Set(linhas.map((r) => r.lead_id).filter((id): id is string => !!id)),
  ];
  const nomes = await nomesDeLead(ids);

  return {
    total: linhas.length,
    degraded: true,
    rows: linhas.map((r) => ({
      key: `${instanceId}:${r.normalized_phone}`,
      phoneNumber: r.phone_number,
      normalizedPhone: r.normalized_phone,
      displayName:
        r.push_name ??
        (r.lead_id ? nomes.get(r.lead_id) : undefined) ??
        r.phone_number,
      leadId: r.lead_id,
      instanceId,
      instanceName,
      lastClientMessage: r.last_message,
      lastClientMessageAt: r.last_message_time,
      aiReplied: false,
      aiRepliedAt: null,
    })),
  };
}

/**
 * @param limite quantas conversas mostrar depois de juntar todos os chips.
 */
export function useConversasAguardando(limite = 10): ConversasAguardandoResult {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { data: instancias, isLoading: instLoading } =
    useWhatsAppInstancesForUser();

  const chips = instancias ?? [];

  return useQueries({
    queries: chips.map((chip) => ({
      queryKey: ["comando", "conversas-aguardando", organizationId, chip.id, limite],
      queryFn: () =>
        buscarPorInstancia(
          organizationId as string,
          chip.id,
          chip.instance_name,
          limite,
        ),
      enabled: !!organizationId,
      staleTime: 30_000,
    })),
    combine: (resultados): ConversasAguardandoResult => {
      const items = resultados
        .flatMap((r) => r.data?.rows ?? [])
        .sort(
          (a, b) =>
            new Date(b.lastClientMessageAt).getTime() -
            new Date(a.lastClientMessageAt).getTime(),
        )
        .slice(0, limite);

      return {
        items,
        total: resultados.reduce((soma, r) => soma + (r.data?.total ?? 0), 0),
        // Sem chip nenhum a lista está resolvida e vazia, não carregando.
        isLoading: instLoading || resultados.some((r) => r.isLoading),
        // Um chip que falha não apaga os outros; só marca erro quando TODOS
        // falharam (ou quando o único que existe falhou).
        isError:
          resultados.length > 0 && resultados.every((r) => r.isError),
        isDegraded: resultados.some((r) => r.data?.degraded === true),
      };
    },
  });
}
