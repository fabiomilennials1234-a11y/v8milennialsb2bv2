/**
 * notificame-sessions — o CHOKE ÚNICO de `public.notificame_connect_sessions`.
 * Nada mais no repo toca essa tabela.
 *
 * O QUE A SESSÃO É: a foto (BASELINE) dos canais que a subconta da org JÁ tinha
 * no instante do clique. Não é nonce — o `postMessage` do Seamless devolve
 * `{status:"channel-success"}` e MAIS NADA, sem id de canal, então nonce nenhum
 * consegue parear sessão↔canal. Quem pareia é o DIFF contra esta foto.
 *
 * O MODO DE FALHA QUE SÓ ELA CONSERTA: um popup ABANDONADO deixa um canal livre
 * dentro da própria subconta da org. Sem a foto, toda conexão seguinte daquela
 * org bate em `ambiguous_channel` PARA SEMPRE, sem saída pela UI — e é um defeito
 * que a subconta por org, sozinha, NÃO resolve. Com a foto, o órfão está nela e
 * sai da conta.
 *
 * A sessão carrega TAMBÉM o TIPO pedido no clique (`requested_channel_type`). O
 * `postMessage` do Seamless é byte-a-byte idêntico para WhatsApp e para Instagram
 * — `{status:"channel-success"}`, sem id e sem tipo —, então o diff sozinho não
 * distingue os dois. É o tipo guardado aqui que estreita os candidatos no finish e
 * impede um canal de WhatsApp nascido em paralelo ser vinculado como Instagram.
 *
 * ⚠️ A SESSÃO NÃO É BEARER. O `session_id` sozinho não autoriza nada: a org e o
 * usuário vêm SEMPRE do contexto de auth, e entram no predicado de TODA leitura e
 * de TODA escrita daqui. E o `session_id` NUNCA trafega pelo payload do terceiro;
 * ele anda só no NOSSO canal start→finish. Se ele entrasse pelo postMessage, quem
 * falasse pela origem do fornecedor escolheria a baseline — ou seja, escolheria
 * QUAL canal é vinculado.
 *
 * ─── CICLO DE VIDA: LER ≠ FECHAR ────────────────────────────────────────────
 *
 * A sessão tem DOIS atos, e separá-los é o ponto inteiro deste módulo:
 *
 *   `readConnectSession`     — valida e devolve a foto. NÃO fecha nada.
 *   `finalizeConnectSession` — fecha, e só é chamada DEPOIS de o canal estar
 *                              VINCULADO no banco.
 *
 * POR QUE NÃO SÃO UM SÓ ATO (o bug que isto conserta): o finish lista
 * `/v1/channels`, que é eventualmente consistente — o canal recém-nascido
 * frequentemente AINDA não aparece na primeira tentativa. É exatamente por isso
 * que o hook retenta. Numa consumação-na-leitura, a primeira tentativa queimava a
 * sessão, o servidor devolvia 409 retentável, e a retentativa seguinte — com o
 * MESMO session_id — não achava mais sessão 'open' e morria em 403
 * `session_invalid` ANTES de listar qualquer coisa. Desfecho: o canal EXISTE no
 * fornecedor, é FATURÁVEL e IRREMOVÍVEL, e nunca é vinculado a org nenhuma —
 * órfão permanente consumindo cota, inalcançável por qualquer tela. O mesmo valia
 * para um INSERT que falhasse: a sessão já tinha sido queimada.
 *
 * Regra, portanto: enquanto o desfecho for RETENTÁVEL, a sessão continua 'open'.
 * Só o vínculo bem-sucedido a fecha.
 *
 * ─── O TETO DE TENTATIVAS É UM PRAZO ────────────────────────────────────────
 *
 * Não há coluna de contador nesta tabela, e o teto não podia virar migration.
 * Ele é, então, um PRAZO — e um prazo é a forma mais estrita disponível aqui,
 * porque também limita o cliente que ignora a cadência de retry.
 *
 * `expires_at` nasce como o teto de vida do POPUP (`CONNECT_SESSION_TTL_MS`). Na
 * PRIMEIRA leitura feita pelo finish, o popup já concluiu e esse teto perdeu a
 * função: a sessão só precisa sobreviver às retentativas. Por isso a leitura
 * ENCURTA `expires_at` para `agora + CONNECT_SESSION_FINISH_WINDOW_MS`.
 *
 * O encurtamento é MONOTÔNICO (só grava quando o valor atual é MAIOR que o novo
 * prazo), então a janela NÃO desliza a cada tentativa: ela é contada da primeira
 * tentativa, e nenhuma sequência de retries a estende. Uma sessão que ficou 6
 * minutos parada no popup recebe o mesmo orçamento de retry de uma que ficou 10
 * segundos.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SeamlessChannelType } from "./notificame.ts";
import {
  isMissingColumnError,
  type PostgrestErrorLike,
} from "./notificame-schema-guard.ts";

/**
 * A coluna da fatia 1.1. Nomeada uma vez porque ela aparece em TRÊS lugares que
 * precisam concordar: o SELECT, o INSERT e a guarda que reconhece a ausência dela.
 *
 * ⚠️ ELA NÃO EXISTE EM PROD NO MOMENTO EM QUE ISTO É ESCRITO. A fatia 1 está no
 * ar; a migration `20270814093000_notificame_instagram_channel` não foi aplicada.
 * Toda leitura e toda escrita desta coluna aqui degrada sozinha enquanto o schema
 * estiver velho — ver `notificame-schema-guard.ts`. A ordem certa continua sendo
 * MIGRATION PRIMEIRO, FUNÇÕES DEPOIS; a degradação é rede, não permissão.
 */
