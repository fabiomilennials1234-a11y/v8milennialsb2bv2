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
}

export interface OrphanStopResult {
  found: number;
  stopped: number;
  alreadyGone: number;
  failed: number;
  usersWithoutToken: number;
  remaining: boolean;
}

interface OrphanRow {
  channel_id: string;
  resource_id: string;
  user_id: string;
}

/** Paralelismo contra o Google por execução. */
const CONCURRENCY = 8;
/** Linhas por UPDATE de expiration (cabe com folga na URL do PostgREST). */
const UPDATE_CHUNK = 200;

export async function stopOrphanWatchChannels(
  supabase: SupabaseClient,
  deps: OrphanStopDeps,
  limit = 1500,
): Promise<OrphanStopResult> {
  const now = (deps.now ?? (() => new Date()))();

  const { data, error } = await supabase
    .from("google_calendar_watch_channels")
    .select("channel_id, resource_id, user_id")
    .eq("is_active", false)
    .gt("expiration", now.toISOString())
    .not("resource_id", "is", null)
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
