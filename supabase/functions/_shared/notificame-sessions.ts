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

  const { data, error } = await admin
    .from("notificame_connect_sessions")
    .insert({
      organization_id: params.organizationId,
      created_by: params.userId,
      // Verbatim: a foto é o que foi listado, sem normalização nem ordenação.
      baseline_channel_ids: params.baselineChannelIds,
      status: "open",
      expires_at: new Date(Date.now() + ttl).toISOString(),
    })
    .select("id")
    .single();

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
  | { state: "open"; baselineChannelIds: string[] }
  | { state: "finished"; baselineChannelIds: string[] }
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

  const { data, error } = await admin
    .from("notificame_connect_sessions")
    .select("status, baseline_channel_ids, expires_at")
    .eq("id", params.sessionId)
    .eq("organization_id", params.organizationId)
    .eq("created_by", params.userId)
    .maybeSingle();

  if (error) {
    console.warn("[notificame] failed to read connect session:", error.message);
    return { state: "invalid" };
  }

  const row = data as
    | { status?: string | null; baseline_channel_ids?: string[] | null; expires_at?: string | null }
    | null;
  if (!row) return { state: "invalid" };

  // 'expired' (marcada pelo prune) é terminal e NÃO é 'finished': nada foi
  // vinculado por ela, então não há desfecho idempotente a reconstruir.
  if (row.status !== "open" && row.status !== "consumed") return { state: "invalid" };

  // Prazo vale para os DOIS estados. `Date.parse` de lixo devolve NaN, e NaN em
  // comparação é sempre falso — daí o teste de finitude explícito, fail-closed.
  const expiresAt = Date.parse(row.expires_at ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { state: "invalid" };

  const baselineChannelIds = row.baseline_channel_ids ?? [];

  if (row.status === "consumed") return { state: "finished", baselineChannelIds };

  await armFinishDeadline(admin, params);
  return { state: "open", baselineChannelIds };
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
