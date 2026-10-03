import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reportError, toAppError } from "@/shared/errors";
import { useCurrentTeamMember } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/modules/communication";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { filaComLead } from "@/modules/analytics/lib/comando-proximos-passos";
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
 * ─── UMA CHAMADA PARA TODAS AS CAIXAS (incidente 2026-10-02) ─────────────────
 *
 * Até 2026-10-02 este hook fazia FAN-OUT POR CHIP (`useQueries`): uma RPC
 * `get_conversations_awaiting_human_reply` por caixa. Na Alamaster (57 caixas)
 * eram 57 chamadas por abertura do Comando, cada uma medida em 12,4 s no
 * auto_explain — e o banco caiu no pico das 12:46 UTC. Agora é UMA chamada a
 * `get_conversations_awaiting_human_reply_multi`, que expande os chips no
 * servidor (mesma partição da lista multi do /chat), devolve `instance_id` por
 * linha e aplica o LIMIT sobre a união. Medido em prod: 57 caixas em 176 ms.
 *
 * Janela de 7 dias (default da RPC; era 30). Decisão delegada pelo CTO: o card
 * mostra o topo mais recente; o que encolhe é só o "e mais N".
 *
 * Ler `whatsapp_conversation_summary` direto continua PROIBIDO: a RLS daquela
 * tabela não conhece `chat_restrict_to_owner`, que só existe dentro da RPC — o
 * cabeçalho da migration 20270819100000 conta que esse descasamento já vazou o
 * inbox inteiro uma vez.
 *
 * Expand/contract: se a RPC multi ainda não estiver no banco (front sobe antes
 * da migration — PostgREST responde PGRST202), cai na RPC por chip, o
 * comportamento antigo, e relata ao Sentry. SÓ PGRST202: qualquer outro erro da
 * multi é defeito dela e sobe como erro do card, nunca vira fan-out silencioso.
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
   * A org não tem NENHUM número de WhatsApp ao alcance deste usuário.
   *
   * Sem isto o card concluía "ninguém esperando" a partir de zero query — que é
   * a frase mais perigosa desta tela, porque afirma que a fila está limpa
   * quando na verdade nunca foi perguntada.
   */
  semChips: boolean;
  /**
   * Quantos chips falharam quando pelo menos um respondeu. A lista fica curta,
   * e sem este número ela ficaria curta EM SILÊNCIO.
   */
  chipsComErro: number;
  /** Força releitura de todos os chips. */
  refetch: () => void;
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
  /** Só na RPC multi: a CAIXA da linha (nunca um uuid histórico do chip). */
  instance_id?: string;
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

/** O resultado da fila inteira — uma chamada, todas as caixas. */
interface FilaResult extends InstanceQueryResult {
  /** Caixas que falharam no caminho por chip. Na RPC multi é sempre 0. */
  chipsComErro: number;
}

/** O que o hook sabe de cada caixa: só o nome, para rotular a linha. */
interface ChipRef {
  id: string;
  instance_name: string;
}

/** Nome + responsável de um lead, para o caminho degradado. */
interface DadosDeLead {
  nome: string | null;
  ownerId: string | null;
  ownerNome: string | null;
}

/**
 * A RPC multi NÃO está no schema cache do PostgREST — e só isso.
 *
 * Deliberadamente MAIS ESTREITO que `isMissingFunctionError`: `42883` também é
 * erro de RUNTIME (um helper chamado com assinatura errada dentro do corpo), e a
 * regex `does not exist` casa `42703` (coluna) e relation. Qualquer um desses
 * vindo da multi é DEFEITO dela, e cair no fan-out por chip esconderia o defeito
 * atrás de N × 12 s de banco — o padrão exato do crash de 2026-10-02. Só a
 * ausência declarada da função (PGRST202) autoriza o caminho antigo; o resto
 * sobe e o card mostra erro.
 */
function isMultiAusenteDoSchema(error: unknown): boolean {
  return (error as PgLikeError | null)?.code === "PGRST202";
}

/**
 * Caminho por chip (fan-out antigo), alcançável só depois que a multi já caiu
 * por PGRST202: a RPC por instância não existe neste banco. PostgREST devolve
 * PGRST202 quando não acha a função no schema cache; o Postgres devolve 42883
 * quando a chamada chega. Aqui os dois significam "ainda não migrado".
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

type AwaitingMultiRpc = (
  fn: "get_conversations_awaiting_human_reply_multi",
  args: { p_org: string; p_instances: string[]; p_limit: number },
) => PromiseLike<{ data: AwaitingRow[] | null; error: PgLikeError | null }>;

/**
 * Nome e responsável dos leads citados na lista.
 *
 * ⚠️ A ordem do COALESCE é a MESMA do predicado de isolamento da RPC
 * (`pre_sale → sale → sdr → closer`). Duas ordens diferentes produziriam um
 * card que mostra "Ana" numa conversa que some da lista da Ana.
 */
