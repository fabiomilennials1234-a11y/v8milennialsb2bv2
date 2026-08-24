import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/modules/communication";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import {
  linhaVisivel,
  type ComandoEscopo,
} from "@/modules/analytics/lib/comando-escopo";

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
 *
 * ─── Escopo por usuário (2026-08-24) ────────────────────────────────────────
 *
 * 🔒 **Quem recorta é o BANCO, e não há parâmetro aqui para isso.** A RPC
 * decide sozinha, por `is_org_admin(p_org)`: admin e master recebem a fila da
 * org, todo o resto recebe só o que é dele ou não é de ninguém. Não passamos
 * escopo justamente para que não exista nada no payload que um cliente possa
 * trocar — ver o cabeçalho de `20270825000010`.
 *
 * A lista de argumentos da RPC NÃO mudou, só o RETURNS ganhou
 * `owner_team_member_id`/`owner_name`. Por isso este hook funciona contra
 * banco com e sem a migration: sem ela, as colunas chegam `undefined` e o card
 * apenas não mostra o dono. Nenhum `PGRST202`, nenhuma ordem de deploy.
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
  /**
   * Responsável pela conversa, derivado do LEAD (conversa não tem dono
   * próprio). `null` quando ninguém responde por ela — o que é 40% da fila,
   * medido no PROD. Só o admin vê isso na tela.
   */
  ownerTeamMemberId: string | null;
  ownerName: string | null;
}