const REQUESTED_TYPE_COLUMN = "requested_channel_type";

/**
 * TTL da sessão: o teto de vida do popup (5 min, `SEAMLESS_TIMEOUT_MS` no hook)
 * mais folga para o finish e seus retries. Curto de propósito — uma baseline
 * velha descreve um estado que já mudou.
 */
export const CONNECT_SESSION_TTL_MS = 7 * 60_000;

/**
 * Orçamento de retry do finish, contado da PRIMEIRA tentativa. Cobre com folga o
 * loop do hook (3 tentativas × 2s) e o replay de uma resposta perdida na rede,
 * sem deixar um session_id velho render chamada ao fornecedor indefinidamente.
 */
export const CONNECT_SESSION_FINISH_WINDOW_MS = 90_000;

/**
 * Guarda barata contra `22P02`. `id` é UUID no banco; um session_id forjado com
 * lixo faria o Postgres reclamar de sintaxe e poluiria o log com erro que não é
 * erro — a resposta correta para lixo é "sessão inválida", em silêncio.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Abre uma sessão com a baseline. `organizationId` e `userId` vêm do auth
 * validado, nunca do body.
 *
 * Devolve `null` em falha em vez de lançar: sessão é MELHORIA DE PRECISÃO, não
 * pré-requisito. Derrubar o start por causa dela deixaria o popup — que já está
 * aberto no browser do usuário — sem contraparte no servidor. Sem sessão o finish
 * degrada para a regra sem baseline, que sob subconta já é escopada à org.
 */
export async function openConnectSession(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    userId: string;
    baselineChannelIds: string[];
    /**
     * O tipo PEDIDO no clique. Vai para a coluna e volta no finish, onde estreita
     * os candidatos do diff ANTES da contagem — é o que impede um canal de
     * WhatsApp nascido em paralelo ser vinculado como Instagram. Já veio pela
     * allowlist de `readSeamlessChannelType`; nunca é string livre do cliente.
     */
    requestedChannelType: SeamlessChannelType;
    ttlMs?: number;
  },
): Promise<string | null> {
  const ttl = params.ttlMs ?? CONNECT_SESSION_TTL_MS;

  // Prune oportunista, só desta org: sessões vencidas não podem seguir 'open' e
  // poluir o índice parcial. Sem cron — o volume é de um clique por conexão.
  try {
    await admin
      .from("notificame_connect_sessions")
      .update({ status: "expired" })
      .eq("organization_id", params.organizationId)
      .eq("status", "open")
      .lt("expires_at", new Date().toISOString());
  } catch {
    // Higiene nunca derruba o caminho quente.
  }

  const base = {
    organization_id: params.organizationId,
    created_by: params.userId,
    // Verbatim: a foto é o que foi listado, sem normalização nem ordenação.
    baseline_channel_ids: params.baselineChannelIds,
    status: "open",
    expires_at: new Date(Date.now() + ttl).toISOString(),
  };

  const insert = (payload: Record<string, unknown>) =>
    admin
      .from("notificame_connect_sessions")
      .insert(payload)
      .select("id")
      .single();

  let { data, error } = await insert({
    ...base,
    [REQUESTED_TYPE_COLUMN]: params.requestedChannelType,
  });

  // ⚠️ SCHEMA VELHO (migration …093000 ainda não aplicada). Sem este retry, o
  // INSERT inteiro morre e a sessão NÃO ABRE — e sessão que não abre é BASELINE
  // PERDIDA, que é o defeito que trava a org em `ambiguous_channel` sem saída
  // pela UI. Repetir SEM a coluna preserva a foto, que é o que a fatia 1 precisa;
  // o tipo é a única coisa que se perde, e ele é irrelevante num schema onde
  // Instagram sequer pode ser pedido (a flag `notificame_instagram` é ligada pela
  // MESMA migration que cria a coluna).
  if (isMissingColumnError(error, REQUESTED_TYPE_COLUMN)) {
    console.warn(
      `[notificame] ${REQUESTED_TYPE_COLUMN} ausente — sessão aberta sem tipo. ` +
        "Apliquem a migration 20270814093000_notificame_instagram_channel: " +
        "MIGRATION PRIMEIRO, FUNÇÕES DEPOIS.",
    );
    ({ data, error } = await insert(base));
  }

  if (error || !data?.id) {
    console.warn("[notificame] failed to open connect session:", error?.message);
    return null;
  }
  return data.id as string;
}