async function dadosDeLead(ids: string[], organizationId: string): Promise<Map<string, DadosDeLead>> {
  const mapa = new Map<string, DadosDeLead>();
  if (ids.length === 0) return mapa;
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, name, pre_sale_responsible_id, sale_responsible_id, sdr_id, closer_id",
    )
    .in("id", ids)
    .eq("organization_id", organizationId);
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

/**
 * Linhas da RPC → `ConversaAguardando`. Uma implementação só para a RPC multi e
 * para a por chip: as duas devolvem a mesma linha, a multi só acrescenta
 * `instance_id`. `caixaDe` diz de qual caixa a linha é.
 */
async function mapearLinhas(
  linhas: AwaitingRow[],
  organizationId: string,
  caixaDe: (linha: AwaitingRow) => { id: string; nome: string },
): Promise<{ rows: ConversaAguardando[]; total: number }> {
  // A RPC já resolve nome de perfil e responsável. Só buscamos o lead
  // quando algum fallback será usado.
  // Preservar null e undefined: ambos acionam os fallbacks abaixo, inclusive
  // em bancos sem as colunas de responsável. String vazia não é null.
  const ids = [
    ...new Set(linhas
      .filter((r) => r.push_name == null || r.owner_team_member_id == null)
      .map((r) => r.lead_id)
      .filter((id): id is string => !!id)),
  ];
  const leads = await dadosDeLead(ids, organizationId);
  return {
    total: linhas[0]?.waiting_total ?? 0,
    rows: linhas.map((r) => {
      const caixa = caixaDe(r);
      return {
        key: `${caixa.id}:${r.normalized_phone}`,
        phoneNumber: r.phone_number ?? r.normalized_phone,
        normalizedPhone: r.normalized_phone,
        displayName:
          r.push_name ??
          (r.lead_id ? leads.get(r.lead_id)?.nome ?? undefined : undefined) ??
          r.phone_number ??
          r.normalized_phone,
        leadId: r.lead_id,
        instanceId: caixa.id,
        instanceName: caixa.nome,
        lastClientMessage: r.last_client_message,
        lastClientMessageAt: r.last_client_message_at,
        aiReplied: r.ai_replied,
        aiRepliedAt: r.ai_replied_at,
        // A RPC é a fonte; o fallback pelo lead só cobre banco sem a migration.
        ownerTeamMemberId:
          r.owner_team_member_id ??
          (r.lead_id ? leads.get(r.lead_id)?.ownerId ?? null : null),
        ownerName: r.owner_name ?? null,
      };
    }),
  };
}

