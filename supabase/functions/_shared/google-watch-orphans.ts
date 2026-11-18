/**
 * Canais de watch órfãos do Google Calendar: `is_active = false` no banco, mas
 * ainda vivos no Google (expiration no futuro). O banco os ignora; o Google não
 * sabe disso e continua mandando UMA notificação por canal a cada mudança na
 * agenda do dono.
 *
 * Incidente 2026-11-18: 3.618 órfãos (sobra da explosão de 16/11) → cada
 * mudança de agenda de dois usuários virava ~3,6 mil webhooks simultâneos,
 * o pool do PostgREST enchia e o p95 da API INTEIRA ia de ~300 ms a 8–33 s.
 *
 * `stopOrphanWatchChannels` chama channels.stop no Google para cada órfão, com
 * o token do próprio dono (o Google só aceita parar canal com a credencial que
 * o criou), e então zera a `expiration` da linha — a coluna passa a dizer a
 * verdade: o Google não notifica mais por esse canal. Idempotente: rodar de
 * novo só pega o que sobrou.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OrphanStopDeps {
  getAccessToken: (userId: string) => Promise<string | null>;
  /** Status HTTP do channels.stop, ou null em falha de rede. */
  stopChannel: (accessToken: string, channelId: string, resourceId: string) => Promise<number | null>;
  now?: () => Date;
  /**
   * Inclui donos que desconectaram (token `is_active=false`). Desconectar NÃO
   * para os canais no Google (medido 18/11: 1.136 seguiram notificando); se o
   * revoke do disconnect falhou, o refresh token gravado ainda serve para o
   * stop. `getAccessToken` precisa saber buscar o token inativo.
   */
  includeDisconnected?: boolean;
}

export interface OrphanStopResult {
  found: number;
  stopped: number;
  alreadyGone: number;
  failed: number;
  usersWithoutToken: number;
  /** Órfãos cujo dono desconectou o Google: sem credencial, só expiram sozinhos. */
  unreachable: number;
  remaining: boolean;
}

interface OrphanRow {
  channel_id: string;
  resource_id: string;
  user_id: string;
}

/**
 * Teto do lote. O PostgREST de prod trunca em max_rows=1000 sem erro; com
 * limit+1 acima disso, `remaining` sairia falso com órfãos sobrando (medido
 * na 1ª passada de 18/11: pediu 1501, voltaram 1000).
 */
export const MAX_BATCH = 999;

/** Paralelismo contra o Google por execução. */
const CONCURRENCY = 8;
/** Linhas por UPDATE de expiration (cabe com folga na URL do PostgREST). */
const UPDATE_CHUNK = 200;

export async function stopOrphanWatchChannels(
  supabase: SupabaseClient,
  deps: OrphanStopDeps,
  limit = MAX_BATCH,
): Promise<OrphanStopResult> {
  const now = (deps.now ?? (() => new Date()))();
  limit = Math.max(1, Math.min(limit, MAX_BATCH));

  // Só donos com Google conectado: sem credencial o Google recusa o stop, e
  // os órfãos de quem desconectou ocupariam o lote inteiro a cada passada.
  let ownersQ = supabase.from("google_calendar_tokens").select("user_id");
  if (!deps.includeDisconnected) ownersQ = ownersQ.eq("is_active", true);
  const { data: owners, error: ownersErr } = await ownersQ;
  if (ownersErr) throw new Error(`select donos: ${ownersErr.message}`);
  const ownerIds = ((owners ?? []) as Array<{ user_id: string }>).map((o) => o.user_id);

  let unreachableQ = supabase
    .from("google_calendar_watch_channels")
    .select("channel_id", { count: "exact", head: true })
    .eq("is_active", false)
    .gt("expiration", now.toISOString());
  if (ownerIds.length > 0) unreachableQ = unreachableQ.not("user_id", "in", `(${ownerIds.join(",")})`);
  const { count: unreachable, error: countErr } = await unreachableQ;
  if (countErr) throw new Error(`count sem dono conectado: ${countErr.message}`);

  if (ownerIds.length === 0) {
    return { found: 0, stopped: 0, alreadyGone: 0, failed: 0, usersWithoutToken: 0,
      unreachable: unreachable ?? 0, remaining: false };
  }

  const { data, error } = await supabase
    .from("google_calendar_watch_channels")
    .select("channel_id, resource_id, user_id")
    .eq("is_active", false)
    .gt("expiration", now.toISOString())
    .not("resource_id", "is", null)
    .in("user_id", ownerIds)
    .order("expiration", { ascending: false })
    .limit(limit + 1);

  if (error) throw new Error(`select órfãos: ${error.message}`);

  const rows = (data ?? []) as OrphanRow[];
  const remaining = rows.length > limit;
  const batch = rows.slice(0, limit);

  const result: OrphanStopResult = {
    found: batch.length,
    stopped: 0,
    alreadyGone: 0,
    failed: 0,
    usersWithoutToken: 0,
    unreachable: unreachable ?? 0,
    remaining,
  };

  // Um token por dono (o refresh custa uma ida ao Google + um UPDATE).
  const tokens = new Map<string, string | null>();
  for (const userId of new Set(batch.map((r) => r.user_id))) {
    const token = await deps.getAccessToken(userId).catch(() => null);
    tokens.set(userId, token);
    if (!token) result.usersWithoutToken++;
  }

  const done: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < batch.length) {
      const row = batch[cursor++];
      const token = tokens.get(row.user_id);
      if (!token) {
        result.failed++;
        continue;
      }
      const status = await deps.stopChannel(token, row.channel_id, row.resource_id);
      if (status !== null && status >= 200 && status < 300) {
        result.stopped++;
        done.push(row.channel_id);
      } else if (status === 404) {
        // Google não conhece mais o canal: também não notifica mais.
        result.alreadyGone++;
        done.push(row.channel_id);
      } else {
        result.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));

  for (let i = 0; i < done.length; i += UPDATE_CHUNK) {
    const chunk = done.slice(i, i + UPDATE_CHUNK);
    const { error: upErr } = await supabase
      .from("google_calendar_watch_channels")
      .update({ expiration: now.toISOString() })
      .in("channel_id", chunk)
      .eq("is_active", false);
    if (upErr) throw new Error(`update expiration: ${upErr.message}`);
  }

  return result;
}