export interface ConversasAguardandoResult {
  items: ConversaAguardando[];
  /** Total antes do corte — alimenta o "e mais N". Já vem recortado pela RPC. */
  total: number;
  isLoading: boolean;
  isError: boolean;
  /**
   * `true` quando a RPC nova ainda não está no banco e caímos no predicado
   * antigo do inbox. A lista fica mais CURTA (perde as que a IA respondeu),
   * nunca errada. A tela avisa em vez de mentir.
   */
  isDegraded: boolean;
  /** Repassado para o card decidir se mostra a coluna de responsável. */
  isAdmin: boolean;
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
  /** Ausentes em banco sem a migration 20270825000010 — daí o opcional. */
  owner_team_member_id?: string | null;
  owner_name?: string | null;
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

/** Nome + responsável de um lead, para o caminho degradado. */
interface DadosDeLead {
  nome: string | null;
  ownerId: string | null;
  ownerNome: string | null;
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
 * `supabase.rpc` é tipado pelo `types.ts` gerado a partir do PROD, e as colunas
 * novas ainda não estão lá. `as unknown as` (e não `any`) mantém a chamada
 * tipada do nosso lado sem introduzir assinatura nova no typecheck:ratchet.
 */
type AwaitingRpc = (
  fn: "get_conversations_awaiting_human_reply",
  args: { p_org: string; p_instance: string; p_limit: number },
) => PromiseLike<{ data: AwaitingRow[] | null; error: PgLikeError | null }>;

/**
 * Nome e responsável dos leads citados na lista.
 *
 * ⚠️ A ordem do COALESCE é a MESMA do predicado de isolamento da RPC
 * (`pre_sale → sale → sdr → closer`). Duas ordens diferentes produziriam um
 * card que mostra "Ana" numa conversa que some da lista da Ana.
 */
async function dadosDeLead(ids: string[]): Promise<Map<string, DadosDeLead>> {
  const mapa = new Map<string, DadosDeLead>();
  if (ids.length === 0) return mapa;
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, name, pre_sale_responsible_id, sale_responsible_id, sdr_id, closer_id",
    )
    .in("id", ids);
  // Nome é acessório: a lista é o payload. Degradar aqui mostra o push_name ou
  // o número, que continua sendo informação útil — mas deixa rastro.
  if (error) {
    console.error("[comando] enriquecimento de nome de lead falhou", error);
    return mapa;
  }
  for (const linha of data ?? []) {
    mapa.set(linha.id, {
      nome: linha.name ?? null,
      ownerId:
        linha.pre_sale_responsible_id ??
        linha.sale_responsible_id ??
        linha.sdr_id ??
        linha.closer_id ??
        null,
      ownerNome: null,
    });
  }
  return mapa;
}

async function buscarPorInstancia(
  organizationId: string,
  instanceId: string,
  instanceName: string,
  limit: number,
  escopo: ComandoEscopo,
  meuTeamMemberId: string | null,
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
    const leads = await dadosDeLead(ids);
    return {
      total: linhas[0]?.waiting_total ?? 0,
      degraded: false,
      rows: linhas.map((r) => ({
        key: `${instanceId}:${r.normalized_phone}`,
        phoneNumber: r.phone_number ?? r.normalized_phone,
        normalizedPhone: r.normalized_phone,
        displayName:
          r.push_name ??
          (r.lead_id ? leads.get(r.lead_id)?.nome ?? undefined : undefined) ??
          r.phone_number ??
          r.normalized_phone,
        leadId: r.lead_id,
        instanceId,
        instanceName,
        lastClientMessage: r.last_client_message,
        lastClientMessageAt: r.last_client_message_at,
        aiReplied: r.ai_replied,
        aiRepliedAt: r.ai_replied_at,
        // A RPC é a fonte; o fallback pelo lead só cobre banco sem a migration.
        ownerTeamMemberId:
          r.owner_team_member_id ??
          (r.lead_id ? leads.get(r.lead_id)?.ownerId ?? null : null),
        ownerName: r.owner_name ?? null,
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
  const leads = await dadosDeLead(ids);

  const mapeadas = linhas.map((r) => ({
    key: `${instanceId}:${r.normalized_phone}`,
    phoneNumber: r.phone_number,
    normalizedPhone: r.normalized_phone,
    displayName:
      r.push_name ??
      (r.lead_id ? leads.get(r.lead_id)?.nome ?? undefined : undefined) ??
      r.phone_number,
    leadId: r.lead_id,
    instanceId,
    instanceName,
    lastClientMessage: r.last_message,
    lastClientMessageAt: r.last_message_time,
    aiReplied: false,
    aiRepliedAt: null,
    ownerTeamMemberId: r.lead_id ? leads.get(r.lead_id)?.ownerId ?? null : null,
    ownerName: null,
  }));

  // ⚠️ Esta é a ÚNICA vez que o recorte acontece no cliente, e só porque a RPC
  // velha não sabe recortar. Não é a barreira — é o remendo para o card não
  // mostrar a fila da org inteira num banco em drift. Assim que a migration
  // 20270825000010 estiver aplicada este ramo morre.
  const recortadas = mapeadas.filter((c) =>
    linhaVisivel(c.ownerTeamMemberId, meuTeamMemberId, escopo),
  );

  return { total: recortadas.length, degraded: true, rows: recortadas };
}

/**
 * @param limite quantas conversas mostrar depois de juntar todos os chips.
 */
export function useConversasAguardando(limite = 10): ConversasAguardandoResult {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { data: instancias, isLoading: instLoading } =
    useWhatsAppInstancesForUser();
  const { escopo, isAdmin, meuTeamMemberId, isReady } = useComandoScope();

  const chips = instancias ?? [];

  return useQueries({
    queries: chips.map((chip) => ({
      // `escopo` entra na chave: admin e vendedor não podem compartilhar cache,
      // senão um troca-troca de conta serve a lista errada.
      queryKey: [
        "comando",
        "conversas-aguardando",
        organizationId,
        chip.id,
        limite,
        escopo,
      ],
      queryFn: () =>
        buscarPorInstancia(
          organizationId as string,
          chip.id,
          chip.instance_name,
          limite,
          escopo,
          meuTeamMemberId,
        ),
      // Espera a identidade resolver. Sem isso o primeiro fetch sairia com
      // `escopo: "meu"` para um admin, e o resultado errado ficaria em cache
      // sob uma chave que nunca mais é pedida.
      enabled: !!organizationId && isReady,
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
        isAdmin,
      };
    },
  });
}