/**
 * Estado da sessão do ponto de vista do finish.
 *
 *   `open`     — vale usar a foto e tentar vincular. Ainda NÃO foi fechada.
 *   `finished` — já houve um vínculo bem-sucedido nesta sessão. A foto vem junto
 *                de propósito: é ela que permite ao finish reconhecer QUAL canal
 *                esta sessão vinculou e responder de forma IDEMPOTENTE, em vez de
 *                gritar erro por cima de um sucesso que só se perdeu na rede.
 *   `invalid`  — inexistente, forjada, de outra org, de outro usuário, marcada
 *                'expired' pelo prune, ou fora do prazo. O chamador NÃO pode
 *                degradar para o caminho sem baseline: uma sessão inválida não
 *                pode ALARGAR a regra que decide qual canal é vinculado.
 */
export type ConnectSessionState =
  | { state: "open"; baselineChannelIds: string[]; requestedChannelType: SeamlessChannelType }
  | { state: "finished"; baselineChannelIds: string[]; requestedChannelType: SeamlessChannelType }
  | { state: "invalid" };

/**
 * LÊ a sessão e devolve a baseline — sem fechá-la.
 *
 * A autorização inteira está no predicado: org do auth E usuário do auth. O
 * `session_id` sozinho não abre nada.
 *
 * Efeito colateral deliberado e idempotente: quando a sessão está 'open', arma o
 * prazo de retry (ver cabeçalho). É a única escrita desta função, ela nunca muda
 * `status`, e falhar nela não derruba a leitura.
 */