async function buscarPorInstancia(
  organizationId: string,
  instanceId: string,
  instanceName: string,
  limit: number,
  escopo: ComandoEscopo,
  meuTeamMemberId: string | null,
): Promise<InstanceQueryResult> {
  // SupabaseClient.rpc acessa `this.rest`; preservar o cliente ao tipar a RPC.
  const chamarRpc = supabase.rpc.bind(supabase) as unknown as AwaitingRpc;
  const { data, error } = await chamarRpc(
    "get_conversations_awaiting_human_reply",
    { p_org: organizationId, p_instance: instanceId, p_limit: limit },
  );

  if (!error) {
    const { rows, total } = await mapearLinhas(
      data ?? [],
      organizationId,
      () => ({ id: instanceId, nome: instanceName }),
    );
    return { rows, total, degraded: false };
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
  const leads = await dadosDeLead(ids, organizationId);

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
 * A fila inteira numa chamada: `get_conversations_awaiting_human_reply_multi`.
 *
 * Banco sem a RPC multi (SÓ PGRST202 — ver `isMultiAusenteDoSchema`) cai no
 * caminho por chip — o antigo —
 * com a mesma regra de antes para erro parcial: um chip que falha não apaga os
 * outros, e só é erro quando TODOS falham.
 */
export async function buscarFilaAguardando(
  organizationId: string,
  chips: readonly ChipRef[],
  limit: number,
  escopo: ComandoEscopo,
  meuTeamMemberId: string | null,
): Promise<FilaResult> {
  const nomePorCaixa = new Map(chips.map((c) => [c.id, c.instance_name]));
  const chamarMulti = supabase.rpc.bind(supabase) as unknown as AwaitingMultiRpc;
  const { data, error } = await chamarMulti(
    "get_conversations_awaiting_human_reply_multi",
    { p_org: organizationId, p_instances: chips.map((c) => c.id), p_limit: limit },
  );

  if (!error) {
    const { rows, total } = await mapearLinhas(data ?? [], organizationId, (r) => {
      // A RPC multi sempre devolve a caixa. Sem ela (contrato quebrado) a linha
      // não tem como dizer por qual número responder — melhor rotular vazio do
      // que atribuir à caixa errada.
      const id = r.instance_id ?? "";
      return { id, nome: nomePorCaixa.get(id) ?? "" };
    });
    return { rows, total, degraded: false, chipsComErro: 0 };
  }

  if (!isMultiAusenteDoSchema(error)) throw error;

  // ── Expand/contract: RPC multi ainda não aplicada neste banco ──────────────
  // Relatado para sabermos, pelo Sentry, quando nenhum cliente cai mais aqui —
  // é esse o sinal para aposentar este ramo e a RPC por chip.
  reportError(toAppError(error), {
    source: "comando",
    feature: "conversas-aguardando",
    fallback: "awaiting-multi-ausente",
  });
  const resultados = await Promise.allSettled(
    chips.map((chip) =>
      buscarPorInstancia(
        organizationId,
        chip.id,
        chip.instance_name,
        limit,
        escopo,
        meuTeamMemberId,
      ),
    ),
  );
  const ok = resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const falhas = resultados.filter((r) => r.status === "rejected");
  if (chips.length > 0 && ok.length === 0) {
    throw (falhas[0] as PromiseRejectedResult).reason;
  }
  return {
    rows: ok.flatMap((r) => r.rows),
    total: ok.reduce((acc, r) => acc + r.total, 0),
    degraded: ok.some((r) => r.degraded),
    chipsComErro: falhas.length,
  };
}

/**
 * @param limite quantas conversas mostrar depois de juntar todos os chips.
 */
export function useConversasAguardando(limite = 10): ConversasAguardandoResult {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { data: instancias, isLoading: instLoading, isError: instError, refetch: refetchInstancias } =
    useWhatsAppInstancesForUser();
  const { escopo, isAdmin, meuTeamMemberId, isReady } = useComandoScope();
  const queryClient = useQueryClient();

  const chips = instancias ?? [];
  const identidadePendente = !organizationId || !isReady;

  // Pede FOLGA à RPC porque o card só mostra conversa com lead cadastrado
  // (decisão do CTO em 2026-09-04): pedir 10 e descartar as sem lead deixaria a
  // lista curta por corte, não por falta de fila. O teto evita transformar um
  // card em varredura.
  const limiteBusca = Math.min(limite * 3, 60);

  // Ordenado: a mesma seleção em outra ordem é a MESMA pergunta (uma entrada
  // de cache, não duas).
  const chipIds = chips.map((c) => c.id).sort().join(",");

  const fila = useQuery({
    // `escopo` entra na chave: admin e vendedor não podem compartilhar cache,
    // senão um troca-troca de conta serve a lista errada.
    queryKey: [
      "comando",
      "conversas-aguardando",
      organizationId,
      chipIds,
      limiteBusca,
      escopo,
      meuTeamMemberId,
    ],
    queryFn: () =>
      buscarFilaAguardando(
        organizationId as string,
        chips,
        limiteBusca,
        escopo,
        meuTeamMemberId,
      ),
    // Espera a identidade resolver. Sem isso o primeiro fetch sairia com
    // `escopo: "meu"` para um admin, e o resultado errado ficaria em cache
    // sob uma chave que nunca mais é pedida. Sem chip não há pergunta a fazer.
    enabled: !!organizationId && isReady && chips.length > 0,
    staleTime: 30_000,
  });

  // Só conversa com LEAD cadastrado (decisão do CTO em 2026-09-04): o card
  // é uma fila de trabalho sobre gente conhecida. Número solto continua no
  // /chat — some daqui, não do produto. A regra vive em lib para ser
  // testada sem React nem banco.
  const comLead = filaComLead(fila.data?.rows ?? []);

  const resultado: Omit<ConversasAguardandoResult, "refetch"> = {
    items: comLead.slice(0, limite),
    // O total é o das linhas COM LEAD, e não o `waiting_total` do banco:
    // aquele conta a fila inteira, e o contador do cabeçalho ficaria maior
    // que a lista que ele encima.
    total: comLead.length,
    // Enquanto a identidade não resolve não há query nenhuma, e em React
    // Query v5 query desabilitada reporta `isLoading: false` — sem esta
    // linha o card afirmaria "ninguém esperando" durante o boot.
    isLoading: instLoading || identidadePendente || fila.isLoading,
    isError: !!instError || fila.isError,
    isDegraded: fila.data?.degraded === true,
    semChips: !instLoading && !instError && !identidadePendente && chips.length === 0,
    chipsComErro: fila.data?.chipsComErro ?? 0,
    isAdmin,
  };

  return {
    ...resultado,
    // Sem "tentar de novo" o erro do card mais importante da tela vira beco
    // sem saída. Invalidar por prefixo relê a fila (e as instâncias).
    refetch: () => {
      void refetchInstancias();
      void queryClient.invalidateQueries({
        queryKey: ["comando", "conversas-aguardando"],
      });
    },
  };
}