export async function readConnectSession(
  admin: SupabaseClient,
  params: {
    sessionId: string;
    organizationId: string;
    userId: string;
    finishWindowMs?: number;
  },
): Promise<ConnectSessionState> {
  if (!UUID_RE.test(params.sessionId)) return { state: "invalid" };

  // A lista de colunas deixa de ser literal (são DUAS listas possíveis), então o
  // shape é declarado aqui e afirmado UMA vez, na fronteira. Todo campo é
  // opcional de propósito: o parse abaixo já é fail-closed campo a campo, e num
  // schema velho `requested_channel_type` simplesmente não vem.
  interface SessionRow {
    status?: string | null;
    baseline_channel_ids?: string[] | null;
    expires_at?: string | null;
    requested_channel_type?: string | null;
  }

  const select = async (
    columns: string,
  ): Promise<{ data: SessionRow | null; error: PostgrestErrorLike | null }> => {
    const res = await admin
      .from("notificame_connect_sessions")
      .select(columns)
      .eq("id", params.sessionId)
      .eq("organization_id", params.organizationId)
      .eq("created_by", params.userId)
      .maybeSingle();
    return {
      data: (res.data as unknown as SessionRow | null) ?? null,
      error: (res.error as PostgrestErrorLike | null) ?? null,
    };
  };

  const LEGACY_COLUMNS = "status, baseline_channel_ids, expires_at";

  let { data, error } = await select(`${LEGACY_COLUMNS}, ${REQUESTED_TYPE_COLUMN}`);

  // ⚠️ ESTA É A LINHA COM DANO EM PROD. A fatia 1 está NO AR e a migration
  // …093000 NÃO está aplicada: pedir a coluna nova num schema velho faz o
  // PostgREST devolver ERRO — não linha vazia —, e um erro aqui vira
  // `{state:'invalid'}`, que vira 403 `session_invalid` no finish, que vira canal
  // FATURÁVEL e IRREMOVÍVEL nascido no fornecedor e vinculado a NINGUÉM. Para
  // TODA conexão de WhatsApp da org, não só para Instagram.
  //
  // POR QUE ESTE FORMATO (e não `select('*')`): o retry é disparado por UM erro
  // nomeado sobre UMA coluna nomeada, então qualquer outra falha — RLS, permissão,
  // outra coluna ausente — continua derrubando a leitura como hoje. `select('*')`
  // resolveria a janela em uma ida ao banco, mas toleraria PARA SEMPRE e EM
  // SILÊNCIO qualquer coluna que sumisse ou fosse renomeada, e o filtro de tipo do
  // diff cairia sem ninguém ficar sabendo. Aqui a degradação é ruidosa, some
  // sozinha assim que a migration entra, e custa a ida extra só na janela.
  if (isMissingColumnError(error, REQUESTED_TYPE_COLUMN)) {
    console.warn(
      `[notificame] ${REQUESTED_TYPE_COLUMN} ausente — sessão lida como whatsapp. ` +
        "Apliquem a migration 20270814093000_notificame_instagram_channel: " +
        "MIGRATION PRIMEIRO, FUNÇÕES DEPOIS.",
    );
    ({ data, error } = await select(LEGACY_COLUMNS));
  }

  if (error) {
    console.warn("[notificame] failed to read connect session:", error.message);
    return { state: "invalid" };
  }

  const row = data;
  if (!row) return { state: "invalid" };

  // 'expired' (marcada pelo prune) é terminal e NÃO é 'finished': nada foi
  // vinculado por ela, então não há desfecho idempotente a reconstruir.
  if (row.status !== "open" && row.status !== "consumed") return { state: "invalid" };

  // Prazo vale para os DOIS estados. `Date.parse` de lixo devolve NaN, e NaN em
  // comparação é sempre falso — daí o teste de finitude explícito, fail-closed.
  const expiresAt = Date.parse(row.expires_at ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { state: "invalid" };

  const baselineChannelIds = row.baseline_channel_ids ?? [];

  // Sessão anterior à migration `…093000` (coluna ausente/nula) é, por
  // definição, de WhatsApp: era o único tipo que existia quando ela foi aberta —
  // Instagram só é PEDÍVEL com a flag `notificame_instagram`, que a MESMA
  // migration liga. 'whatsapp' aqui é FATO, não chute. Degradar para `null`
  // tiraria o filtro de tipo de uma sessão viva sem ganho nenhum — o default do
  // banco já é 'whatsapp'.
  const requestedChannelType: SeamlessChannelType =
    row.requested_channel_type === "instagram" ? "instagram" : "whatsapp";

  if (row.status === "consumed") {
    return { state: "finished", baselineChannelIds, requestedChannelType };
  }

  await armFinishDeadline(admin, params);
  return { state: "open", baselineChannelIds, requestedChannelType };
}

/**
 * Encurta `expires_at` para o orçamento de retry. MONOTÔNICO: o `.gt()` garante
 * que só grava quando o prazo atual é MAIOR que o novo, então a janela é contada
 * da primeira tentativa e nenhuma retentativa a estende.
 */
async function armFinishDeadline(
  admin: SupabaseClient,
  params: {
    sessionId: string;
    organizationId: string;
    userId: string;
    finishWindowMs?: number;
  },
): Promise<void> {
  const windowMs = params.finishWindowMs ?? CONNECT_SESSION_FINISH_WINDOW_MS;
  const deadline = new Date(Date.now() + windowMs).toISOString();
  try {
    await admin
      .from("notificame_connect_sessions")
      .update({ expires_at: deadline })
      .eq("id", params.sessionId)
      .eq("organization_id", params.organizationId)
      .eq("created_by", params.userId)
      .eq("status", "open")
      .gt("expires_at", deadline);
  } catch (err) {
    // Higiene: o teto é uma defesa em profundidade, não o caminho quente.
    console.warn("[notificame] failed to arm finish deadline:", (err as Error)?.message);
  }
}

/**
 * FECHA a sessão. Chamar SOMENTE depois de o canal estar vinculado no banco.
 *
 * Atômico pelo predicado (`status = 'open'`): duas execuções concorrentes com a
 * mesma sessão — só uma fecha, e o retorno diz qual.
 *
 * ⚠️ O predicado NÃO checa `expires_at` DE PROPÓSITO, e é o único lugar deste
 * módulo onde o prazo é ignorado. O prazo governa COMEÇAR uma tentativa; aqui o
 * vínculo já aconteceu, e recusar o fechamento por causa do relógio deixaria uma
 * sessão 'open' com foto velha viva para vincular um SEGUNDO canal.
 *
 * Devolve `false` também em erro: quem chama já vinculou e deve responder
 * sucesso de qualquer forma — sessão pendurada expira sozinha, vínculo perdido
 * não volta.
 */
export async function finalizeConnectSession(
  admin: SupabaseClient,
  params: { sessionId: string; organizationId: string; userId: string },
): Promise<boolean> {
  if (!UUID_RE.test(params.sessionId)) return false;

  const { data, error } = await admin
    .from("notificame_connect_sessions")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", params.sessionId)
    .eq("organization_id", params.organizationId)
    .eq("created_by", params.userId)
    .eq("status", "open")
    .select("id");

  if (error) {
    console.warn("[notificame] failed to finalize connect session:", error.message);
    return false;
  }
  return ((data as unknown[] | null) ?? []).length > 0;
}
